import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CampaignAssignmentStatus } from "@/types/database";
import { appendRegistrationEvent, serializeError } from "./audit";

const PENDING_REFRESH_COOLDOWN_MS = 60_000;
const FAILED_RETRY_COOLDOWN_MS = 5 * 60_000;
const DIFFERENT_CAMPAIGN_MARKER = "different campaign";

interface AssignmentBusinessRow {
  id: string;
  telnyx_campaign_id: string | null;
  telnyx_messaging_profile_id: string | null;
  campaign_status: string | null;
}

interface AssignmentPhoneNumberRow {
  id: string;
  business_id: string;
  phone_number: string;
  telnyx_campaign_assignment_status: CampaignAssignmentStatus;
  telnyx_campaign_assignment_task_id: string | null;
  telnyx_campaign_assignment_campaign_id: string | null;
  telnyx_campaign_assignment_failure_reason: string | null;
  telnyx_campaign_assignment_updated_at: string | null;
}

interface EnsureAssignmentOptions {
  force?: boolean;
  reason?: string;
}

type InspectResult =
  | { action: "assigned"; rawPayload: unknown }
  | { action: "pending"; rawPayload: unknown }
  | { action: "needs_assignment"; rawPayload?: unknown }
  | { action: "failed"; failureReason: string; rawPayload: unknown };

export async function ensureCampaignAssignmentForBusiness(
  businessId: string,
  options: EnsureAssignmentOptions = {}
): Promise<void> {
  const reason = options.reason ?? "lazy_refresh";

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, telnyx_campaign_id, telnyx_messaging_profile_id, campaign_status"
    )
    .eq("id", businessId)
    .single<AssignmentBusinessRow>();

  if (businessError || !business) {
    throw new Error(
      `[assignment] Business ${businessId} not found: ${businessError?.message ?? "not found"}`
    );
  }

  if (
    business.campaign_status !== "approved" ||
    !business.telnyx_campaign_id ||
    !business.telnyx_messaging_profile_id
  ) {
    return;
  }

  const { data: numbers, error: numbersError } = await supabaseAdmin
    .from("phone_numbers")
    .select(
      "id, business_id, phone_number, telnyx_campaign_assignment_status, telnyx_campaign_assignment_task_id, telnyx_campaign_assignment_campaign_id, telnyx_campaign_assignment_failure_reason, telnyx_campaign_assignment_updated_at"
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .returns<AssignmentPhoneNumberRow[]>();

  if (numbersError) {
    throw new Error(
      `[assignment] Failed to read phone numbers for business ${businessId}: ${numbersError.message}`
    );
  }

  const candidates = (numbers ?? []).filter((row) =>
    shouldInspectAssignment(row, options.force ?? false)
  );

  const numbersNeedingAssignment: AssignmentPhoneNumberRow[] = [];

  for (const row of candidates) {
    try {
      const skipInspection = await refreshTaskStatusIfNeeded(
        row,
        businessId,
        reason
      );
      if (skipInspection) continue;

      const inspected = await inspectNumberAssignment(
        row,
        business.telnyx_campaign_id
      );

      if (inspected.action === "assigned") {
        await updateNumberAssignment(row, {
          status: "assigned",
          campaignId: business.telnyx_campaign_id,
          failureReason: null,
          assigned: true,
        });
        await auditAssignmentStatus({
          businessId,
          phoneNumber: row.phone_number,
          status: "assigned",
          reason,
          rawPayload: inspected.rawPayload,
        });
      } else if (inspected.action === "pending") {
        await updateNumberAssignment(row, {
          status: "pending",
          campaignId: business.telnyx_campaign_id,
          failureReason: null,
        });
        await auditAssignmentStatus({
          businessId,
          phoneNumber: row.phone_number,
          status: "pending",
          reason,
          rawPayload: inspected.rawPayload,
        });
      } else if (inspected.action === "failed") {
        await updateNumberAssignment(row, {
          status: "failed",
          campaignId: business.telnyx_campaign_id,
          failureReason: inspected.failureReason,
        });
        await auditAssignmentFailure({
          businessId,
          phoneNumber: row.phone_number,
          status: "failed",
          reason,
          rawPayload: inspected.rawPayload,
          failureReason: inspected.failureReason,
        });
      } else {
        numbersNeedingAssignment.push(row);
      }
    } catch (err) {
      const failureReason = errorMessage(err);
      await updateNumberAssignment(row, {
        status: "failed",
        campaignId: business.telnyx_campaign_id,
        failureReason,
      });
      await auditAssignmentFailure({
        businessId,
        phoneNumber: row.phone_number,
        status: "failed",
        reason,
        rawPayload: serializeError(err),
        failureReason,
      });
    }
  }

  if (numbersNeedingAssignment.length === 0) {
    return;
  }

  await startProfileAssignment({
    business,
    numbers: numbersNeedingAssignment,
    reason,
  });
}

function shouldInspectAssignment(
  row: AssignmentPhoneNumberRow,
  force: boolean
): boolean {
  if (force) return true;
  if (row.telnyx_campaign_assignment_status === "assigned") return false;
  if (isDifferentCampaignFailure(row.telnyx_campaign_assignment_failure_reason)) {
    return false;
  }

  const updatedAt = row.telnyx_campaign_assignment_updated_at;
  if (!updatedAt) return true;

  if (row.telnyx_campaign_assignment_status === "failed") {
    return isOlderThan(updatedAt, FAILED_RETRY_COOLDOWN_MS);
  }

  return isOlderThan(updatedAt, PENDING_REFRESH_COOLDOWN_MS);
}

function isOlderThan(iso: string, ms: number): boolean {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return true;
  return Date.now() - time >= ms;
}

function isDifferentCampaignFailure(reason: string | null): boolean {
  return reason?.toLowerCase().includes(DIFFERENT_CAMPAIGN_MARKER) ?? false;
}

async function refreshTaskStatusIfNeeded(
  row: AssignmentPhoneNumberRow,
  businessId: string,
  reason: string
): Promise<boolean> {
  if (
    row.telnyx_campaign_assignment_status !== "pending" ||
    !row.telnyx_campaign_assignment_task_id
  ) {
    return false;
  }

  try {
    const task =
      await telnyx.messaging10dlc.phoneNumberAssignmentByProfile.retrieveStatus(
        row.telnyx_campaign_assignment_task_id
      );
    await auditAssignmentStatus({
      businessId,
      phoneNumber: row.phone_number,
      status: `task_${task.status}`,
      reason,
      rawPayload: task,
    });

    if (task.status === "failed") {
      await updateNumberAssignment(row, {
        status: "failed",
        campaignId: row.telnyx_campaign_assignment_campaign_id,
        failureReason: "Telnyx assignment task failed",
      });
      return true;
    }

    if (task.status === "pending" || task.status === "processing") {
      return true;
    }
  } catch (err) {
    console.warn(
      `[assignment] Failed to refresh task ${row.telnyx_campaign_assignment_task_id}:`,
      err
    );
  }

  return false;
}

async function inspectNumberAssignment(
  row: AssignmentPhoneNumberRow,
  campaignId: string
): Promise<InspectResult> {
  try {
    const assignment =
      await telnyx.messaging10dlc.phoneNumberCampaigns.retrieve(
        row.phone_number
      );
    const ids = assignmentCampaignIds(assignment);
    const assignedToSameCampaign = ids.includes(campaignId);

    if (ids.length > 0 && !assignedToSameCampaign) {
      return {
        action: "failed",
        failureReason: `Phone number is assigned to a different campaign (${ids.join(", ")})`,
        rawPayload: assignment,
      };
    }

    if (assignment.assignmentStatus === "ASSIGNED" && assignedToSameCampaign) {
      return { action: "assigned", rawPayload: assignment };
    }

    if (
      assignment.assignmentStatus === "PENDING_ASSIGNMENT" &&
      assignedToSameCampaign
    ) {
      return { action: "pending", rawPayload: assignment };
    }

    if (
      assignment.assignmentStatus === "FAILED_ASSIGNMENT" &&
      assignedToSameCampaign
    ) {
      return {
        action: "failed",
        failureReason:
          assignment.failureReasons || "Telnyx reported failed assignment",
        rawPayload: assignment,
      };
    }

    if (assignedToSameCampaign) {
      return {
        action: "failed",
        failureReason: `Unexpected Telnyx assignment status: ${assignment.assignmentStatus ?? "unknown"}`,
        rawPayload: assignment,
      };
    }

    return { action: "needs_assignment", rawPayload: assignment };
  } catch (err) {
    if (getErrorStatus(err) === 404) {
      return { action: "needs_assignment" };
    }
    throw err;
  }
}

function assignmentCampaignIds(assignment: {
  campaignId?: string;
  telnyxCampaignId?: string;
  tcrCampaignId?: string;
}): string[] {
  return [
    assignment.campaignId,
    assignment.telnyxCampaignId,
    assignment.tcrCampaignId,
  ].filter((id): id is string => Boolean(id));
}

async function startProfileAssignment(args: {
  business: AssignmentBusinessRow;
  numbers: AssignmentPhoneNumberRow[];
  reason: string;
}): Promise<void> {
  const { business, numbers, reason } = args;
  const campaignId = business.telnyx_campaign_id!;

  try {
    const response =
      await telnyx.messaging10dlc.phoneNumberAssignmentByProfile.assign({
        messagingProfileId: business.telnyx_messaging_profile_id!,
        campaignId,
      });

    if (!response.taskId) {
      throw new Error("Telnyx assignment returned no taskId");
    }

    await Promise.all(
      numbers.map((row) =>
        updateNumberAssignment(row, {
          status: "pending",
          campaignId,
          taskId: response.taskId,
          failureReason: null,
        })
      )
    );

    await appendRegistrationEvent({
      businessId: business.id,
      eventType: "phone_number_assignment_started",
      resourceType: "phone_number_assignment",
      resourceId: response.taskId,
      status: "pending",
      rawPayload: {
        reason,
        phoneNumbers: numbers.map((row) => row.phone_number),
        response,
      },
    });
  } catch (err) {
    const failureReason = errorMessage(err);
    await Promise.all(
      numbers.map((row) =>
        updateNumberAssignment(row, {
          status: "failed",
          campaignId,
          failureReason,
        })
      )
    );

    await appendRegistrationEvent({
      businessId: business.id,
      eventType: "phone_number_assignment_failed",
      resourceType: "phone_number_assignment",
      resourceId: campaignId,
      status: "failed",
      rejectionReason: failureReason,
      rawPayload: {
        reason,
        phoneNumbers: numbers.map((row) => row.phone_number),
        error: serializeError(err),
      },
    });
  }
}

async function updateNumberAssignment(
  row: AssignmentPhoneNumberRow,
  updates: {
    status: CampaignAssignmentStatus;
    campaignId: string | null;
    taskId?: string | null;
    failureReason?: string | null;
    assigned?: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    telnyx_campaign_assignment_status: updates.status,
    telnyx_campaign_assignment_campaign_id: updates.campaignId,
    telnyx_campaign_assignment_failure_reason:
      updates.failureReason === undefined
        ? row.telnyx_campaign_assignment_failure_reason
        : updates.failureReason,
    telnyx_campaign_assignment_updated_at: now,
  };

  if (updates.taskId !== undefined) {
    update.telnyx_campaign_assignment_task_id = updates.taskId;
  }

  if (updates.assigned) {
    update.telnyx_campaign_assigned_at = now;
  } else if (updates.status !== "assigned") {
    update.telnyx_campaign_assigned_at = null;
  }

  const { error } = await supabaseAdmin
    .from("phone_numbers")
    .update(update)
    .eq("id", row.id);

  if (error) {
    throw new Error(
      `[assignment] Failed to update ${row.phone_number}: ${error.message}`
    );
  }
}

async function auditAssignmentStatus(args: {
  businessId: string;
  phoneNumber: string;
  status: string;
  reason: string;
  rawPayload: unknown;
}): Promise<void> {
  await appendRegistrationEvent({
    businessId: args.businessId,
    eventType: "phone_number_assignment_status_changed",
    resourceType: "phone_number_assignment",
    resourceId: args.phoneNumber,
    status: args.status,
    rawPayload: {
      reason: args.reason,
      response: args.rawPayload,
    },
  });
}

async function auditAssignmentFailure(args: {
  businessId: string;
  phoneNumber: string;
  status: string;
  reason: string;
  rawPayload: unknown;
  failureReason: string;
}): Promise<void> {
  await appendRegistrationEvent({
    businessId: args.businessId,
    eventType: "phone_number_assignment_failed",
    resourceType: "phone_number_assignment",
    resourceId: args.phoneNumber,
    status: args.status,
    rejectionReason: args.failureReason,
    rawPayload: {
      reason: args.reason,
      response: args.rawPayload,
    },
  });
}

function getErrorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const obj = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return obj.status ?? obj.statusCode ?? obj.response?.status ?? null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const serialized = serializeError(err);
  const message = serialized.message;
  return typeof message === "string" ? message : String(err);
}
