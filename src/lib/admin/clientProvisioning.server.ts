import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { getCanonicalAppHostname } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { sendConciergeSetupEmail } from "@/lib/email/conciergeSetup";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  publicProvisioningJobSchema,
  type CreatePartnerClientInput,
  type ProvisioningRouteResponse,
  type ProvisioningStatus,
  type PublicProvisioningJob,
  type RetryPartnerClientInput,
  type SetupEmailRouteResponse,
} from "./clientProvisioning.shared";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const JOB_COLUMNS = [
  "id",
  "email",
  "requested_business_name",
  "partner_id",
  "billing_mode",
  "partner_plan",
  "auth_user_id",
  "business_id",
  "status",
  "last_error_code",
  "setup_email_sent_at",
  "invite_attempt_count",
  "dismissed_at",
  "dismissed_by_admin_id",
  "operation_token",
  "operation_kind",
  "operation_started_at",
  "operation_expires_at",
  "created_by_admin_id",
  "created_at",
  "updated_at",
].join(",");

const storedJobSchema = z.object({
  id: z.string().uuid(),
  email: z.string().min(1),
  requested_business_name: z.string().min(1),
  partner_id: z.string().uuid(),
  billing_mode: z.enum(["invoiced", "comped"]),
  partner_plan: z.enum(["sms_only", "sms_and_chat", "full"]),
  auth_user_id: z.string().uuid().nullable(),
  business_id: z.string().uuid().nullable(),
  status: z.enum([
    "pending",
    "auth_created",
    "business_prepared",
    "assigned",
    "admin_setup",
    "invite_pending",
    "setup_email_sent",
    "needs_attention",
    "dismissed",
  ]),
  last_error_code: z.string().nullable(),
  setup_email_sent_at: z.string().nullable(),
  invite_attempt_count: z.number().int().nonnegative(),
  dismissed_at: z.string().nullable(),
  dismissed_by_admin_id: z.string().uuid().nullable(),
  operation_token: z.string().uuid().nullable(),
  operation_kind: z.enum(["provision", "retry", "send_setup"]).nullable(),
  operation_started_at: z.string().nullable(),
  operation_expires_at: z.string().nullable(),
  created_by_admin_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

const partnerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  custom_domain: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  domain_status: z.enum(["pending", "connected"]),
});

const businessSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  name: z.string(),
  partner_id: z.string().uuid().nullable(),
  billing_mode: z.enum(["stripe", "invoiced", "comped"]),
  partner_plan: z.enum(["sms_only", "sms_and_chat", "full"]).nullable(),
  deleted_at: z.string().nullable(),
});

type StoredProvisioningJob = z.infer<typeof storedJobSchema>;
type ProvisioningPartner = z.infer<typeof partnerSchema> & { origin: string };
type ProvisioningBusiness = z.infer<typeof businessSchema>;
type ProvisioningOperationKind = "provision" | "retry" | "send_setup";

type ProvisioningOperation = {
  token: string;
  job: StoredProvisioningJob;
};

type ProvisioningAuthUser = {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
  appMetadata: Record<string, unknown>;
};

type JobPatch = Partial<
  Pick<
    StoredProvisioningJob,
    | "auth_user_id"
    | "business_id"
    | "status"
    | "last_error_code"
    | "setup_email_sent_at"
    | "invite_attempt_count"
  >
>;

type AssignmentResult =
  | { ok: true }
  | {
      ok: false;
      code: AssignmentErrorCode;
    };

type AssignmentErrorCode =
  | "business_not_found"
  | "subscription_exists"
  | "partner_required"
  | "partner_inactive"
  | "assignment_failed";

export type ClientProvisioningDependencies = {
  createOrLoadJob: (
    input: CreatePartnerClientInput,
    adminId: string,
  ) => Promise<{ job: StoredProvisioningJob; created: boolean }>;
  loadJobById: (id: string) => Promise<StoredProvisioningJob | null>;
  claimOperation: (input: {
    jobId: string;
    kind: ProvisioningOperationKind;
    token: string;
    reconciledToken: string | null;
    now: string;
  }) => Promise<StoredProvisioningJob>;
  updateJob: (
    id: string,
    operationToken: string,
    patch: JobPatch,
    release: boolean,
  ) => Promise<StoredProvisioningJob>;
  loadPartner: (id: string) => Promise<ProvisioningPartner | null>;
  createAuthUser: (input: {
    email: string;
    password: string;
    provisioningId: string;
  }) => Promise<
    | { status: "created"; user: ProvisioningAuthUser }
    | { status: "email_exists" }
    | { status: "failed" }
  >;
  findAuthUserByEmail: (email: string) => Promise<ProvisioningAuthUser | null>;
  getAuthUserById: (id: string) => Promise<ProvisioningAuthUser | null>;
  loadBusinessesByOwner: (ownerId: string) => Promise<ProvisioningBusiness[]>;
  updateBusinessName: (
    businessId: string,
    ownerId: string,
    name: string,
  ) => Promise<void>;
  assignPartnerBilling: (input: {
    businessId: string;
    partnerId: string;
    billingMode: "invoiced" | "comped";
    partnerPlan: "sms_only" | "sms_and_chat" | "full";
    adminId: string;
  }) => Promise<AssignmentResult>;
  generateRecoveryLink: (input: {
    email: string;
    redirectTo: string;
  }) => Promise<{
    hashedToken: string;
    verificationType: string;
    user: ProvisioningAuthUser;
  }>;
  sendSetupEmail: (input: {
    businessId: string;
    businessName: string;
    recipient: string;
    setupUrl: string;
  }) => Promise<void>;
  randomPassword: () => string;
  randomOperationToken: () => string;
  now: () => string;
};

export type ClientProvisioningErrorCode =
  | "job_not_found"
  | "job_dismissed"
  | "provisioning_in_progress"
  | "provisioning_outcome_unknown"
  | "partner_inactive"
  | "provisioning_conflict"
  | "email_in_use"
  | "auth_creation_failed"
  | "auth_identity_mismatch"
  | "setup_already_completed"
  | "business_missing"
  | "business_ambiguous"
  | "business_identity_mismatch"
  | "business_update_failed"
  | "business_not_found"
  | "subscription_exists"
  | "partner_required"
  | "assignment_failed"
  | "link_generation_failed"
  | "setup_email_failed"
  | "provisioning_failed";

export class ClientProvisioningError extends Error {
  constructor(
    readonly code: ClientProvisioningErrorCode,
    readonly status: number,
    message: string = code,
    readonly provisioningId?: string,
  ) {
    super(message);
    this.name = "ClientProvisioningError";
  }
}

function errorFor(
  code: ClientProvisioningErrorCode,
  status = 500,
  provisioningId?: string,
): ClientProvisioningError {
  return new ClientProvisioningError(code, status, code, provisioningId);
}

function withProvisioningId(error: unknown, provisioningId: string): unknown {
  if (error instanceof ClientProvisioningError) {
    if (error.code === "job_not_found" || error.provisioningId) return error;
    return new ClientProvisioningError(
      error.code,
      error.status,
      error.message,
      provisioningId,
    );
  }
  return errorFor("provisioning_failed", 500, provisioningId);
}

function isTerminalStatus(status: ProvisioningStatus): boolean {
  return status === "admin_setup" || status === "setup_email_sent";
}

function assertJobMatchesInput(
  job: StoredProvisioningJob,
  input: CreatePartnerClientInput,
): void {
  if (
    job.email !== input.email ||
    job.requested_business_name !== input.businessName ||
    job.partner_id !== input.partnerId ||
    job.billing_mode !== input.billingMode ||
    job.partner_plan !== input.partnerPlan
  ) {
    throw errorFor("provisioning_conflict", 409);
  }
}

function assertAuthProvisioningIdentity(
  user: ProvisioningAuthUser,
  job: StoredProvisioningJob,
): void {
  if (
    user.id.length === 0 ||
    user.email?.trim().toLowerCase() !== job.email ||
    !user.emailConfirmedAt ||
    user.appMetadata.concierge_provisioning_id !== job.id
  ) {
    throw errorFor("auth_identity_mismatch", 409);
  }
}

function assertAuthIdentity(
  user: ProvisioningAuthUser,
  job: StoredProvisioningJob,
): void {
  assertAuthProvisioningIdentity(user, job);
  if (user.appMetadata.must_set_password !== true) {
    throw errorFor("setup_already_completed", 409);
  }
}

function publicJob(
  job: StoredProvisioningJob,
  partner: ProvisioningPartner,
): PublicProvisioningJob {
  return publicProvisioningJobSchema.parse({
    id: job.id,
    email: job.email,
    businessName: job.requested_business_name,
    partnerId: job.partner_id,
    partnerName: partner.name,
    billingMode: job.billing_mode,
    partnerPlan: job.partner_plan,
    status: job.status,
    lastErrorCode: job.last_error_code,
    authUserId: job.auth_user_id,
    businessId: job.business_id,
    setupEmailSentAt: job.setup_email_sent_at,
    inviteAttemptCount: job.invite_attempt_count,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
}

function isOperationOwnershipError(
  error: unknown,
): error is ClientProvisioningError {
  return (
    error instanceof ClientProvisioningError &&
    ["provisioning_in_progress", "provisioning_outcome_unknown"].includes(
      error.code,
    )
  );
}

async function recordOperationFailure(
  dependencies: ClientProvisioningDependencies,
  operation: ProvisioningOperation,
  failure: ClientProvisioningError,
  status: "needs_attention" | "invite_pending" = "needs_attention",
  release = true,
  patch: JobPatch = {},
): Promise<never> {
  try {
    await dependencies.updateJob(
      operation.job.id,
      operation.token,
      {
        ...patch,
        status,
        last_error_code: failure.code,
      },
      release,
    );
  } catch (writeError) {
    if (isOperationOwnershipError(writeError)) throw writeError;
    throw errorFor("provisioning_outcome_unknown", 409);
  }
  throw failure;
}

async function saveProgress(
  dependencies: ClientProvisioningDependencies,
  operation: ProvisioningOperation,
  status: "auth_created" | "business_prepared" | "assigned",
  patch: JobPatch = {},
): Promise<ProvisioningOperation> {
  const job = await dependencies.updateJob(
    operation.job.id,
    operation.token,
    {
      ...patch,
      ...(isTerminalStatus(operation.job.status) ? {} : { status }),
      last_error_code: null,
    },
    false,
  );
  return { ...operation, job };
}

async function releaseOperation(
  dependencies: ClientProvisioningDependencies,
  operation: ProvisioningOperation,
  patch: JobPatch = {},
): Promise<StoredProvisioningJob> {
  return dependencies.updateJob(operation.job.id, operation.token, patch, true);
}

async function releaseOperationOrFailUnknown(
  dependencies: ClientProvisioningDependencies,
  operation: ProvisioningOperation,
  patch: JobPatch = {},
): Promise<StoredProvisioningJob> {
  try {
    return await releaseOperation(dependencies, operation, patch);
  } catch (error) {
    if (isOperationOwnershipError(error)) throw error;
    throw errorFor("provisioning_outcome_unknown", 409);
  }
}

function validatePartner(
  partner: ProvisioningPartner | null,
): ProvisioningPartner {
  if (
    !partner ||
    partner.status !== "active" ||
    partner.domain_status !== "connected"
  ) {
    throw errorFor("partner_inactive", 409);
  }

  const name = partner.name.trim();
  const domain = partner.custom_domain;
  if (
    !name ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    !domain ||
    !domain.includes(".") ||
    normalizeHostHeader(domain) !== domain ||
    domain === getCanonicalAppHostname()
  ) {
    throw errorFor("partner_inactive", 409);
  }

  return { ...partner, name, origin: `https://${domain}` };
}

function validateRecoveredBusiness(
  businesses: ProvisioningBusiness[],
  job: StoredProvisioningJob,
  authUserId: string,
): ProvisioningBusiness {
  if (businesses.length === 0) throw errorFor("business_missing");
  if (businesses.length !== 1) throw errorFor("business_ambiguous");

  const business = businesses[0];
  if (
    business.owner_id !== authUserId ||
    business.deleted_at !== null ||
    (job.business_id !== null && job.business_id !== business.id) ||
    (business.partner_id !== null && business.partner_id !== job.partner_id)
  ) {
    throw errorFor("business_identity_mismatch", 409);
  }
  return business;
}

type ReconciledProvisioningIdentity = {
  authUserId: string | null;
  businessId: string | null;
};

function operationIsExpired(job: StoredProvisioningJob, now: string): boolean {
  if (!job.operation_token || !job.operation_expires_at) return false;
  const expiresAt = Date.parse(job.operation_expires_at);
  const currentTime = Date.parse(now);
  return (
    Number.isFinite(expiresAt) &&
    Number.isFinite(currentTime) &&
    expiresAt <= currentTime
  );
}

function assertReconciledBusinessState(
  business: ProvisioningBusiness,
  job: StoredProvisioningJob,
): void {
  const unassigned =
    business.partner_id === null &&
    business.billing_mode === "stripe" &&
    business.partner_plan === null;
  const assigned =
    business.partner_id === job.partner_id &&
    business.billing_mode === job.billing_mode &&
    business.partner_plan === job.partner_plan;

  if (!unassigned && !assigned) {
    throw errorFor("business_identity_mismatch", 409);
  }
  if (
    ["assigned", "admin_setup", "invite_pending", "setup_email_sent"].includes(
      job.status,
    ) &&
    !assigned
  ) {
    throw errorFor("business_identity_mismatch", 409);
  }
}

async function reconcileExpiredOperation(
  dependencies: ClientProvisioningDependencies,
  job: StoredProvisioningJob,
): Promise<ReconciledProvisioningIdentity> {
  // The paginated email lookup is exhaustive. It proves the recovered Auth
  // identity is the only account for the canonical email; a stored UUID alone
  // is not sufficient reconciliation evidence after an unknown createUser
  // outcome.
  const user = await dependencies.findAuthUserByEmail(job.email);

  if (!user) {
    if (
      job.auth_user_id !== null ||
      job.business_id !== null ||
      !["pending", "needs_attention"].includes(job.status)
    ) {
      throw errorFor("auth_identity_mismatch", 409);
    }
    return { authUserId: null, businessId: null };
  }

  // A matching user that already completed password setup is still valid
  // reconciliation evidence. After the stale token is atomically replaced,
  // the ordinary Auth stage will detect completion and release the fresh
  // operation without mutating the business or generating another link.
  assertAuthProvisioningIdentity(user, job);
  if (job.auth_user_id !== null && job.auth_user_id !== user.id) {
    throw errorFor("auth_identity_mismatch", 409);
  }

  const business = validateRecoveredBusiness(
    await dependencies.loadBusinessesByOwner(user.id),
    job,
    user.id,
  );
  assertReconciledBusinessState(business, job);

  return { authUserId: user.id, businessId: business.id };
}

async function beginOperation(
  dependencies: ClientProvisioningDependencies,
  job: StoredProvisioningJob,
  kind: ProvisioningOperationKind,
  reconcileExpired: boolean,
): Promise<ProvisioningOperation> {
  const observedAt = dependencies.now();
  let reconciledToken: string | null = null;
  let reconciliation: ReconciledProvisioningIdentity | null = null;

  if (job.operation_token && operationIsExpired(job, observedAt)) {
    if (reconcileExpired) {
      reconciliation = await reconcileExpiredOperation(dependencies, job);
      reconciledToken = job.operation_token;
    }
  }

  // Reconciliation may require paginated Auth reads. Start the replacement
  // lease from a fresh timestamp, not from the time of the initial stale read.
  const claimNow = dependencies.now();
  const token = dependencies.randomOperationToken();
  const claimed = await dependencies.claimOperation({
    jobId: job.id,
    kind,
    token,
    reconciledToken,
    now: claimNow,
  });
  let operation = { token, job: claimed };

  if (reconciliation?.authUserId) {
    const recovered = await dependencies.updateJob(
      claimed.id,
      token,
      {
        auth_user_id: reconciliation.authUserId,
        business_id: reconciliation.businessId,
      },
      false,
    );
    operation = { token, job: recovered };
  }

  return operation;
}

export function createClientProvisioningService(
  dependencies: ClientProvisioningDependencies,
) {
  async function loadJob(id: string): Promise<StoredProvisioningJob> {
    const job = await dependencies.loadJobById(id);
    if (!job) throw errorFor("job_not_found", 404);
    return job;
  }

  async function loadValidatedJob(id: string): Promise<{
    job: StoredProvisioningJob;
    partner: ProvisioningPartner;
  }> {
    const job = await loadJob(id);
    try {
      return {
        job,
        partner: validatePartner(
          await dependencies.loadPartner(job.partner_id),
        ),
      };
    } catch (error) {
      throw withProvisioningId(error, job.id);
    }
  }

  async function loadPartnerForOperation(
    operation: ProvisioningOperation,
  ): Promise<ProvisioningPartner> {
    try {
      return validatePartner(
        await dependencies.loadPartner(operation.job.partner_id),
      );
    } catch (error) {
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("provisioning_failed");
      return recordOperationFailure(dependencies, operation, failure);
    }
  }

  async function claim(
    job: StoredProvisioningJob,
    kind: ProvisioningOperationKind,
    reconcileExpired: boolean,
  ): Promise<ProvisioningOperation> {
    try {
      return await beginOperation(dependencies, job, kind, reconcileExpired);
    } catch (error) {
      throw withProvisioningId(error, job.id);
    }
  }

  async function ensureAuthUser(
    originalOperation: ProvisioningOperation,
  ): Promise<{
    operation: ProvisioningOperation;
    user: ProvisioningAuthUser;
  }> {
    let operation = originalOperation;
    let user: ProvisioningAuthUser | null = null;
    let mutationOutcomeUnknown = false;

    try {
      if (operation.job.auth_user_id) {
        user = await dependencies.getAuthUserById(operation.job.auth_user_id);
        if (!user) throw errorFor("auth_identity_mismatch", 409);
      } else {
        mutationOutcomeUnknown = true;
        const result = await dependencies.createAuthUser({
          email: operation.job.email,
          password: dependencies.randomPassword(),
          provisioningId: operation.job.id,
        });

        if (result.status === "created") {
          mutationOutcomeUnknown = false;
          user = result.user;
        } else if (result.status === "email_exists") {
          mutationOutcomeUnknown = false;
          user = await dependencies.findAuthUserByEmail(operation.job.email);
          if (!user) throw errorFor("email_in_use", 409);
          if (user.appMetadata.concierge_provisioning_id !== operation.job.id) {
            throw errorFor("email_in_use", 409);
          }
        } else {
          throw errorFor("auth_creation_failed");
        }
      }

      assertAuthIdentity(user, operation.job);
      if (
        operation.job.auth_user_id !== null &&
        operation.job.auth_user_id !== user.id
      ) {
        throw errorFor("auth_identity_mismatch", 409);
      }
      operation = await saveProgress(dependencies, operation, "auth_created", {
        auth_user_id: user.id,
      });
      return { operation, user };
    } catch (error) {
      if (isOperationOwnershipError(error)) throw error;
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("auth_creation_failed");
      if (failure.code === "setup_already_completed") {
        await releaseOperationOrFailUnknown(dependencies, operation);
        throw failure;
      }
      return recordOperationFailure(
        dependencies,
        operation,
        failure,
        "needs_attention",
        !mutationOutcomeUnknown,
      );
    }
  }

  async function ensureBusiness(
    originalOperation: ProvisioningOperation,
    authUser: ProvisioningAuthUser,
  ): Promise<{
    operation: ProvisioningOperation;
    business: ProvisioningBusiness;
  }> {
    let operation = originalOperation;
    let mutationOutcomeUnknown = false;
    try {
      const business = validateRecoveredBusiness(
        await dependencies.loadBusinessesByOwner(authUser.id),
        operation.job,
        authUser.id,
      );

      mutationOutcomeUnknown = true;
      await dependencies.updateBusinessName(
        business.id,
        authUser.id,
        operation.job.requested_business_name,
      );
      mutationOutcomeUnknown = false;

      operation = await saveProgress(
        dependencies,
        operation,
        "business_prepared",
        { business_id: business.id },
      );
      return {
        operation,
        business: {
          ...business,
          name: operation.job.requested_business_name,
        },
      };
    } catch (error) {
      if (isOperationOwnershipError(error)) throw error;
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor(
              mutationOutcomeUnknown
                ? "business_update_failed"
                : "provisioning_failed",
            );
      return recordOperationFailure(
        dependencies,
        operation,
        failure,
        "needs_attention",
        !mutationOutcomeUnknown,
      );
    }
  }

  async function ensureAssignment(
    originalOperation: ProvisioningOperation,
    business: ProvisioningBusiness,
    adminId: string,
  ): Promise<ProvisioningOperation> {
    let mutationOutcomeUnknown = true;
    try {
      const result = await dependencies.assignPartnerBilling({
        businessId: business.id,
        partnerId: originalOperation.job.partner_id,
        billingMode: originalOperation.job.billing_mode,
        partnerPlan: originalOperation.job.partner_plan,
        adminId,
      });
      mutationOutcomeUnknown = false;
      if (!result.ok) {
        const status =
          result.code === "business_not_found"
            ? 404
            : result.code === "assignment_failed"
              ? 500
              : 409;
        throw errorFor(result.code, status);
      }
      return await saveProgress(dependencies, originalOperation, "assigned");
    } catch (error) {
      if (isOperationOwnershipError(error)) throw error;
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("assignment_failed");
      return recordOperationFailure(
        dependencies,
        originalOperation,
        failure,
        "needs_attention",
        !mutationOutcomeUnknown,
      );
    }
  }

  async function prepare(
    operation: ProvisioningOperation,
    adminId: string,
  ): Promise<ProvisioningOperation> {
    const auth = await ensureAuthUser(operation);
    const preparedBusiness = await ensureBusiness(auth.operation, auth.user);
    return ensureAssignment(
      preparedBusiness.operation,
      preparedBusiness.business,
      adminId,
    );
  }

  async function assertCurrentBusinessAssignment(
    operation: ProvisioningOperation,
  ): Promise<void> {
    if (!operation.job.auth_user_id || !operation.job.business_id) {
      throw errorFor("business_identity_mismatch", 409);
    }
    const business = validateRecoveredBusiness(
      await dependencies.loadBusinessesByOwner(operation.job.auth_user_id),
      operation.job,
      operation.job.auth_user_id,
    );
    assertReconciledBusinessState(business, operation.job);
  }

  async function generateSetupUrl(
    originalOperation: ProvisioningOperation,
  ): Promise<{
    operation: ProvisioningOperation;
    setupUrl: string;
    partner: ProvisioningPartner;
  }> {
    let operation = originalOperation;
    // Revalidate immediately before minting a partner-host bearer URL. The
    // partner may have been disabled while Auth/business preparation ran.
    const partner = await loadPartnerForOperation(operation);
    let attemptedGeneration = false;
    let mutationOutcomeUnknown = false;
    try {
      if (!operation.job.auth_user_id) {
        throw errorFor("auth_identity_mismatch", 409);
      }
      const currentUser = await dependencies.getAuthUserById(
        operation.job.auth_user_id,
      );
      if (!currentUser) throw errorFor("auth_identity_mismatch", 409);
      assertAuthIdentity(currentUser, operation.job);
      if (currentUser.id !== operation.job.auth_user_id) {
        throw errorFor("auth_identity_mismatch", 409);
      }
      await assertCurrentBusinessAssignment(operation);

      const callback = new URL("/api/auth/callback", partner.origin);
      attemptedGeneration = true;
      mutationOutcomeUnknown = true;
      const generated = await dependencies.generateRecoveryLink({
        email: operation.job.email,
        redirectTo: callback.toString(),
      });
      mutationOutcomeUnknown = false;
      assertAuthIdentity(generated.user, operation.job);
      if (
        generated.user.id !== operation.job.auth_user_id ||
        generated.verificationType !== "recovery" ||
        !generated.hashedToken
      ) {
        throw errorFor("link_generation_failed");
      }

      callback.searchParams.set("token_hash", generated.hashedToken);
      callback.searchParams.set("type", "recovery");
      callback.searchParams.set("flow", "concierge");
      const job = await dependencies.updateJob(
        operation.job.id,
        operation.token,
        {
          status: "invite_pending",
          last_error_code: null,
          invite_attempt_count: operation.job.invite_attempt_count + 1,
        },
        false,
      );
      operation = { ...operation, job };
      return { operation, setupUrl: callback.toString(), partner };
    } catch (error) {
      if (isOperationOwnershipError(error)) throw error;
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("link_generation_failed");
      if (failure.code === "setup_already_completed") {
        await releaseOperationOrFailUnknown(dependencies, operation);
        throw failure;
      }
      return recordOperationFailure(
        dependencies,
        operation,
        failure,
        attemptedGeneration ? "invite_pending" : "needs_attention",
        !mutationOutcomeUnknown,
        attemptedGeneration
          ? {
              invite_attempt_count: operation.job.invite_attempt_count + 1,
            }
          : {},
      );
    }
  }

  async function finishManualSetup(
    operation: ProvisioningOperation,
  ): Promise<ProvisioningRouteResponse> {
    const generated = await generateSetupUrl(operation);
    const job = await releaseOperationOrFailUnknown(
      dependencies,
      generated.operation,
      { status: "admin_setup", last_error_code: null },
    );
    return {
      provisioning: publicJob(job, generated.partner),
      adminSetupUrl: generated.setupUrl,
    };
  }

  async function finishEmailSetup(
    operation: ProvisioningOperation,
  ): Promise<SetupEmailRouteResponse> {
    const generated = await generateSetupUrl(operation);
    let sendOutcomeUnknown = false;
    try {
      await assertCurrentBusinessAssignment(generated.operation);
      sendOutcomeUnknown = true;
      await dependencies.sendSetupEmail({
        businessId: generated.operation.job.business_id!,
        businessName: generated.operation.job.requested_business_name,
        recipient: generated.operation.job.email,
        setupUrl: generated.setupUrl,
      });
      sendOutcomeUnknown = false;
      const job = await releaseOperationOrFailUnknown(
        dependencies,
        generated.operation,
        {
          status: "setup_email_sent",
          last_error_code: null,
          setup_email_sent_at: dependencies.now(),
        },
      );
      return { provisioning: publicJob(job, generated.partner) };
    } catch (error) {
      if (isOperationOwnershipError(error)) throw error;
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("setup_email_failed");
      return recordOperationFailure(
        dependencies,
        generated.operation,
        failure,
        "invite_pending",
        !sendOutcomeUnknown,
      );
    }
  }

  async function handOffToEmailOperation(
    operation: ProvisioningOperation,
  ): Promise<ProvisioningOperation> {
    const released = await releaseOperationOrFailUnknown(
      dependencies,
      operation,
    );
    return claim(released, "send_setup", false);
  }

  return {
    async get(id: string): Promise<PublicProvisioningJob> {
      const loaded = await loadValidatedJob(id);
      return publicJob(loaded.job, loaded.partner);
    },

    async create(
      input: CreatePartnerClientInput,
      adminId: string,
    ): Promise<ProvisioningRouteResponse> {
      let provisioningId: string | null = null;
      try {
        // Validate before inserting a durable provisioning job so stale,
        // disconnected, or malformed partner configuration leaves no job.
        validatePartner(await dependencies.loadPartner(input.partnerId));
        const loaded = await dependencies.createOrLoadJob(input, adminId);
        provisioningId = loaded.job.id;
        if (loaded.job.status === "dismissed") {
          throw errorFor("job_dismissed", 409);
        }
        assertJobMatchesInput(loaded.job, input);
        const startingStatus = loaded.job.status;
        let operation = await claim(loaded.job, "provision", false);
        const partnerForClaimedJob = await loadPartnerForOperation(operation);
        operation = await prepare(operation, adminId);

        if (input.sendSetupEmailNow) {
          if (!loaded.created && startingStatus === "setup_email_sent") {
            const job = await releaseOperationOrFailUnknown(
              dependencies,
              operation,
            );
            return { provisioning: publicJob(job, partnerForClaimedJob) };
          }
          const emailOperation = await handOffToEmailOperation(operation);
          return await finishEmailSetup(emailOperation);
        }

        // Manual setup URLs are deliberately memory-only. Every create/resume
        // request in manual mode generates a fresh URL so a lost response is
        // recoverable without storing the bearer token.
        return await finishManualSetup(operation);
      } catch (error) {
        throw provisioningId
          ? withProvisioningId(error, provisioningId)
          : error;
      }
    },

    async retry(
      id: string,
      input: RetryPartnerClientInput,
      adminId: string,
    ): Promise<ProvisioningRouteResponse> {
      try {
        const job = await loadJob(id);
        const startingStatus = job.status;
        let operation = await claim(job, "retry", true);
        const partner = await loadPartnerForOperation(operation);
        operation = await prepare(operation, adminId);
        if (input.sendSetupEmailNow) {
          if (startingStatus === "setup_email_sent") {
            const released = await releaseOperationOrFailUnknown(
              dependencies,
              operation,
            );
            return { provisioning: publicJob(released, partner) };
          }
          const emailOperation = await handOffToEmailOperation(operation);
          return await finishEmailSetup(emailOperation);
        }
        return await finishManualSetup(operation);
      } catch (error) {
        throw withProvisioningId(error, id);
      }
    },

    async sendSetup(
      id: string,
      adminId: string,
    ): Promise<SetupEmailRouteResponse> {
      try {
        const job = await loadJob(id);
        let operation = await claim(job, "send_setup", false);
        await loadPartnerForOperation(operation);
        operation = await prepare(operation, adminId);
        return await finishEmailSetup(operation);
      } catch (error) {
        throw withProvisioningId(error, id);
      }
    },
  };
}

function parseStoredJob(value: unknown): StoredProvisioningJob {
  return storedJobSchema.parse(value);
}

function parsePartner(value: unknown): ProvisioningPartner {
  const partner = partnerSchema.parse(value);
  return {
    ...partner,
    origin: partner.custom_domain ? `https://${partner.custom_domain}` : "",
  };
}

function authUser(user: User): ProvisioningAuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    appMetadata:
      user.app_metadata && typeof user.app_metadata === "object"
        ? user.app_metadata
        : {},
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505",
  );
}

function isEmailExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  return (
    code === "email_exists" ||
    /already (?:been )?registered|already exists/i.test(message)
  );
}

export function conciergeAuthCreatePayload(input: {
  email: string;
  password: string;
  provisioningId: string;
}) {
  return {
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: {
      concierge_provisioning_id: input.provisioningId,
      must_set_password: true,
    },
  } as const;
}

function rpcConflictCode(error: unknown): AssignmentErrorCode {
  const text =
    error && typeof error === "object"
      ? ["message", "details", "hint"]
          .map((key) =>
            key in error &&
            typeof (error as Record<string, unknown>)[key] === "string"
              ? (error as Record<string, string>)[key]
              : "",
          )
          .join(" ")
      : "";
  for (const code of [
    "business_not_found",
    "subscription_exists",
    "partner_required",
    "partner_inactive",
  ] as const) {
    if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  }
  return "assignment_failed";
}

function provisioningOperationError(error: unknown): ClientProvisioningError {
  const text =
    error && typeof error === "object"
      ? ["message", "details", "hint"]
          .map((key) =>
            key in error &&
            typeof (error as Record<string, unknown>)[key] === "string"
              ? (error as Record<string, string>)[key]
              : "",
          )
          .join(" ")
      : "";
  for (const code of [
    "job_dismissed",
    "provisioning_in_progress",
    "provisioning_outcome_unknown",
    "auth_identity_mismatch",
  ] as const) {
    if (new RegExp(`\\b${code}\\b`).test(text)) {
      return errorFor(code, 409);
    }
  }
  if (/\bprovisioning_job_not_found\b/.test(text)) {
    return errorFor("job_not_found", 404);
  }
  return errorFor("provisioning_outcome_unknown", 409);
}

const defaultDependencies: ClientProvisioningDependencies = {
  async createOrLoadJob(input, adminId) {
    const inserted = await supabaseAdmin
      .from("partner_client_provisioning_jobs")
      .insert({
        email: input.email,
        requested_business_name: input.businessName,
        partner_id: input.partnerId,
        billing_mode: input.billingMode,
        partner_plan: input.partnerPlan,
        created_by_admin_id: adminId,
      })
      .select(JOB_COLUMNS)
      .single();

    if (!inserted.error) {
      return { job: parseStoredJob(inserted.data), created: true };
    }
    if (!isUniqueViolation(inserted.error)) throw inserted.error;

    const existing = await supabaseAdmin
      .from("partner_client_provisioning_jobs")
      .select(JOB_COLUMNS)
      .eq("email", input.email)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw errorFor("provisioning_failed");
    return { job: parseStoredJob(existing.data), created: false };
  },

  async loadJobById(id) {
    const result = await supabaseAdmin
      .from("partner_client_provisioning_jobs")
      .select(JOB_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data ? parseStoredJob(result.data) : null;
  },

  async claimOperation(input) {
    const result = await supabaseAdmin.rpc(
      "claim_partner_client_provisioning_operation",
      {
        p_job_id: input.jobId,
        p_operation_kind: input.kind,
        p_operation_token: input.token,
        p_reconciled_operation_token: input.reconciledToken,
        p_now: input.now,
      },
    );
    if (result.error) throw provisioningOperationError(result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) throw errorFor("provisioning_outcome_unknown", 409);
    const job = parseStoredJob(row);
    if (
      job.id !== input.jobId ||
      job.operation_token !== input.token ||
      job.operation_kind !== input.kind
    ) {
      throw errorFor("provisioning_outcome_unknown", 409);
    }
    return job;
  },

  async updateJob(id, operationToken, patch, release) {
    const checkedAt = new Date().toISOString();
    const operationPatch = release
      ? {
          operation_token: null,
          operation_kind: null,
          operation_started_at: null,
          operation_expires_at: null,
        }
      : {
          operation_expires_at: new Date(
            Date.parse(checkedAt) + 15 * 60 * 1000,
          ).toISOString(),
        };
    const result = await supabaseAdmin
      .from("partner_client_provisioning_jobs")
      .update({ ...patch, ...operationPatch })
      .eq("id", id)
      .eq("operation_token", operationToken)
      .gt("operation_expires_at", checkedAt)
      .select(JOB_COLUMNS)
      .maybeSingle();
    if (result.error) {
      throw errorFor("provisioning_outcome_unknown", 409);
    }
    if (!result.data) {
      throw errorFor("provisioning_outcome_unknown", 409);
    }
    return parseStoredJob(result.data);
  },

  async loadPartner(id) {
    const result = await supabaseAdmin
      .from("partners")
      .select("id,name,custom_domain,status,domain_status")
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data ? parsePartner(result.data) : null;
  },

  async createAuthUser(input) {
    const result = await supabaseAdmin.auth.admin.createUser(
      conciergeAuthCreatePayload(input),
    );
    if (result.error) {
      return {
        status: isEmailExistsError(result.error) ? "email_exists" : "failed",
      };
    }
    return result.data.user
      ? { status: "created", user: authUser(result.data.user) }
      : { status: "failed" };
  },

  async findAuthUserByEmail(email) {
    let page = 1;
    let match: ProvisioningAuthUser | null = null;
    for (;;) {
      const result = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (result.error) throw result.error;
      const matches = result.data.users.filter(
        (user) => user.email?.trim().toLowerCase() === email,
      );
      if (matches.length > 1 || (matches.length === 1 && match !== null)) {
        throw errorFor("auth_identity_mismatch", 409);
      }
      if (matches.length === 1) match = authUser(matches[0]);
      if (!result.data.nextPage) return match;
      page = result.data.nextPage;
    }
  },

  async getAuthUserById(id) {
    const result = await supabaseAdmin.auth.admin.getUserById(id);
    if (result.error) throw result.error;
    return result.data.user ? authUser(result.data.user) : null;
  },

  async loadBusinessesByOwner(ownerId) {
    const result = await supabaseAdmin
      .from("businesses")
      .select(
        "id,owner_id,name,partner_id,billing_mode,partner_plan,deleted_at",
      )
      .eq("owner_id", ownerId)
      .is("deleted_at", null);
    if (result.error) throw result.error;
    return z.array(businessSchema).parse(result.data ?? []);
  },

  async updateBusinessName(businessId, ownerId, name) {
    const result = await supabaseAdmin
      .from("businesses")
      .update({ name })
      .eq("id", businessId)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .select("id")
      .single();
    if (result.error || result.data?.id !== businessId) {
      throw result.error ?? new Error("Business name update failed");
    }
  },

  async assignPartnerBilling(input) {
    const result = await supabaseAdmin.rpc("assign_business_partner_billing", {
      p_business_id: input.businessId,
      p_partner_id: input.partnerId,
      p_billing_mode: input.billingMode,
      p_actor_user_id: input.adminId,
      p_partner_plan: input.partnerPlan,
    });
    if (result.error) return { ok: false, code: rpcConflictCode(result.error) };
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (
      !row ||
      row.business_id !== input.businessId ||
      row.partner_id !== input.partnerId ||
      row.billing_mode !== input.billingMode ||
      row.partner_plan !== input.partnerPlan
    ) {
      return { ok: false, code: "assignment_failed" };
    }
    return { ok: true };
  },

  async generateRecoveryLink(input) {
    const result = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: input.email,
      options: { redirectTo: input.redirectTo },
    });
    if (result.error || !result.data.properties || !result.data.user) {
      throw result.error ?? new Error("Recovery link generation failed");
    }
    return {
      hashedToken: result.data.properties.hashed_token,
      verificationType: result.data.properties.verification_type,
      user: authUser(result.data.user),
    };
  },

  sendSetupEmail: sendConciergeSetupEmail,
  randomPassword: () => `${randomBytes(48).toString("base64url")}Aa1!`,
  randomOperationToken: () => randomUUID(),
  now: () => new Date().toISOString(),
};

const service = createClientProvisioningService(defaultDependencies);

export const getPublicPartnerClientProvisioningJob = service.get;
export const provisionPartnerClient = service.create;
export const retryPartnerClientProvisioning = service.retry;
export const sendPartnerClientSetupEmail = service.sendSetup;

export function isProvisioningId(value: string): boolean {
  return UUID.test(value);
}
