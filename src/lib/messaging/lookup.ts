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
    return {
      smsReady: false,
      blockReason: "missing_phone_number",
      campaignStatus: business?.campaign_status ?? null,
      assignmentStatus: null,
      assignmentFailureReason: null,
      phoneNumber: null,
      messagingProfileId: business?.telnyx_messaging_profile_id ?? null,
    };
  }

  let readiness = buildReadiness(row);
  if (
    allowAssignmentRefresh &&
    shouldLazyRefreshAssignmentForReadiness(readiness, row)
  ) {
    await runLazyAssignmentRefresh(businessId, "dashboard_lazy_refresh");
    row = await readActivePhoneContextForBusiness(businessId);
    readiness = row
      ? buildReadiness(row)
      : {
          smsReady: false,
          blockReason: "missing_phone_number",
          campaignStatus: null,
          assignmentStatus: null,
          assignmentFailureReason: null,
          phoneNumber: null,
          messagingProfileId: null,
        };
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
  const readiness = buildReadiness(row);
  return {
    ...readiness,
    businessId: row.business_id,
    phoneNumber: row.phone_number,
  };
}

function buildReadiness(row: PhoneContextRow): SmsReadiness {
  const business = unwrapBusiness(row.businesses);
  const campaignStatus = business?.campaign_status ?? null;
  const messagingProfileId = business?.telnyx_messaging_profile_id ?? null;
  const expectedCampaignId = business?.telnyx_campaign_id ?? null;
  const assignmentStatus =
    row.telnyx_campaign_assignment_status ?? "unassigned";
  const assignedToExpectedCampaign =
    assignmentStatus === "assigned" &&
    Boolean(expectedCampaignId) &&
    row.telnyx_campaign_assignment_campaign_id === expectedCampaignId;

  let blockReason: SmsBlockReason | null = null;
  if (!messagingProfileId) {
    blockReason = "missing_messaging_profile";
  } else if (campaignStatus !== "approved") {
    blockReason = "campaign_not_approved";
  } else if (!assignedToExpectedCampaign) {
    blockReason =
      assignmentStatus === "failed" ? "assignment_failed" : "assignment_pending";
  }

  return {
    smsReady: blockReason === null,
    blockReason,
    campaignStatus,
    assignmentStatus,
    assignmentFailureReason:
      row.telnyx_campaign_assignment_failure_reason ?? null,
    phoneNumber: row.phone_number,
    messagingProfileId,
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
  return shouldLazyRefreshAssignmentForReadiness(context, row);
}

function shouldLazyRefreshAssignmentForReadiness(
  readiness: SmsReadiness,
  row: PhoneContextRow
): boolean {
  const business = unwrapBusiness(row.businesses);
  return (
    readiness.campaignStatus === "approved" &&
    Boolean(business?.telnyx_campaign_id) &&
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
