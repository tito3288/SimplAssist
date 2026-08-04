import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureCampaignAssignmentForBusiness } from "@/lib/messaging/registration/phoneNumberAssignment";
import type {
  CampaignAssignmentStatus,
  RegistrationStatus,
  SmsBlockReason,
} from "@/types/database";

export interface SmsReadiness {
  smsReady: boolean;
  blockReason: SmsBlockReason | null;
  campaignStatus: RegistrationStatus | null;
  assignmentStatus: CampaignAssignmentStatus | null;
  assignmentFailureReason: string | null;
  phoneNumber: string | null;
  messagingProfileId: string | null;
}

/**
 * Already-loaded SMS configuration facts consumed by the pure readiness
 * reducer. This shape can be populated by the existing point reads or by an
 * aggregated admin RPC without triggering another database query.
 */
export interface SmsReadinessSnapshot {
  hasActivePhone: boolean;
  phoneNumber: string | null;
  messagingProfileId: string | null;
  campaignStatus: RegistrationStatus | null;
  expectedCampaignId: string | null;
  assignmentStatus: CampaignAssignmentStatus | null;
  assignedCampaignId: string | null;
  assignmentFailureReason: string | null;
}

export interface OutboundSendContext extends SmsReadiness {
  businessId: string;
  phoneNumber: string;
}

interface BusinessContextRow {
  id: string;
  telnyx_messaging_profile_id: string | null;
  telnyx_campaign_id: string | null;
  campaign_status: RegistrationStatus | null;
}

interface PhoneContextRow {
  id: string;
  business_id: string;
  phone_number: string;
  telnyx_campaign_assignment_status: CampaignAssignmentStatus;
  telnyx_campaign_assignment_campaign_id: string | null;
  telnyx_campaign_assignment_failure_reason: string | null;
  businesses: BusinessContextRow | BusinessContextRow[] | null;
}

const PHONE_CONTEXT_SELECT =
  "id, business_id, phone_number, telnyx_campaign_assignment_status, telnyx_campaign_assignment_campaign_id, telnyx_campaign_assignment_failure_reason, businesses!inner(id, telnyx_messaging_profile_id, telnyx_campaign_id, campaign_status)";

export async function getOutboundSendContext(
  fromPhoneNumber: string
): Promise<OutboundSendContext> {
  let row = await readPhoneContextByNumber(fromPhoneNumber);
  let context = buildOutboundContext(row);

  if (shouldLazyRefreshAssignment(context, row)) {
    await runLazyAssignmentRefresh(context.businessId, "send_gate_lazy_refresh");
    row = await readPhoneContextByNumber(fromPhoneNumber);
    context = buildOutboundContext(row);
  }

  return context;
}

export async function getSmsReadinessForBusiness(
  businessId: string
): Promise<SmsReadiness> {
  return getSmsReadinessForBusinessInternal(businessId, true);
}

export async function getSmsReadinessForBusinessReadOnly(
  businessId: string
): Promise<SmsReadiness> {
  return getSmsReadinessForBusinessInternal(businessId, false);
}

async function getSmsReadinessForBusinessInternal(
  businessId: string,
  allowAssignmentRefresh: boolean
): Promise<SmsReadiness> {
  let row = await readActivePhoneContextForBusiness(businessId);

  if (!row) {
    const business = await readBusinessContext(businessId);
    return reduceSmsReadinessSnapshot(
      missingPhoneSnapshot({
        campaignStatus: business?.campaign_status ?? null,
        messagingProfileId:
          business?.telnyx_messaging_profile_id ?? null,
        expectedCampaignId: business?.telnyx_campaign_id ?? null,
      })
    );
  }

  let snapshot = smsReadinessSnapshotFromPhoneContext(row);
  let readiness = reduceSmsReadinessSnapshot(snapshot);
  if (
    allowAssignmentRefresh &&
    shouldLazyRefreshAssignmentForReadiness(readiness, snapshot)
  ) {
    await runLazyAssignmentRefresh(businessId, "dashboard_lazy_refresh");
    row = await readActivePhoneContextForBusiness(businessId);
    snapshot = row
      ? smsReadinessSnapshotFromPhoneContext(row)
      : missingPhoneSnapshot();
    readiness = reduceSmsReadinessSnapshot(snapshot);
  }

  return readiness;
}

export function smsBlockMessage(reason: SmsBlockReason | null): string {
  switch (reason) {
    case "campaign_not_approved":
      return "Your SMS campaign is still under carrier review. Sending is paused until approval, usually 1-5 days.";
    case "assignment_pending":
      return "Your SMS campaign is approved, and Telnyx is linking your phone number to it. Sending will unlock once assignment finishes.";
    case "assignment_failed":
      return "Your SMS campaign is approved, but phone number assignment needs attention before sending can start.";
    case "missing_messaging_profile":
      return "Messaging profile is not configured for this business.";
    case "missing_phone_number":
      return "No active phone number is configured for this business.";
    default:
      return "SMS sending is currently paused.";
  }
}

export function smsBlockCode(reason: SmsBlockReason | null): string {
  switch (reason) {
    case "campaign_not_approved":
      return "CAMPAIGN_NOT_APPROVED";
    case "assignment_pending":
      return "CAMPAIGN_ASSIGNMENT_PENDING";
    case "assignment_failed":
      return "CAMPAIGN_ASSIGNMENT_FAILED";
    case "missing_messaging_profile":
      return "MESSAGING_PROFILE_NOT_CONFIGURED";
    case "missing_phone_number":
      return "NO_ACTIVE_PHONE_NUMBER";
    default:
      return "SMS_NOT_READY";
  }
}

async function readPhoneContextByNumber(
  phoneNumber: string
): Promise<PhoneContextRow> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select(PHONE_CONTEXT_SELECT)
    .eq("phone_number", phoneNumber)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error(
      `[messaging:lookup] No active phone_numbers row for ${phoneNumber}: ${error?.message ?? "not found"}`
    );
  }

  return data as PhoneContextRow;
}

async function readActivePhoneContextForBusiness(
  businessId: string
): Promise<PhoneContextRow | null> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select(PHONE_CONTEXT_SELECT)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[messaging:lookup] Failed to read active phone number for business ${businessId}: ${error.message}`
    );
  }

  return (data as PhoneContextRow | null) ?? null;
}

async function readBusinessContext(
  businessId: string
): Promise<BusinessContextRow | null> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id, telnyx_messaging_profile_id, telnyx_campaign_id, campaign_status")
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[messaging:lookup] Failed to read business ${businessId}: ${error.message}`
    );
  }

  return (data as BusinessContextRow | null) ?? null;
}

function buildOutboundContext(row: PhoneContextRow): OutboundSendContext {
  const readiness = reduceSmsReadinessSnapshot(
    smsReadinessSnapshotFromPhoneContext(row)
  );
  return {
    ...readiness,
    businessId: row.business_id,
    phoneNumber: row.phone_number,
  };
}

function smsReadinessSnapshotFromPhoneContext(
  row: PhoneContextRow
): SmsReadinessSnapshot {
  const business = unwrapBusiness(row.businesses);
  return {
    hasActivePhone: true,
    phoneNumber: row.phone_number,
    messagingProfileId: business?.telnyx_messaging_profile_id ?? null,
    campaignStatus: business?.campaign_status ?? null,
    expectedCampaignId: business?.telnyx_campaign_id ?? null,
    assignmentStatus: row.telnyx_campaign_assignment_status ?? null,
    assignedCampaignId:
      row.telnyx_campaign_assignment_campaign_id ?? null,
    assignmentFailureReason:
      row.telnyx_campaign_assignment_failure_reason ?? null,
  };
}

function missingPhoneSnapshot(
  business: {
    messagingProfileId: string | null;
    campaignStatus: RegistrationStatus | null;
    expectedCampaignId: string | null;
  } = {
    messagingProfileId: null,
    campaignStatus: null,
    expectedCampaignId: null,
  }
): SmsReadinessSnapshot {
  return {
    hasActivePhone: false,
    phoneNumber: null,
    messagingProfileId: business.messagingProfileId,
    campaignStatus: business.campaignStatus,
    expectedCampaignId: business.expectedCampaignId,
    assignmentStatus: null,
    assignedCampaignId: null,
    assignmentFailureReason: null,
  };
}

/** Reduce already-loaded SMS configuration facts into send readiness. */
export function reduceSmsReadinessSnapshot(
  snapshot: SmsReadinessSnapshot
): SmsReadiness {
  if (!snapshot.hasActivePhone) {
    return {
      smsReady: false,
      blockReason: "missing_phone_number",
      campaignStatus: snapshot.campaignStatus,
      assignmentStatus: null,
      assignmentFailureReason: null,
      phoneNumber: null,
      messagingProfileId: snapshot.messagingProfileId,
    };
  }

  const assignmentStatus = snapshot.assignmentStatus ?? "unassigned";
  const assignedToExpectedCampaign =
    assignmentStatus === "assigned" &&
    Boolean(snapshot.expectedCampaignId) &&
    snapshot.assignedCampaignId === snapshot.expectedCampaignId;

  let blockReason: SmsBlockReason | null = null;
  if (!snapshot.messagingProfileId) {
    blockReason = "missing_messaging_profile";
  } else if (snapshot.campaignStatus !== "approved") {
    blockReason = "campaign_not_approved";
  } else if (!assignedToExpectedCampaign) {
    blockReason =
      assignmentStatus === "failed" ? "assignment_failed" : "assignment_pending";
  }

  return {
    smsReady: blockReason === null,
    blockReason,
    campaignStatus: snapshot.campaignStatus,
    assignmentStatus,
    assignmentFailureReason: snapshot.assignmentFailureReason,
    phoneNumber: snapshot.phoneNumber,
    messagingProfileId: snapshot.messagingProfileId,
  };
}

function unwrapBusiness(
  business: PhoneContextRow["businesses"]
): BusinessContextRow | null {
  if (Array.isArray(business)) return business[0] ?? null;
  return business ?? null;
}

function shouldLazyRefreshAssignment(
  context: OutboundSendContext,
  row: PhoneContextRow
): boolean {
  return shouldLazyRefreshAssignmentForReadiness(
    context,
    smsReadinessSnapshotFromPhoneContext(row)
  );
}

function shouldLazyRefreshAssignmentForReadiness(
  readiness: SmsReadiness,
  snapshot: SmsReadinessSnapshot
): boolean {
  return (
    readiness.campaignStatus === "approved" &&
    Boolean(snapshot.expectedCampaignId) &&
    Boolean(readiness.messagingProfileId) &&
    readiness.assignmentStatus !== "assigned"
  );
}

async function runLazyAssignmentRefresh(
  businessId: string,
  reason: string
): Promise<void> {
  try {
    await ensureCampaignAssignmentForBusiness(businessId, { reason });
  } catch (err) {
    console.error(
      `[messaging:lookup] Assignment lazy refresh failed for business ${businessId}:`,
      err
    );
  }
}
