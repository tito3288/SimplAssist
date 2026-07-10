import { NextRequest, NextResponse } from "next/server";
import { telnyx } from "@/lib/messaging/client";
import { markProcessedOnce } from "@/lib/messaging/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appendRegistrationEvent,
  serializeError,
} from "@/lib/messaging/registration/audit";
import { ensureCampaignAssignmentForBusiness } from "@/lib/messaging/registration/phoneNumberAssignment";
import {
  extractRejectionReason,
  mapBrandStatus,
  mapCampaignStatus,
  type MappedStatus,
} from "@/lib/messaging/registration/statusMapper";
import {
  dedupeRecipients,
  sendBrandApprovedEmail,
  sendBrandRejectedEmail,
  sendCampaignApprovedEmail,
  sendCampaignRejectedEmail,
} from "@/lib/email/registrationStatus";
import type { RegistrationStatus } from "@/types/database";

// Telnyx 10DLC brand/campaign status webhook receiver. Phase 3 wires this URL
// into every brand and campaign it creates; Phase 4 (this file) updates the
// businesses row and emails the owner on terminal state changes.
//
// Invariants (mirror the messaging webhook):
// - Verify Ed25519 signature first; 403 on failure.
// - From signature-verified onward, ALWAYS return 200 so Telnyx doesn't retry.
// - Dedup webhook event IDs against processed_webhook_events.
// - Status-transition guard via conditional UPDATE: race-safe against
//   simultaneous webhook deliveries (no SELECT-then-UPDATE TOCTOU window).
// - Email is fire-and-forget; never blocks the 200, never throws.
// - Once business is resolved, every code path audits — including
//   BRAND_OTP_VERIFIED (Phase 11 placeholder) and post-lookup errors.
//
// Audit coverage gap (irreducible without schema change):
// Events without a resource ID (brandId/campaignId) cannot be audited due to
// the NOT NULL business_id constraint on telnyx_registration_events. These
// get console.warn only. Consider a separate orphaned_webhook_events table or
// nullable business_id in a future phase if this becomes a debugging blocker.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let event: unknown;
  try {
    event = await telnyx.webhooks.unwrap(rawBody, { headers });
  } catch (err) {
    console.warn("[registration:webhook] Signature verification failed:", err);
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error("[registration:webhook] Handler error:", err);
  }
  return new NextResponse("OK", { status: 200 });
}

async function handleEvent(event: unknown): Promise<void> {
  const eventData = (event as {
    data?: { id?: string; event_type?: string; payload?: unknown };
  }).data;
  const eventId = eventData?.id;
  const eventType = eventData?.event_type;
  console.log(
    `[registration:webhook] event_type=${eventType} event_id=${eventId}`
  );

  if (eventId) {
    const isFirstTime = await markProcessedOnce(eventId);
    if (!isFirstTime) {
      console.log(
        `[registration:webhook] Idempotency: event ${eventId} already processed, skipping`
      );
      return;
    }
  } else {
    console.warn(
      "[registration:webhook] Missing event.data.id, skipping idempotency check"
    );
  }

  const payload = (eventData?.payload ?? {}) as Record<string, unknown>;
  const innerEventType = pickString(payload, ["eventType", "event_type"]);
  const isOtpEvent =
    eventType === "BRAND_OTP_VERIFIED" || innerEventType === "BRAND_OTP_VERIFIED";

  const brandId = pickString(payload, ["brandId", "brand_id", "tcrBrandId"]);
  const campaignId = pickString(payload, [
    "campaignId",
    "campaign_id",
    "tcrCampaignId",
  ]);

  let kind: "brand" | "campaign";
  let resourceId: string;
  if (campaignId) {
    kind = "campaign";
    resourceId = campaignId;
  } else if (brandId) {
    kind = "brand";
    resourceId = brandId;
  } else {
    // Irreducible audit gap: no resource id means we have no way to find a
    // business_id, and the audit table requires one. See top-of-file comment.
    console.warn(
      "[registration:webhook] cannot identify resource; payload keys=",
      Object.keys(payload)
    );
    return;
  }

  const business = await lookupBusiness(kind, resourceId);
  if (!business) {
    // Same constraint as above: no business_id → cannot audit.
    console.warn(
      `[registration:webhook] no business found for ${kind} id=${resourceId}`
    );
    return;
  }

  const auditEventType =
    kind === "brand" ? "brand_status_changed" : "campaign_status_changed";

  // From here on, every exit path audits.
  try {
    if (isOtpEvent) {
      // Phase 11 territory (Sole Proprietor SMS OTP). Audit + return so the
      // event isn't lost to console-only logging.
      console.log(
        "[registration:webhook] BRAND_OTP_VERIFIED — Phase 11 will own this; auditing and skipping"
      );
      await appendRegistrationEvent({
        businessId: business.id,
        eventType: auditEventType,
        resourceType: kind,
        resourceId,
        status: "audit_only_phase_11_otp",
        rawPayload: event as Record<string, unknown>,
      });
      return;
    }

    const mapped: MappedStatus =
      kind === "brand"
        ? mapBrandStatus({
            identityStatus: pickString(payload, [
              "brandIdentityStatus",
              "brand_identity_status",
              "identityStatus",
              "identity_status",
            ]),
            status: pickString(payload, ["status"]),
          })
        : mapCampaignStatus({
            campaignStatus: pickString(payload, [
              "campaignStatus",
              "campaign_status",
            ]),
            submissionStatus: pickString(payload, [
              "submissionStatus",
              "submission_status",
            ]),
            status: pickString(payload, ["status"]),
          });

    const rejectionReason =
      mapped.dbStatus === "rejected" ? extractRejectionReason(payload) : null;

    let statusChanged = false;
    if (mapped.dbStatus !== null) {
      statusChanged = await applyStatusTransition({
        kind,
        businessId: business.id,
        newStatus: mapped.dbStatus,
        rejectionReason,
      });
    }

    await appendRegistrationEvent({
      businessId: business.id,
      eventType: auditEventType,
      resourceType: kind,
      resourceId,
      status:
        mapped.dbStatus ?? pickString(payload, ["status", "campaignStatus"]),
      rejectionReason,
      rawPayload: event as Record<string, unknown>,
    });

    if (
      kind === "campaign" &&
      mapped.dbStatus === "approved" &&
      statusChanged
    ) {
      ensureCampaignAssignmentForBusiness(business.id, {
        force: true,
        reason: "campaign_approved_webhook",
      }).catch((err) =>
        console.error(
          `[registration:webhook] campaign assignment start failed for business ${business.id}:`,
          err
        )
      );
    }

    if (mapped.isTerminal && statusChanged) {
      dispatchStatusEmail({
        kind,
        newStatus: mapped.dbStatus!,
        businessId: business.id,
        businessName: business.name,
        authorizedRepEmail: business.authorized_rep_email,
        ownerId: business.owner_id,
        rejectionReason,
      }).catch((err) =>
        console.error("[registration:webhook] email dispatch error:", err)
      );
    }
  } catch (err) {
    console.error(
      `[registration:webhook] post-lookup error for business ${business.id}:`,
      err
    );
    try {
      await appendRegistrationEvent({
        businessId: business.id,
        eventType: auditEventType,
        resourceType: kind,
        resourceId,
        status: "error",
        rawPayload: serializeError(err),
      });
    } catch (auditErr) {
      console.error(
        "[registration:webhook] error-audit append failed:",
        auditErr
      );
    }
  }
}

interface BusinessRow {
  id: string;
  name: string;
  owner_id: string;
  authorized_rep_email: string | null;
}

async function lookupBusiness(
  kind: "brand" | "campaign",
  resourceId: string
): Promise<BusinessRow | null> {
  const column = kind === "brand" ? "telnyx_brand_id" : "telnyx_campaign_id";
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id, name, owner_id, authorized_rep_email")
    .eq(column, resourceId)
    .maybeSingle();

  if (error) {
    console.error(
      `[registration:webhook] lookup failed for ${column}=${resourceId}:`,
      error
    );
    return null;
  }
  return data as BusinessRow | null;
}

// Atomic conditional UPDATE: only writes (and returns a row) when the new
// status differs from the current value. PostgREST's `.or()` filter expresses
// `IS DISTINCT FROM` correctly across NULL by combining `is.null` with `neq`.
async function applyStatusTransition(args: {
  kind: "brand" | "campaign";
  businessId: string;
  newStatus: RegistrationStatus;
  rejectionReason: string | null;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const update =
    args.kind === "brand"
      ? {
          brand_status: args.newStatus,
          brand_status_updated_at: now,
          brand_rejection_reason: args.rejectionReason,
          // A rejected brand maps to the retryable 'failed' state so the
          // carrier-review panel can offer the routed fix path (mirrors the
          // campaign-rejection mapping below).
          ...(args.newStatus === "rejected"
            ? {
                onboarding_registration_status: "failed" as const,
                onboarding_registration_submitted_at: null,
                onboarding_registration_error:
                  args.rejectionReason ??
                  "Your business verification was rejected by the carrier.",
              }
            : {}),
        }
      : {
          campaign_status: args.newStatus,
          campaign_status_updated_at: now,
          campaign_rejection_reason: args.rejectionReason,
          // A rejected campaign is recoverable: map it into the retryable
          // 'failed' state so the carrier-review panel offers Retry and
          // claimRegistrationAttempt can claim the attempt. The retry
          // pipeline archives + deactivates the rejected campaign and
          // creates a replacement (archiveAndClearRejectedCampaign).
          ...(args.newStatus === "rejected"
            ? {
                onboarding_registration_status: "failed" as const,
                onboarding_registration_submitted_at: null,
                onboarding_registration_error:
                  args.rejectionReason ??
                  "Your SMS campaign was rejected by the carrier. Retry to resubmit.",
              }
            : {}),
        };

  const statusColumn = args.kind === "brand" ? "brand_status" : "campaign_status";
  const guard = `${statusColumn}.is.null,${statusColumn}.neq.${args.newStatus}`;

  const { data, error } = await supabaseAdmin
    .from("businesses")
    .update(update)
    .eq("id", args.businessId)
    .or(guard)
    .select("id");

  if (error) {
    console.error(
      `[registration:webhook] conditional update failed for business ${args.businessId}:`,
      error
    );
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function dispatchStatusEmail(args: {
  kind: "brand" | "campaign";
  newStatus: RegistrationStatus;
  businessId: string;
  businessName: string;
  authorizedRepEmail: string | null;
  ownerId: string;
  rejectionReason: string | null;
}): Promise<void> {
  const ownerEmail = await resolveOwnerEmail(args.ownerId);
  const recipients = dedupeRecipients([args.authorizedRepEmail, ownerEmail]);

  if (recipients.length === 0) {
    console.warn(
      `[registration:webhook] no recipients for business ${args.businessId}; skipping email`
    );
    return;
  }

  if (args.kind === "brand" && args.newStatus === "approved") {
    await sendBrandApprovedEmail({ businessName: args.businessName, recipients });
  } else if (args.kind === "brand" && args.newStatus === "rejected") {
    await sendBrandRejectedEmail({
      businessName: args.businessName,
      rejectionReason: args.rejectionReason,
      recipients,
    });
  } else if (args.kind === "campaign" && args.newStatus === "approved") {
    await sendCampaignApprovedEmail({
      businessName: args.businessName,
      recipients,
    });
  } else if (args.kind === "campaign" && args.newStatus === "rejected") {
    await sendCampaignRejectedEmail({
      businessName: args.businessName,
      rejectionReason: args.rejectionReason,
      recipients,
    });
  }
}

async function resolveOwnerEmail(ownerId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(ownerId);
    if (error) {
      console.warn(
        `[registration:webhook] auth.admin.getUserById failed for ${ownerId}:`,
        error
      );
      return null;
    }
    return data.user?.email ?? null;
  } catch (err) {
    console.warn(
      `[registration:webhook] auth.admin.getUserById threw for ${ownerId}:`,
      err
    );
    return null;
  }
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}
