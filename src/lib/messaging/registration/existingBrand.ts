import "server-only";

import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeUsStateCode } from "@/lib/usStates";
import type { BusinessEntityType } from "@/types/database";
import {
  compareExistingBrandIdentity,
  normalizeFiveDigitZip,
  normalizeLegalBusinessName,
  normalizeTelnyxEntityType,
  type ExistingBrandIdentityField,
  type ExistingBrandProviderIdentity,
  type TelnyxEntityTypeCategory,
} from "./identity";

export const TELNYX_BRAND_CAMPAIGN_CAP = 5;
export const TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE =
  "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link.";

export type ExistingBrandLinkErrorKind = "transient" | "permanent";
export type ExistingBrandLaunchDisposition =
  | "review_required"
  | "support_required";

export type ExistingBrandLinkErrorCode =
  | "existing_brand_invalid_request"
  | "existing_brand_invalid_tcr_brand_id"
  | "existing_brand_business_not_found"
  | "existing_brand_not_found"
  | "existing_brand_duplicate_match"
  | "existing_brand_provider_unavailable"
  | "existing_brand_provider_request_rejected"
  | "existing_brand_provider_response_invalid"
  | "existing_brand_provider_identity_changed"
  | "telnyx_brand_status_not_ok"
  | "telnyx_brand_identity_not_verified"
  | "telnyx_brand_country_not_us"
  | "telnyx_brand_mock_not_allowed"
  | "telnyx_brand_campaign_cap_reached"
  | "existing_brand_local_identity_incomplete"
  | "existing_brand_identity_mismatch"
  | "existing_brand_link_request_not_found"
  | "existing_brand_database_unavailable"
  | "existing_brand_link_business_not_available"
  | "existing_brand_link_already_consumed"
  | "existing_brand_link_already_approved_reset_first"
  | "existing_brand_link_resources_already_exist"
  | "existing_brand_link_brand_already_attached"
  | "existing_brand_link_brand_already_reserved"
  | "existing_brand_link_registration_already_submitted"
  | "existing_brand_link_identity_incomplete"
  | "existing_brand_link_not_ready_for_approval"
  | "existing_brand_link_provider_identity_changed"
  | "existing_brand_link_risk_review_not_cleared"
  | "existing_brand_link_identity_changed"
  | "existing_brand_link_cannot_reset_consumed"
  | "existing_brand_link_consumed_state_mismatch"
  | "existing_brand_link_launch_not_claimed"
  | "existing_brand_link_telnyx_submission_disabled"
  | "existing_brand_link_not_approved";

interface ExistingBrandErrorOptions {
  code: ExistingBrandLinkErrorCode;
  message?: string;
  httpStatus: 400 | 404 | 409 | 422 | 503;
  kind: ExistingBrandLinkErrorKind;
  mismatchedFields?: ExistingBrandIdentityField[];
  launchDisposition?: ExistingBrandLaunchDisposition;
}

/** A safe, stable error for server routes. It never contains provider payloads. */
export class ExistingBrandLinkError extends Error {
  readonly code: ExistingBrandLinkErrorCode;
  readonly httpStatus: 400 | 404 | 409 | 422 | 503;
  readonly kind: ExistingBrandLinkErrorKind;
  readonly mismatchedFields?: ExistingBrandIdentityField[];
  readonly launchDisposition?: ExistingBrandLaunchDisposition;

  constructor(options: ExistingBrandErrorOptions) {
    super(
      options.message ??
        (options.code === "telnyx_brand_campaign_cap_reached"
          ? TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE
          : "The existing Telnyx brand action could not be completed safely.")
    );
    this.name = "ExistingBrandLinkError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.kind = options.kind;
    this.mismatchedFields = options.mismatchedFields;
    this.launchDisposition = options.launchDisposition;
  }
}

export type ExistingBrandEligibilityCode =
  | "telnyx_brand_status_not_ok"
  | "telnyx_brand_identity_not_verified"
  | "telnyx_brand_country_not_us"
  | "telnyx_brand_mock_not_allowed"
  | "telnyx_brand_campaign_cap_reached";

export interface ExistingBrandPreview {
  tcrBrandId: string;
  legalName: string;
  entityTypeCategory: TelnyxEntityTypeCategory;
  state: string;
  zip: string;
  registrationStatus: "OK" | "REGISTRATION_PENDING" | "REGISTRATION_FAILED";
  identityStatus: "VERIFIED" | "UNVERIFIED" | "SELF_DECLARED" | "VETTED_VERIFIED";
  campaignCount: number;
  canStage: boolean;
  blockingCode: ExistingBrandEligibilityCode | null;
  blockingMessage: string | null;
}

export type ExistingBrandLinkStatus =
  | "pending_admin"
  | "approved"
  | "blocked"
  | "consumed";

export interface ExistingBrandLinkState {
  status: ExistingBrandLinkStatus;
  tcrBrandId: string;
  inspectedAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  lastErrorCode: string | null;
}

export interface ExistingBrandLinkResult {
  preview: ExistingBrandPreview;
  linkState: ExistingBrandLinkState;
}

interface InspectInput {
  businessId: string;
  tcrBrandId: string;
  actorUserId: string;
}

interface LinkActionInput {
  businessId: string;
  actorUserId: string;
}

interface ProviderBrand extends ExistingBrandProviderIdentity {
  brandId?: string | null;
  tcrBrandId?: string | null;
  country?: string | null;
  status?: string | null;
  identityStatus?: string | null;
  mock?: boolean | null;
  assignedCampaignsCount?: number | null;
}

interface ProviderBrandMatch {
  tcrBrandId: string;
  telnyxBrandId: string;
  brand: ProviderBrand;
  preview: ExistingBrandPreview;
}

interface LocalIdentityRow {
  id: string;
  has_ein: boolean | null;
  ein: string | null;
  legal_business_name: string | null;
  business_entity_type: BusinessEntityType | null;
  business_registration_state: string | null;
  state: string | null;
  zip: string | null;
}

interface PrivateLinkRequestRow {
  id: string;
  business_id: string;
  tcr_brand_id: string;
  telnyx_brand_id: string;
  status: ExistingBrandLinkStatus;
  identity_fingerprint: string | null;
  inspected_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  last_error_code: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TCR_BRAND_ID_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const ELIGIBILITY_MESSAGES: Record<ExistingBrandEligibilityCode, string> = {
  telnyx_brand_status_not_ok:
    "This Telnyx brand is not active and cannot be linked yet.",
  telnyx_brand_identity_not_verified:
    "This Telnyx brand has not completed identity verification and cannot be linked yet.",
  telnyx_brand_country_not_us:
    "Only a United States Telnyx brand can be linked to this SimplAssist registration.",
  telnyx_brand_mock_not_allowed:
    "A mock Telnyx brand cannot be linked to a live SimplAssist registration.",
  telnyx_brand_campaign_cap_reached: TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE,
};

function permanentError(
  code: ExistingBrandLinkErrorCode,
  message: string,
  httpStatus: 400 | 404 | 409 | 422,
  mismatchedFields?: ExistingBrandIdentityField[]
): ExistingBrandLinkError {
  return new ExistingBrandLinkError({
    code,
    message,
    httpStatus,
    kind: "permanent",
    mismatchedFields,
  });
}

function transientError(
  code: ExistingBrandLinkErrorCode,
  message: string
): ExistingBrandLinkError {
  return new ExistingBrandLinkError({
    code,
    message,
    httpStatus: 503,
    kind: "transient",
  });
}

function normalizeTcrBrandId(value: string): string {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !TCR_BRAND_ID_PATTERN.test(normalized)) {
    throw permanentError(
      "existing_brand_invalid_tcr_brand_id",
      "Enter a valid Telnyx TCR Brand ID.",
      400
    );
  }
  return normalized;
}

function assertActionInput(input: LinkActionInput): void {
  if (!input.businessId?.trim() || !input.actorUserId?.trim()) {
    throw permanentError(
      "existing_brand_invalid_request",
      "The existing-brand request is incomplete.",
      400
    );
  }
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : null;
}

function mapProviderError(error: unknown): ExistingBrandLinkError {
  if (error instanceof ExistingBrandLinkError) return error;
  const status = providerStatus(error);
  if (status === 404) {
    return permanentError(
      "existing_brand_not_found",
      "No Telnyx brand with that TCR Brand ID was found in SimplAssist's Telnyx account.",
      404
    );
  }
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    // A read-time 4xx can reflect credentials, provider configuration,
    // conflict, or a temporary validation rule. It is not a deterministic
    // finding about the saved brand identity, so launch must not block an
    // approved request on this signal. Exact 404 remains the one permanent
    // case above because the requested brand itself was not found.
    return transientError(
      "existing_brand_provider_request_rejected",
      "Telnyx could not inspect this brand right now. No link changes were made; try again or contact SimplAssist Support."
    );
  }
  return transientError(
    "existing_brand_provider_unavailable",
    "Telnyx is temporarily unavailable. Try inspecting the brand again shortly."
  );
}

function invalidProviderResponse(): ExistingBrandLinkError {
  return transientError(
    "existing_brand_provider_response_invalid",
    "Telnyx returned an incomplete brand record. Try again or contact SimplAssist Support."
  );
}

function eligibilityError(
  brand: ProviderBrand,
  campaignCount: number
): ExistingBrandLinkError | null {
  if (brand.status !== "OK") {
    return permanentError(
      "telnyx_brand_status_not_ok",
      ELIGIBILITY_MESSAGES.telnyx_brand_status_not_ok,
      422
    );
  }
  if (
    brand.identityStatus !== "VERIFIED" &&
    brand.identityStatus !== "VETTED_VERIFIED"
  ) {
    return permanentError(
      "telnyx_brand_identity_not_verified",
      ELIGIBILITY_MESSAGES.telnyx_brand_identity_not_verified,
      422
    );
  }
  if (brand.country?.trim().toUpperCase() !== "US") {
    return permanentError(
      "telnyx_brand_country_not_us",
      ELIGIBILITY_MESSAGES.telnyx_brand_country_not_us,
      422
    );
  }
  // Telnyx marks test brands explicitly. The SDK field is optional for real
  // brands, so omission is eligible while an explicit `true` is not.
  if (brand.mock === true) {
    return permanentError(
      "telnyx_brand_mock_not_allowed",
      ELIGIBILITY_MESSAGES.telnyx_brand_mock_not_allowed,
      422
    );
  }
  if (campaignCount >= TELNYX_BRAND_CAMPAIGN_CAP) {
    return permanentError(
      "telnyx_brand_campaign_cap_reached",
      TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE,
      422
    );
  }
  return null;
}

function buildPreview(
  tcrBrandId: string,
  brand: ProviderBrand
): ExistingBrandPreview {
  const legalName = normalizeLegalBusinessName(brand.companyName);
  const entityTypeCategory = normalizeTelnyxEntityType(brand.entityType);
  const state = normalizeUsStateCode(brand.state);
  const zip = normalizeFiveDigitZip(brand.postalCode);
  const campaignCount = brand.assignedCampaignsCount;
  const validStatus =
    brand.status === "OK" ||
    brand.status === "REGISTRATION_PENDING" ||
    brand.status === "REGISTRATION_FAILED";
  const validIdentityStatus =
    brand.identityStatus === "VERIFIED" ||
    brand.identityStatus === "UNVERIFIED" ||
    brand.identityStatus === "SELF_DECLARED" ||
    brand.identityStatus === "VETTED_VERIFIED";

  if (
    !legalName ||
    !entityTypeCategory ||
    !state ||
    !zip ||
    !validStatus ||
    !validIdentityStatus ||
    !Number.isInteger(campaignCount) ||
    campaignCount === null ||
    campaignCount === undefined ||
    campaignCount < 0
  ) {
    throw invalidProviderResponse();
  }

  const blocked = eligibilityError(brand, campaignCount);
  const blockingCode = blocked?.code as ExistingBrandEligibilityCode | undefined;

  return {
    tcrBrandId,
    legalName,
    entityTypeCategory,
    state,
    zip,
    registrationStatus: brand.status as ExistingBrandPreview["registrationStatus"],
    identityStatus: brand.identityStatus as ExistingBrandPreview["identityStatus"],
    campaignCount,
    canStage: !blocked,
    blockingCode: blockingCode ?? null,
    blockingMessage: blocked?.message ?? null,
  };
}

async function fetchProviderBrand(tcrBrandIdInput: string): Promise<ProviderBrandMatch> {
  const tcrBrandId = normalizeTcrBrandId(tcrBrandIdInput);

  try {
    const matches: Array<{ brandId: string }> = [];
    const listedBrands = telnyx.messaging10dlc.brand.list({
      tcrBrandId,
      recordsPerPage: 2,
    });

    for await (const listed of listedBrands) {
      if (listed.tcrBrandId?.trim().toUpperCase() !== tcrBrandId) continue;
      if (!listed.brandId || !UUID_PATTERN.test(listed.brandId.trim())) {
        throw invalidProviderResponse();
      }
      matches.push({ brandId: listed.brandId.trim().toLowerCase() });
    }

    if (matches.length === 0) {
      throw permanentError(
        "existing_brand_not_found",
        "No Telnyx brand with that TCR Brand ID was found in SimplAssist's Telnyx account.",
        404
      );
    }
    if (matches.length > 1) {
      throw permanentError(
        "existing_brand_duplicate_match",
        "More than one Telnyx brand matched that TCR Brand ID. Contact SimplAssist Support before continuing.",
        409
      );
    }

    const telnyxBrandId = matches[0].brandId;
    const retrieved = (await telnyx.messaging10dlc.brand.retrieve(
      telnyxBrandId
    )) as ProviderBrand;

    if (
      retrieved.tcrBrandId?.trim().toUpperCase() !== tcrBrandId ||
      !retrieved.brandId ||
      !UUID_PATTERN.test(retrieved.brandId.trim()) ||
      retrieved.brandId.trim().toLowerCase() !== telnyxBrandId
    ) {
      throw permanentError(
        "existing_brand_provider_identity_changed",
        "The Telnyx brand identity changed during inspection. Inspect it again before continuing.",
        409
      );
    }

    return {
      tcrBrandId,
      telnyxBrandId,
      brand: retrieved,
      preview: buildPreview(tcrBrandId, retrieved),
    };
  } catch (error) {
    throw mapProviderError(error);
  }
}

function assertProviderEligible(match: ProviderBrandMatch): void {
  if (!match.preview.canStage && match.preview.blockingCode) {
    throw permanentError(
      match.preview.blockingCode,
      match.preview.blockingMessage ?? "This Telnyx brand cannot be linked.",
      422
    );
  }
}

async function readLocalIdentity(businessId: string): Promise<LocalIdentityRow> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, has_ein, ein, legal_business_name, business_entity_type, business_registration_state, state, zip"
    )
    .eq("id", businessId)
    .maybeSingle<LocalIdentityRow>();

  if (error) {
    throw transientError(
      "existing_brand_database_unavailable",
      "SimplAssist could not read the business identity. Try again shortly."
    );
  }
  if (!data) {
    throw permanentError(
      "existing_brand_business_not_found",
      "The SimplAssist business could not be found.",
      404
    );
  }
  return data;
}

function assertLocalIdentityMatches(
  provider: ProviderBrand,
  local: LocalIdentityRow
): void {
  if (
    local.has_ein !== true ||
    !local.ein ||
    !local.legal_business_name?.trim() ||
    !local.business_entity_type ||
    !normalizeUsStateCode(local.business_registration_state) ||
    !normalizeUsStateCode(local.state) ||
    !normalizeFiveDigitZip(local.zip)
  ) {
    throw permanentError(
      "existing_brand_local_identity_incomplete",
      "Complete the business legal information before staging this Telnyx brand link.",
      422
    );
  }

  const comparison = compareExistingBrandIdentity(provider, local);
  if (!comparison.matches) {
    throw permanentError(
      "existing_brand_identity_mismatch",
      "The Telnyx brand does not match the business's saved legal information. Review the EIN, legal name, entity type, address state, and ZIP before trying again.",
      422,
      comparison.mismatchedFields
    );
  }
}

async function recordInspection(
  input: InspectInput,
  match: ProviderBrandMatch,
  outcomeCode: string
): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "record_existing_telnyx_brand_inspection",
    {
      p_business_id: input.businessId,
      p_tcr_brand_id: match.tcrBrandId,
      p_telnyx_brand_id: match.telnyxBrandId,
      p_outcome_code: outcomeCode,
      p_actor_user_id: input.actorUserId,
    }
  );
  if (error) throw mapRpcError(error);
}

function projectLinkState(row: PrivateLinkRequestRow): ExistingBrandLinkState {
  if (
    !row ||
    !TCR_BRAND_ID_PATTERN.test(row.tcr_brand_id) ||
    !["pending_admin", "approved", "blocked", "consumed"].includes(row.status) ||
    !row.inspected_at
  ) {
    throw transientError(
      "existing_brand_database_unavailable",
      "SimplAssist returned an invalid existing-brand link state. Try again shortly."
    );
  }
  return {
    status: row.status,
    tcrBrandId: row.tcr_brand_id,
    inspectedAt: row.inspected_at,
    approvedAt: row.approved_at,
    consumedAt: row.consumed_at,
    lastErrorCode: row.last_error_code,
  };
}

function rpcErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  return message.match(/existing_brand_link_[a-z0-9_]+/)?.[0] ?? null;
}

const RPC_ERROR_DETAILS: Partial<
  Record<
    ExistingBrandLinkErrorCode,
    { message: string; status: 404 | 409 | 422 }
  >
> = {
  existing_brand_link_business_not_available: {
    message: "The SimplAssist business is no longer available.",
    status: 404,
  },
  existing_brand_link_already_consumed: {
    message: "This Telnyx brand link has already been used and cannot be changed.",
    status: 409,
  },
  existing_brand_link_already_approved_reset_first: {
    message: "Reset the approved Telnyx brand link before staging a different brand.",
    status: 409,
  },
  existing_brand_link_resources_already_exist: {
    message: "This business already has carrier resources and cannot link an existing brand.",
    status: 409,
  },
  existing_brand_link_brand_already_attached: {
    message: "This Telnyx brand is already attached to another SimplAssist business.",
    status: 409,
  },
  existing_brand_link_brand_already_reserved: {
    message: "This Telnyx brand is already reserved for another SimplAssist business.",
    status: 409,
  },
  existing_brand_link_registration_already_submitted: {
    message: "Carrier registration has already started for this business.",
    status: 409,
  },
  existing_brand_link_identity_incomplete: {
    message: "Complete the business legal information before staging this Telnyx brand link.",
    status: 422,
  },
  existing_brand_link_request_not_found: {
    message: "No staged Telnyx brand link exists for this business.",
    status: 404,
  },
  existing_brand_link_not_ready_for_approval: {
    message: "This Telnyx brand link is not ready for approval.",
    status: 409,
  },
  existing_brand_link_provider_identity_changed: {
    message: "The staged Telnyx brand identity changed. Inspect and stage it again.",
    status: 409,
  },
  existing_brand_link_risk_review_not_cleared: {
    message: "The business risk review must be cleared before this brand link can be approved.",
    status: 409,
  },
  existing_brand_link_identity_changed: {
    message: "The business legal identity changed. Inspect, stage, and approve the link again.",
    status: 409,
  },
  existing_brand_link_cannot_reset_consumed: {
    message: "A consumed Telnyx brand link cannot be reset.",
    status: 409,
  },
  existing_brand_link_consumed_state_mismatch: {
    message:
      "The consumed Telnyx brand link no longer matches the business carrier state.",
    status: 409,
  },
  existing_brand_link_launch_not_claimed: {
    message: "Carrier launch was not safely claimed for this business.",
    status: 409,
  },
  existing_brand_link_telnyx_submission_disabled: {
    message: "Carrier submission is disabled for this business.",
    status: 409,
  },
  existing_brand_link_not_approved: {
    message: "This existing Telnyx brand link is not approved for launch.",
    status: 409,
  },
};

function mapRpcError(error: unknown): ExistingBrandLinkError {
  const code = rpcErrorCode(error) as ExistingBrandLinkErrorCode | null;
  const detail = code ? RPC_ERROR_DETAILS[code] : undefined;
  if (code && detail) {
    return permanentError(code, detail.message, detail.status);
  }
  return transientError(
    "existing_brand_database_unavailable",
    "SimplAssist could not update the existing-brand link. Try again shortly."
  );
}

function rpcRow(data: unknown): PrivateLinkRequestRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw transientError(
      "existing_brand_database_unavailable",
      "SimplAssist returned an invalid existing-brand link state. Try again shortly."
    );
  }
  return row as PrivateLinkRequestRow;
}

async function readPrivateLinkRequest(
  businessId: string
): Promise<PrivateLinkRequestRow | null> {
  const { data, error } = await supabaseAdmin
    .from("telnyx_brand_link_requests")
    .select(
      "id, business_id, tcr_brand_id, telnyx_brand_id, status, identity_fingerprint, inspected_at, approved_at, consumed_at, last_error_code"
    )
    .eq("business_id", businessId)
    .maybeSingle<PrivateLinkRequestRow>();

  if (error) {
    throw transientError(
      "existing_brand_database_unavailable",
      "SimplAssist could not read the existing-brand link. Try again shortly."
    );
  }
  return data ?? null;
}

async function validateRequestAgainstProviderAndLocal(
  businessId: string,
  request: PrivateLinkRequestRow,
  options: { allowCampaignCap?: boolean } = {}
): Promise<ProviderBrandMatch> {
  if (
    !UUID_PATTERN.test(request.telnyx_brand_id) ||
    !request.identity_fingerprint ||
    !FINGERPRINT_PATTERN.test(request.identity_fingerprint)
  ) {
    throw transientError(
      "existing_brand_database_unavailable",
      "SimplAssist returned an invalid existing-brand link state. Try again shortly."
    );
  }

  const match = await fetchProviderBrand(request.tcr_brand_id);
  if (match.telnyxBrandId !== request.telnyx_brand_id.toLowerCase()) {
    throw permanentError(
      "existing_brand_provider_identity_changed",
      "The Telnyx brand identity changed after inspection. Inspect and stage it again.",
      409
    );
  }
  if (
    !options.allowCampaignCap ||
    match.preview.blockingCode !== "telnyx_brand_campaign_cap_reached"
  ) {
    assertProviderEligible(match);
  }
  const local = await readLocalIdentity(businessId);
  assertLocalIdentityMatches(match.brand, local);
  return match;
}

/**
 * Stateless provider inspection. Local legal information may still be blank;
 * the only database write is a PII-free inspection event, never a link request.
 */
export async function inspectExistingTelnyxBrand(
  input: InspectInput
): Promise<ExistingBrandPreview> {
  assertActionInput(input);
  const match = await fetchProviderBrand(input.tcrBrandId);
  await recordInspection(
    input,
    match,
    match.preview.blockingCode ?? "eligible"
  );
  return match.preview;
}

export async function stageExistingTelnyxBrandLink(
  input: InspectInput
): Promise<ExistingBrandLinkResult> {
  assertActionInput(input);
  const match = await fetchProviderBrand(input.tcrBrandId);
  assertProviderEligible(match);
  const local = await readLocalIdentity(input.businessId);
  assertLocalIdentityMatches(match.brand, local);
  await recordInspection(input, match, "eligible_identity_match");

  const { data, error } = await supabaseAdmin.rpc(
    "stage_existing_telnyx_brand_link",
    {
      p_business_id: input.businessId,
      p_tcr_brand_id: match.tcrBrandId,
      p_telnyx_brand_id: match.telnyxBrandId,
      p_actor_user_id: input.actorUserId,
    }
  );
  if (error) throw mapRpcError(error);

  return {
    preview: match.preview,
    linkState: projectLinkState(rpcRow(data)),
  };
}

export async function approveExistingTelnyxBrandLink(
  input: LinkActionInput
): Promise<ExistingBrandLinkResult> {
  assertActionInput(input);
  const request = await readPrivateLinkRequest(input.businessId);
  if (!request) {
    throw permanentError(
      "existing_brand_link_request_not_found",
      "No staged Telnyx brand link exists for this business.",
      404
    );
  }

  const match = await validateRequestAgainstProviderAndLocal(
    input.businessId,
    request
  );

  const { data, error } = await supabaseAdmin.rpc(
    "approve_existing_telnyx_brand_link",
    {
      p_business_id: input.businessId,
      p_expected_tcr_brand_id: request.tcr_brand_id,
      p_expected_telnyx_brand_id: request.telnyx_brand_id,
      p_expected_identity_fingerprint: request.identity_fingerprint,
      p_actor_user_id: input.actorUserId,
    }
  );
  if (error) throw mapRpcError(error);

  return {
    preview: match.preview,
    linkState: projectLinkState(rpcRow(data)),
  };
}

export async function resetExistingTelnyxBrandLink(
  input: LinkActionInput
): Promise<ExistingBrandLinkState> {
  assertActionInput(input);
  const { data, error } = await supabaseAdmin.rpc(
    "reset_existing_telnyx_brand_link",
    {
      p_business_id: input.businessId,
      p_actor_user_id: input.actorUserId,
    }
  );
  if (error) throw mapRpcError(error);
  return projectLinkState(rpcRow(data));
}

export async function getExistingTelnyxBrandLinkState(
  businessId: string
): Promise<ExistingBrandLinkState | null> {
  if (!businessId?.trim()) {
    throw permanentError(
      "existing_brand_invalid_request",
      "The existing-brand request is incomplete.",
      400
    );
  }
  const request = await readPrivateLinkRequest(businessId);
  return request ? projectLinkState(request) : null;
}

/**
 * Launch-safe provider/local revalidation. It deliberately returns only the
 * redacted preview; a later consume wrapper must reread the private request and
 * pass its expected IDs/fingerprint directly to the guarded consume RPC.
 */
export async function revalidateApprovedExistingTelnyxBrandLink(
  businessId: string
): Promise<ExistingBrandPreview> {
  const request = await readPrivateLinkRequest(businessId);
  if (!request || request.status !== "approved") {
    throw permanentError(
      "existing_brand_link_not_ready_for_approval",
      "This Telnyx brand link is not approved for launch.",
      409
    );
  }
  const match = await validateRequestAgainstProviderAndLocal(
    businessId,
    request
  );
  return match.preview;
}

export type ExistingBrandLaunchPreparation =
  | { status: "not_requested" }
  | {
      status: "consumed";
      preview: ExistingBrandPreview;
      linkState: ExistingBrandLinkState;
    };

const PAID_LAUNCH_ACTOR = "system:paid_launch";

function withLaunchDisposition(
  error: ExistingBrandLinkError,
  launchDisposition: ExistingBrandLaunchDisposition
): ExistingBrandLinkError {
  return new ExistingBrandLinkError({
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    kind: error.kind,
    mismatchedFields: error.mismatchedFields,
    launchDisposition,
  });
}

async function blockCapturedLinkRequest(
  request: PrivateLinkRequestRow,
  reasonCode: ExistingBrandLinkErrorCode
): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "block_existing_telnyx_brand_link",
    {
      p_business_id: request.business_id,
      p_expected_tcr_brand_id: request.tcr_brand_id,
      p_expected_telnyx_brand_id: request.telnyx_brand_id,
      p_expected_identity_fingerprint: request.identity_fingerprint,
      p_reason_code: reasonCode,
      p_actor_user_id: PAID_LAUNCH_ACTOR,
    }
  );
  if (error) throw mapRpcError(error);
}

/**
 * Prepare a manually linked brand for launch without a revalidation/consume
 * substitution window. One private request tuple is captured, provider and
 * local identity are checked against that tuple, and the exact same IDs and
 * fingerprint are passed to the atomic consume RPC. A concurrently restaged
 * brand therefore fails the expected-value guard instead of being consumed.
 *
 * Permanent failures block the same captured approved request. Transient
 * provider/database failures leave it approved and retryable. A consumed
 * retry remains immutable and is marked support-required on deterministic
 * drift. Campaign-cap eligibility is deferred only for consumed retries so
 * campaign recovery can adopt a campaign created before a prior save failed.
 */
export async function prepareExistingTelnyxBrandLinkForLaunch(
  businessId: string
): Promise<ExistingBrandLaunchPreparation> {
  if (!businessId?.trim()) {
    throw permanentError(
      "existing_brand_invalid_request",
      "The existing-brand request is incomplete.",
      400
    );
  }

  const request = await readPrivateLinkRequest(businessId);
  if (!request) return { status: "not_requested" };

  if (request.status === "pending_admin" || request.status === "blocked") {
    throw withLaunchDisposition(
      permanentError(
        "existing_brand_link_not_ready_for_approval",
        "This existing Telnyx brand link needs administrator approval before launch.",
        409
      ),
      "review_required"
    );
  }

  const wasConsumed = request.status === "consumed";
  let match: ProviderBrandMatch;
  try {
    match = await validateRequestAgainstProviderAndLocal(businessId, request, {
      allowCampaignCap: wasConsumed,
    });
  } catch (error) {
    const mapped =
      error instanceof ExistingBrandLinkError ? error : mapProviderError(error);
    if (mapped.kind === "transient") throw mapped;

    if (wasConsumed) {
      throw withLaunchDisposition(mapped, "support_required");
    }

    try {
      await blockCapturedLinkRequest(request, mapped.code);
    } catch (blockError) {
      const mappedBlock =
        blockError instanceof ExistingBrandLinkError
          ? blockError
          : mapRpcError(blockError);
      if (mappedBlock.kind === "transient") throw mappedBlock;
      throw withLaunchDisposition(mappedBlock, "review_required");
    }
    throw withLaunchDisposition(mapped, "review_required");
  }

  const { data, error } = await supabaseAdmin.rpc(
    "consume_existing_telnyx_brand_link",
    {
      p_business_id: businessId,
      p_expected_tcr_brand_id: request.tcr_brand_id,
      p_expected_telnyx_brand_id: request.telnyx_brand_id,
      p_expected_identity_fingerprint: request.identity_fingerprint,
      p_actor_user_id: PAID_LAUNCH_ACTOR,
    }
  );
  if (error) {
    const mapped = mapRpcError(error);
    if (mapped.kind === "transient") throw mapped;
    throw withLaunchDisposition(
      mapped,
      wasConsumed ? "support_required" : "review_required"
    );
  }

  return {
    status: "consumed",
    preview: match.preview,
    linkState: projectLinkState(rpcRow(data)),
  };
}
