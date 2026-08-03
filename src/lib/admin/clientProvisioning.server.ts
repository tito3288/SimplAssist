import "server-only";

import { randomBytes } from "node:crypto";
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
  ]),
  last_error_code: z.string().nullable(),
  setup_email_sent_at: z.string().nullable(),
  invite_attempt_count: z.number().int().nonnegative(),
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
  partner_plan: z
    .enum(["sms_only", "sms_and_chat", "full"])
    .nullable(),
  deleted_at: z.string().nullable(),
});

type StoredProvisioningJob = z.infer<typeof storedJobSchema>;
type ProvisioningPartner = z.infer<typeof partnerSchema> & { origin: string };
type ProvisioningBusiness = z.infer<typeof businessSchema>;

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
  updateJob: (
    id: string,
    patch: JobPatch,
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
  findAuthUserByEmail: (
    email: string,
  ) => Promise<ProvisioningAuthUser | null>;
  getAuthUserById: (id: string) => Promise<ProvisioningAuthUser | null>;
  loadBusinessesByOwner: (
    ownerId: string,
  ) => Promise<ProvisioningBusiness[]>;
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
  now: () => string;
};

export type ClientProvisioningErrorCode =
  | "job_not_found"
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

function withProvisioningId(
  error: unknown,
  provisioningId: string,
): unknown {
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

function assertAuthIdentity(
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

async function bestEffortFailure(
  dependencies: ClientProvisioningDependencies,
  job: StoredProvisioningJob,
  code: ClientProvisioningErrorCode,
  status: "needs_attention" | "invite_pending" = "needs_attention",
): Promise<void> {
  try {
    await dependencies.updateJob(job.id, {
      status,
      last_error_code: code,
    });
  } catch {
    // Preserve the stage error. A failed durability update must not cause a
    // retry to attach a different Auth user or business.
  }
}

async function saveProgress(
  dependencies: ClientProvisioningDependencies,
  job: StoredProvisioningJob,
  status: "auth_created" | "business_prepared" | "assigned",
  patch: JobPatch = {},
): Promise<StoredProvisioningJob> {
  return dependencies.updateJob(job.id, {
    ...patch,
    ...(isTerminalStatus(job.status) ? {} : { status }),
    last_error_code: null,
  });
}

function validatePartner(partner: ProvisioningPartner | null): ProvisioningPartner {
  if (!partner || partner.status !== "active" || partner.domain_status !== "connected") {
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

export function createClientProvisioningService(
  dependencies: ClientProvisioningDependencies,
) {
  async function loadValidatedJob(id: string): Promise<{
    job: StoredProvisioningJob;
    partner: ProvisioningPartner;
  }> {
    const job = await dependencies.loadJobById(id);
    if (!job) throw errorFor("job_not_found", 404);
    try {
      const partner = validatePartner(
        await dependencies.loadPartner(job.partner_id),
      );
      return { job, partner };
    } catch (error) {
      throw withProvisioningId(error, job.id);
    }
  }

  async function ensureAuthUser(
    originalJob: StoredProvisioningJob,
  ): Promise<{ job: StoredProvisioningJob; user: ProvisioningAuthUser }> {
    let job = originalJob;
    let user: ProvisioningAuthUser | null = null;

    try {
      if (job.auth_user_id) {
        user = await dependencies.getAuthUserById(job.auth_user_id);
        if (!user) throw errorFor("auth_identity_mismatch", 409);
      } else {
        const result = await dependencies.createAuthUser({
          email: job.email,
          password: dependencies.randomPassword(),
          provisioningId: job.id,
        });

        if (result.status === "created") {
          user = result.user;
        } else if (result.status === "email_exists") {
          user = await dependencies.findAuthUserByEmail(job.email);
          if (!user) throw errorFor("email_in_use", 409);
          if (user.appMetadata.concierge_provisioning_id !== job.id) {
            throw errorFor("email_in_use", 409);
          }
        } else {
          throw errorFor("auth_creation_failed");
        }
      }

      assertAuthIdentity(user, job);
      if (job.auth_user_id !== null && job.auth_user_id !== user.id) {
        throw errorFor("auth_identity_mismatch", 409);
      }
      job = await saveProgress(dependencies, job, "auth_created", {
        auth_user_id: user.id,
      });
      return { job, user };
    } catch (error) {
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("auth_creation_failed");
      // A completed setup is an expected, terminal identity state. Do not
      // rewrite the durable job or continue into any business/link mutation.
      if (failure.code !== "setup_already_completed") {
        await bestEffortFailure(dependencies, job, failure.code);
      }
      throw failure;
    }
  }

  async function ensureBusiness(
    originalJob: StoredProvisioningJob,
    authUser: ProvisioningAuthUser,
  ): Promise<{ job: StoredProvisioningJob; business: ProvisioningBusiness }> {
    let job = originalJob;
    try {
      const business = validateRecoveredBusiness(
        await dependencies.loadBusinessesByOwner(authUser.id),
        job,
        authUser.id,
      );

      // The name write deliberately precedes assignment. A failed name write
      // leaves a resumable job and never creates a partially configured client.
      try {
        await dependencies.updateBusinessName(
          business.id,
          authUser.id,
          job.requested_business_name,
        );
      } catch {
        throw errorFor("business_update_failed");
      }

      job = await saveProgress(dependencies, job, "business_prepared", {
        business_id: business.id,
      });
      return { job, business: { ...business, name: job.requested_business_name } };
    } catch (error) {
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("provisioning_failed");
      await bestEffortFailure(dependencies, job, failure.code);
      throw failure;
    }
  }

  async function ensureAssignment(
    originalJob: StoredProvisioningJob,
    business: ProvisioningBusiness,
    adminId: string,
  ): Promise<StoredProvisioningJob> {
    const job = originalJob;
    try {
      const result = await dependencies.assignPartnerBilling({
        businessId: business.id,
        partnerId: job.partner_id,
        billingMode: job.billing_mode,
        partnerPlan: job.partner_plan,
        adminId,
      });
      if (!result.ok) {
        const status = result.code === "business_not_found" ? 404 :
          result.code === "assignment_failed" ? 500 : 409;
        throw errorFor(result.code, status);
      }
      return await saveProgress(dependencies, job, "assigned");
    } catch (error) {
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("assignment_failed");
      await bestEffortFailure(dependencies, job, failure.code);
      throw failure;
    }
  }

  async function prepare(
    job: StoredProvisioningJob,
    adminId: string,
  ): Promise<StoredProvisioningJob> {
    const auth = await ensureAuthUser(job);
    const preparedBusiness = await ensureBusiness(auth.job, auth.user);
    return ensureAssignment(preparedBusiness.job, preparedBusiness.business, adminId);
  }

  async function generateSetupUrl(
    originalJob: StoredProvisioningJob,
    partner: ProvisioningPartner,
  ): Promise<{ job: StoredProvisioningJob; setupUrl: string }> {
    // Re-authorize the recovery identity immediately before asking Supabase
    // for a bearer link. This catches a completed setup without changing the
    // job, incrementing attempts, or generating/resetting another recovery.
    if (!originalJob.auth_user_id) {
      throw errorFor("auth_identity_mismatch", 409);
    }
    const currentUser = await dependencies.getAuthUserById(
      originalJob.auth_user_id,
    );
    if (!currentUser) throw errorFor("auth_identity_mismatch", 409);
    assertAuthIdentity(currentUser, originalJob);
    if (currentUser.id !== originalJob.auth_user_id) {
      throw errorFor("auth_identity_mismatch", 409);
    }

    try {
      const callback = new URL("/api/auth/callback", partner.origin);
      const generated = await dependencies.generateRecoveryLink({
        email: originalJob.email,
        redirectTo: callback.toString(),
      });
      assertAuthIdentity(generated.user, originalJob);
      if (
        generated.user.id !== originalJob.auth_user_id ||
        generated.verificationType !== "recovery" ||
        !generated.hashedToken
      ) {
        throw errorFor("link_generation_failed");
      }

      callback.searchParams.set("token_hash", generated.hashedToken);
      callback.searchParams.set("type", "recovery");
      callback.searchParams.set("flow", "concierge");
      const job = await dependencies.updateJob(originalJob.id, {
        status: "invite_pending",
        last_error_code: null,
        invite_attempt_count: originalJob.invite_attempt_count + 1,
      });
      return { job, setupUrl: callback.toString() };
    } catch (error) {
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("link_generation_failed");
      // A generated response can reveal that setup completed between the
      // preflight read and link generation. Preserve the durable job exactly
      // in that race; the unused bearer URL is neither returned nor sent.
      if (failure.code !== "setup_already_completed") {
        try {
          await dependencies.updateJob(originalJob.id, {
            status: "invite_pending",
            last_error_code: failure.code,
            invite_attempt_count: originalJob.invite_attempt_count + 1,
          });
        } catch {
          // The original stage remains resumable even if failure recording is
          // unavailable. Never surface provider details to the route.
        }
      }
      throw failure;
    }
  }

  async function finishManualSetup(
    originalJob: StoredProvisioningJob,
    partner: ProvisioningPartner,
  ): Promise<ProvisioningRouteResponse> {
    const generated = await generateSetupUrl(originalJob, partner);
    const job = await dependencies.updateJob(generated.job.id, {
      status: "admin_setup",
      last_error_code: null,
    });
    return { provisioning: publicJob(job, partner), adminSetupUrl: generated.setupUrl };
  }

  async function finishEmailSetup(
    originalJob: StoredProvisioningJob,
    partner: ProvisioningPartner,
  ): Promise<SetupEmailRouteResponse> {
    const generated = await generateSetupUrl(originalJob, partner);
    try {
      if (!generated.job.business_id) {
        throw errorFor("business_identity_mismatch", 409);
      }
      await dependencies.sendSetupEmail({
        businessId: generated.job.business_id,
        businessName: generated.job.requested_business_name,
        recipient: generated.job.email,
        setupUrl: generated.setupUrl,
      });
      const job = await dependencies.updateJob(generated.job.id, {
        status: "setup_email_sent",
        last_error_code: null,
        setup_email_sent_at: dependencies.now(),
      });
      return { provisioning: publicJob(job, partner) };
    } catch (error) {
      const failure =
        error instanceof ClientProvisioningError
          ? error
          : errorFor("setup_email_failed");
      await bestEffortFailure(
        dependencies,
        generated.job,
        failure.code,
        "invite_pending",
      );
      throw failure;
    }
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
        const partner = validatePartner(
          await dependencies.loadPartner(input.partnerId),
        );
        const loaded = await dependencies.createOrLoadJob(input, adminId);
        provisioningId = loaded.job.id;
        assertJobMatchesInput(loaded.job, input);
        const startingStatus = loaded.job.status;
        const job = await prepare(loaded.job, adminId);

        if (input.sendSetupEmailNow) {
          if (!loaded.created && startingStatus === "setup_email_sent") {
            return { provisioning: publicJob(job, partner) };
          }
          return await finishEmailSetup(job, partner);
        }

        // Manual setup URLs are deliberately memory-only. Every create/resume
        // request in manual mode generates a fresh URL so a lost response is
        // recoverable without storing the bearer token.
        return await finishManualSetup(job, partner);
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
        const loaded = await loadValidatedJob(id);
        const startingStatus = loaded.job.status;
        const job = await prepare(loaded.job, adminId);
        if (input.sendSetupEmailNow) {
          if (startingStatus === "setup_email_sent") {
            return { provisioning: publicJob(job, loaded.partner) };
          }
          return await finishEmailSetup(job, loaded.partner);
        }
        return await finishManualSetup(job, loaded.partner);
      } catch (error) {
        throw withProvisioningId(error, id);
      }
    },

    async sendSetup(
      id: string,
      adminId: string,
    ): Promise<SetupEmailRouteResponse> {
      try {
        const loaded = await loadValidatedJob(id);
        const job = await prepare(loaded.job, adminId);
        return await finishEmailSetup(job, loaded.partner);
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
    error && typeof error === "object" && "code" in error && error.code === "23505",
  );
}

function isEmailExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  return code === "email_exists" || /already (?:been )?registered|already exists/i.test(message);
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
            key in error && typeof (error as Record<string, unknown>)[key] === "string"
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

  async updateJob(id, patch) {
    const result = await supabaseAdmin
      .from("partner_client_provisioning_jobs")
      .update(patch)
      .eq("id", id)
      .select(JOB_COLUMNS)
      .single();
    if (result.error) throw result.error;
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
      .select("id,owner_id,name,partner_id,billing_mode,partner_plan,deleted_at")
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
