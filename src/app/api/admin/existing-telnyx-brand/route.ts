import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import {
  approveExistingTelnyxBrandLink,
  ExistingBrandLinkError,
  inspectExistingTelnyxBrand,
  resetExistingTelnyxBrandLink,
  stageExistingTelnyxBrandLink,
  type ExistingBrandLinkState,
  type ExistingBrandPreview,
} from "@/lib/messaging/registration/existingBrand";

const businessIdSchema = z.string().uuid();
const tcrBrandIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{1,64}$/));

const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("inspect"),
      businessId: businessIdSchema,
      tcrBrandId: tcrBrandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("stage"),
      businessId: businessIdSchema,
      tcrBrandId: tcrBrandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      businessId: businessIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reset"),
      businessId: businessIdSchema,
    })
    .strict(),
]);

const CAMPAIGN_CAP_MESSAGE =
  "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link.";

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  telnyx_brand_campaign_cap_reached: CAMPAIGN_CAP_MESSAGE,
  existing_brand_invalid_request:
    "The existing-brand request is incomplete.",
  existing_brand_invalid_tcr_brand_id:
    "Enter a valid Telnyx TCR brand ID.",
  existing_brand_business_not_found:
    "The SimplAssist business could not be found.",
  existing_brand_not_found:
    "No matching brand was found in SimplAssist's Telnyx account. Check the TCR brand ID and try again.",
  existing_brand_duplicate_match:
    "More than one Telnyx brand matched this TCR brand ID. Contact SimplAssist Support before continuing.",
  existing_brand_provider_request_rejected:
    "Telnyx could not inspect this brand. Verify the TCR brand ID or contact SimplAssist Support.",
  existing_brand_provider_response_invalid:
    "Telnyx returned an incomplete brand record. Try again or contact SimplAssist Support.",
  existing_brand_provider_identity_changed:
    "The Telnyx brand identity changed during inspection. Inspect it again before continuing.",
  telnyx_brand_status_not_ok:
    "This Telnyx brand is not active and cannot be linked yet.",
  telnyx_brand_identity_not_verified:
    "This Telnyx brand has not completed identity verification and cannot be linked yet.",
  telnyx_brand_country_not_us:
    "Only a United States Telnyx brand can be linked to this SimplAssist registration.",
  telnyx_brand_mock_not_allowed:
    "A mock Telnyx brand cannot be linked to a live SimplAssist registration.",
  existing_brand_local_identity_incomplete:
    "Complete the business legal information before staging this Telnyx brand link.",
  existing_brand_identity_mismatch:
    "The onboarding legal information does not match this Telnyx brand. Compare the inspected preview with the onboarding details and try again.",
  existing_brand_link_identity_incomplete:
    "Complete the business legal information before staging this brand.",
  existing_brand_link_identity_changed:
    "The business legal information changed after this link was staged. Inspect and stage the brand again before approval.",
  existing_brand_link_provider_identity_changed:
    "The Telnyx brand no longer matches the staged inspection. Reset and inspect the brand again.",
  existing_brand_link_resources_already_exist:
    "This account already has Telnyx resources, so an existing brand cannot be linked.",
  existing_brand_link_brand_already_attached:
    "This Telnyx brand is already connected to another SimplAssist account.",
  existing_brand_link_brand_already_reserved:
    "This Telnyx brand is already reserved for another SimplAssist account.",
  existing_brand_link_registration_already_submitted:
    "Registration has already started for this account, so the existing brand cannot be staged.",
  existing_brand_link_risk_review_not_cleared:
    "The A2P risk review must pass or be approved before this brand link can be approved.",
  existing_brand_link_request_not_found:
    "No staged brand link was found for this account.",
  existing_brand_link_not_ready_for_approval:
    "This brand link is not ready for approval. Inspect and stage it again.",
  existing_brand_link_already_approved_reset_first:
    "This brand link is already approved. Reset it before staging a different brand.",
  existing_brand_link_already_consumed:
    "This brand link has already been connected and cannot be changed.",
  existing_brand_link_business_not_available:
    "This business is not available for an existing-brand link.",
  existing_brand_link_cannot_reset_consumed:
    "This brand link has already been connected and cannot be reset.",
  existing_brand_provider_unavailable:
    "Telnyx could not be reached. No link changes were made; try again shortly.",
  existing_brand_database_unavailable:
    "SimplAssist could not safely read or update the brand link. Try again shortly.",
};

const DEFAULT_ERROR_MESSAGE =
  "The existing Telnyx brand action could not be completed safely.";

export async function POST(request: NextRequest) {
  // Authorization deliberately runs before JSON parsing, database access, or
  // provider inspection. The admin surface stays indistinguishable from a
  // missing route for every non-admin caller.
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid brand-link request" }, { status: 400 });
  }

  const { action, businessId } = parsed.data;
  const actorUserId = admin.id;

  try {
    switch (action) {
      case "inspect": {
        const preview = await inspectExistingTelnyxBrand({
          businessId,
          tcrBrandId: parsed.data.tcrBrandId,
          actorUserId,
        });
        return NextResponse.json({
          success: true,
          action,
          preview: projectPreview(preview),
        });
      }
      case "stage": {
        const result = await stageExistingTelnyxBrandLink({
          businessId,
          tcrBrandId: parsed.data.tcrBrandId,
          actorUserId,
        });
        return NextResponse.json({
          success: true,
          action,
          preview: projectPreview(result.preview),
          linkState: projectLinkState(result.linkState),
        });
      }
      case "approve": {
        const result = await approveExistingTelnyxBrandLink({
          businessId,
          actorUserId,
        });
        return NextResponse.json({
          success: true,
          action,
          preview: projectPreview(result.preview),
          linkState: projectLinkState(result.linkState),
        });
      }
      case "reset": {
        const linkState = await resetExistingTelnyxBrandLink({
          businessId,
          actorUserId,
        });
        return NextResponse.json({
          success: true,
          action,
          linkState: projectLinkState(linkState),
        });
      }
    }
  } catch (error) {
    const safeError = toSafeRouteError(error);
    console.error("[admin:existing-brand-link] Action failed", {
      action,
      businessId,
      code: safeError.code,
    });
    return NextResponse.json(
      { error: safeError.message, code: safeError.code },
      { status: safeError.status }
    );
  }
}

/**
 * This is an intentional browser-response allowlist. Do not spread a provider
 * response or a database row here: EINs, contacts, the Telnyx internal UUID,
 * the identity fingerprint, and raw response data must remain server-only.
 */
function projectPreview(preview: ExistingBrandPreview) {
  const sourceBlockingCode = preview.blockingCode ?? null;
  const blockingCode = sourceBlockingCode
    ? SAFE_ERROR_MESSAGES[sourceBlockingCode]
      ? sourceBlockingCode
      : "existing_brand_not_eligible"
    : null;
  return {
    tcrBrandId: preview.tcrBrandId,
    legalName: preview.legalName,
    entityTypeCategory: preview.entityTypeCategory,
    state: preview.state,
    zip: preview.zip,
    registrationStatus: preview.registrationStatus,
    identityStatus: preview.identityStatus,
    campaignCount: preview.campaignCount,
    canStage: preview.canStage,
    blockingCode,
    blockingMessage: blockingCode
      ? SAFE_ERROR_MESSAGES[blockingCode] ??
        "This Telnyx brand is not eligible to be staged."
      : null,
  };
}

function projectLinkState(linkState: ExistingBrandLinkState) {
  return {
    status: linkState.status,
    tcrBrandId: linkState.tcrBrandId,
    inspectedAt: linkState.inspectedAt,
    approvedAt: linkState.approvedAt,
    consumedAt: linkState.consumedAt,
    lastErrorCode: linkState.lastErrorCode,
  };
}

function toSafeRouteError(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  if (!(error instanceof ExistingBrandLinkError)) {
    return {
      code: "existing_brand_link_failed",
      message: DEFAULT_ERROR_MESSAGE,
      status: 500,
    };
  }

  const message = SAFE_ERROR_MESSAGES[error.code];
  if (!message) {
    return {
      code: "existing_brand_link_failed",
      message: DEFAULT_ERROR_MESSAGE,
      status: error.kind === "transient" ? 503 : 409,
    };
  }

  return {
    code: error.code,
    message,
    status: [400, 404, 409, 422, 503].includes(error.httpStatus)
      ? error.httpStatus
      : error.kind === "transient"
        ? 503
        : 409,
  };
}
