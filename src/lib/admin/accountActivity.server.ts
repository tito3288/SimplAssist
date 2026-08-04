import "server-only";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SOURCE_LIMIT = 100;

export const ACCOUNT_ACTIVITY_COLUMNS = {
  milestones:
    "compliance_info_completed_at, onboarding_registration_submitted_at, onboarding_completed_at",
  releaseScheduled: "id, triggered_at, release_at",
  releaseCanceled: "id, canceled_at",
  deletionAdmin:
    "id, actor_admin_user_id, deletion_scheduled_for",
  provisioningJob: "id",
  provisioningAdmin: "id, action, actor_admin_user_id, created_at",
  risk:
    "id, event_type, created_at, reviewed_by:raw_payload->>reviewedBy",
  registration: "id, event_type, created_at",
  brandLink: "id, event_type, actor_user_id, created_at",
  rejected: "id, archived_at",
  calendar: "created_at",
} as const;

export type AdminAccountActivityCategory =
  | "lifecycle"
  | "admin"
  | "risk_review"
  | "registration"
  | "brand"
  | "rejection"
  | "calendar";

type AdminAccountActivityEventBase = {
  id: string;
  occurredAt: string;
  title: string;
  detail: string | null;
  actor: string | null;
};

export type AdminAccountActivityEvent = {
  [Category in AdminAccountActivityCategory]: AdminAccountActivityEventBase & {
    category: Category;
  };
}[AdminAccountActivityCategory];

export class AdminAccountActivityUnavailableError extends Error {
  readonly code:
    | "invalid_business_id"
    | "query_failed"
    | "invalid_response";
  readonly source: string;
  override readonly cause?: unknown;

  constructor(
    code: AdminAccountActivityUnavailableError["code"],
    source: string,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AdminAccountActivityUnavailableError";
    this.code = code;
    this.source = source;
    this.cause = cause;
  }
}

const timestampSchema = z.string().refine(
  (value) => value.length > 0 && Number.isFinite(Date.parse(value)),
  "Invalid timestamp",
);
const nullableTimestampSchema = timestampSchema.nullable();
const actorScalarSchema = z.string().nullable();
const safeActorSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const milestonesSchema = z
  .object({
    compliance_info_completed_at: nullableTimestampSchema,
    onboarding_registration_submitted_at: nullableTimestampSchema,
    onboarding_completed_at: nullableTimestampSchema,
  })
  .strict();
const releaseScheduledRowSchema = z
  .object({
    id: z.string().uuid(),
    triggered_at: timestampSchema,
    release_at: timestampSchema,
  })
  .strict();
const releaseCanceledRowSchema = z
  .object({
    id: z.string().uuid(),
    canceled_at: nullableTimestampSchema,
  })
  .strict();
const deletionAdminRowSchema = z
  .object({
    id: z.string().uuid(),
    actor_admin_user_id: z.string().uuid(),
    deletion_scheduled_for: timestampSchema,
  })
  .strict();
const provisioningJobSchema = z.object({ id: z.string().uuid() }).strict();
const provisioningAdminRowSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum([
      "provisioning_job_dismissed",
      "provisioning_job_restored",
    ]),
    actor_admin_user_id: z.string().uuid(),
    created_at: timestampSchema,
  })
  .strict();
const riskRowSchema = z
  .object({
    id: z.string().uuid(),
    event_type: z.string(),
    created_at: nullableTimestampSchema,
    reviewed_by: actorScalarSchema,
  })
  .strict();
const registrationRowSchema = z
  .object({
    id: z.string().uuid(),
    event_type: z.string(),
    created_at: nullableTimestampSchema,
  })
  .strict();
const brandLinkRowSchema = z
  .object({
    id: z.string().uuid(),
    event_type: z.string(),
    actor_user_id: actorScalarSchema,
    created_at: timestampSchema,
  })
  .strict();
const rejectedRowSchema = z
  .object({
    id: z.string().uuid(),
    archived_at: nullableTimestampSchema,
  })
  .strict();
const calendarSchema = z
  .object({ created_at: nullableTimestampSchema })
  .strict();

type MilestonesRow = z.infer<typeof milestonesSchema>;
type ReleaseScheduledRow = z.infer<typeof releaseScheduledRowSchema>;
type ReleaseCanceledRow = z.infer<typeof releaseCanceledRowSchema>;
type DeletionAdminRow = z.infer<typeof deletionAdminRowSchema>;
type ProvisioningAdminRow = z.infer<typeof provisioningAdminRowSchema>;
type RiskRow = z.infer<typeof riskRowSchema>;
type RegistrationRow = z.infer<typeof registrationRowSchema>;
type BrandLinkRow = z.infer<typeof brandLinkRowSchema>;
type RejectedRow = z.infer<typeof rejectedRowSchema>;
type CalendarRow = z.infer<typeof calendarSchema>;

export interface AdminAccountActivitySnapshot {
  businessId: string;
  milestones: MilestonesRow | null;
  releaseScheduled: ReleaseScheduledRow[];
  releaseCanceled: ReleaseCanceledRow[];
  deletionAdminEvents: DeletionAdminRow[];
  provisioningAdminEvents: ProvisioningAdminRow[];
  riskEvents: RiskRow[];
  registrationEvents: RegistrationRow[];
  brandLinkEvents: BrandLinkRow[];
  rejectedBrands: RejectedRow[];
  rejectedCampaigns: RejectedRow[];
  calendar: CalendarRow | null;
}

type ReadResult = { data: unknown; error: unknown };

/**
 * Loads recorded account history through fixed, minimized service-role reads.
 * The caller must complete requireAdminUser() before invoking this function.
 */
export async function loadAdminAccountActivity(
  businessId: string,
): Promise<AdminAccountActivityEvent[]> {
  if (!z.string().uuid().safeParse(businessId).success) {
    throw new AdminAccountActivityUnavailableError(
      "invalid_business_id",
      "business",
      "Could not load admin account activity for an invalid business ID.",
    );
  }

  const [
    milestoneResult,
    releaseScheduledResult,
    releaseCanceledResult,
    deletionAdminResult,
    riskResult,
    registrationResult,
    brandLinkResult,
    rejectedBrandsResult,
    rejectedCampaignsResult,
    calendarResult,
    provisioningAdminEvents,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select(ACCOUNT_ACTIVITY_COLUMNS.milestones)
      .eq("id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("telnyx_resource_release_reasons")
      .select(ACCOUNT_ACTIVITY_COLUMNS.releaseScheduled)
      .eq("business_id", businessId)
      .eq("reason_type", "account_deletion")
      .order("triggered_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("telnyx_resource_release_reasons")
      .select(ACCOUNT_ACTIVITY_COLUMNS.releaseCanceled)
      .eq("business_id", businessId)
      .eq("reason_type", "account_deletion")
      .not("canceled_at", "is", null)
      .order("canceled_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("admin_action_events")
      .select(ACCOUNT_ACTIVITY_COLUMNS.deletionAdmin)
      .eq("business_id", businessId)
      .eq("action", "account_deletion_scheduled")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("a2p_risk_review_events")
      .select(ACCOUNT_ACTIVITY_COLUMNS.risk)
      .eq("business_id", businessId)
      .in("event_type", Object.keys(RISK_TITLES))
      .not("created_at", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("telnyx_registration_events")
      .select(ACCOUNT_ACTIVITY_COLUMNS.registration)
      .eq("business_id", businessId)
      .in("event_type", Object.keys(REGISTRATION_TITLES))
      .not("created_at", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("telnyx_brand_link_events")
      .select(ACCOUNT_ACTIVITY_COLUMNS.brandLink)
      .eq("business_id", businessId)
      .in("event_type", Object.keys(BRAND_LINK_TITLES))
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("rejected_brands")
      .select(ACCOUNT_ACTIVITY_COLUMNS.rejected)
      .eq("business_id", businessId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("rejected_campaigns")
      .select(ACCOUNT_ACTIVITY_COLUMNS.rejected)
      .eq("business_id", businessId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(SOURCE_LIMIT),
    supabaseAdmin
      .from("google_calendar_tokens")
      .select(ACCOUNT_ACTIVITY_COLUMNS.calendar)
      .eq("business_id", businessId)
      .maybeSingle(),
    loadProvisioningAdminEvents(businessId),
  ]);

  const milestones = parseRequiredRow(
    "business milestones",
    milestoneResult,
    milestonesSchema,
  );
  const releaseScheduled = parseRows(
    "deletion schedules",
    releaseScheduledResult,
    releaseScheduledRowSchema,
  );
  const releaseCanceled = parseRows(
    "deletion cancellations",
    releaseCanceledResult,
    releaseCanceledRowSchema,
  );
  const deletionAdminEvents = parseRows(
    "deletion admin actions",
    deletionAdminResult,
    deletionAdminRowSchema,
  );
  const riskEvents = parseRows(
    "risk review activity",
    riskResult,
    riskRowSchema,
  );
  const registrationEvents = parseRows(
    "registration activity",
    registrationResult,
    registrationRowSchema,
  );
  const brandLinkEvents = parseRows(
    "existing-brand activity",
    brandLinkResult,
    brandLinkRowSchema,
  );
  const rejectedBrands = parseRows(
    "rejected brand history",
    rejectedBrandsResult,
    rejectedRowSchema,
  );
  const rejectedCampaigns = parseRows(
    "rejected campaign history",
    rejectedCampaignsResult,
    rejectedRowSchema,
  );
  const calendar = parseOptionalRow(
    "Calendar connection",
    calendarResult,
    calendarSchema,
  );

  return normalizeAdminAccountActivity({
    businessId,
    milestones,
    releaseScheduled,
    releaseCanceled,
    deletionAdminEvents,
    provisioningAdminEvents,
    riskEvents,
    registrationEvents,
    brandLinkEvents,
    rejectedBrands,
    rejectedCampaigns,
    calendar,
  });
}

async function loadProvisioningAdminEvents(
  businessId: string,
): Promise<ProvisioningAdminRow[]> {
  const provisioningJobResult = await supabaseAdmin
    .from("partner_client_provisioning_jobs")
    .select(ACCOUNT_ACTIVITY_COLUMNS.provisioningJob)
    .eq("business_id", businessId)
    .maybeSingle();
  const provisioningJob = parseOptionalRow(
    "provisioning association",
    provisioningJobResult,
    provisioningJobSchema,
  );
  if (!provisioningJob) return [];

  const provisioningAdminResult = await supabaseAdmin
    .from("admin_action_events")
    .select(ACCOUNT_ACTIVITY_COLUMNS.provisioningAdmin)
    .eq("provisioning_job_id", provisioningJob.id)
    .in("action", [
      "provisioning_job_dismissed",
      "provisioning_job_restored",
    ])
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(SOURCE_LIMIT);
  return parseRows(
    "provisioning admin actions",
    provisioningAdminResult,
    provisioningAdminRowSchema,
  );
}

export function normalizeAdminAccountActivity(
  snapshot: AdminAccountActivitySnapshot,
): AdminAccountActivityEvent[] {
  const events: AdminAccountActivityEvent[] = [];
  const deletionActors = new Map<string, string>();
  for (const event of snapshot.deletionAdminEvents) {
    const scheduledFor = normalizeTimestamp(event.deletion_scheduled_for);
    // The source read is newest-first. Preserve the newest exact match if a
    // historical duplicate exists instead of letting an older row replace it.
    if (!deletionActors.has(scheduledFor)) {
      deletionActors.set(scheduledFor, event.actor_admin_user_id);
    }
  }

  for (const reason of snapshot.releaseScheduled) {
    const releaseAt = normalizeTimestamp(reason.release_at);
    events.push({
      id: `lifecycle:${reason.id}:scheduled`,
      category: "lifecycle",
      occurredAt: normalizeTimestamp(reason.triggered_at),
      title: "Account deletion scheduled",
      detail: `Terminal cleanup target: ${releaseAt}`,
      actor: deletionActors.get(releaseAt) ?? null,
    });
  }

  for (const reason of snapshot.releaseCanceled) {
    if (!reason.canceled_at) continue;
    events.push({
      id: `lifecycle:${reason.id}:canceled`,
      category: "lifecycle",
      occurredAt: normalizeTimestamp(reason.canceled_at),
      title: "Account reactivated; deletion canceled",
      detail: null,
      actor: null,
    });
  }

  addMilestone(
    events,
    "milestone:compliance",
    snapshot.milestones?.compliance_info_completed_at,
    "Compliance information completed",
  );
  addMilestone(
    events,
    "milestone:registration",
    snapshot.milestones?.onboarding_registration_submitted_at,
    "Registration submitted",
  );
  addMilestone(
    events,
    "milestone:onboarding",
    snapshot.milestones?.onboarding_completed_at,
    "Onboarding completed; account launched",
  );

  for (const event of snapshot.provisioningAdminEvents) {
    events.push({
      id: `admin:${event.id}`,
      category: "admin",
      occurredAt: normalizeTimestamp(event.created_at),
      title:
        event.action === "provisioning_job_dismissed"
          ? "Provisioning issue dismissed"
          : "Provisioning issue restored",
      detail: null,
      actor: event.actor_admin_user_id,
    });
  }

  for (const event of snapshot.riskEvents) {
    if (!event.created_at) continue;
    const title = knownTitle(RISK_TITLES, event.event_type);
    if (!title) continue;
    events.push({
      id: `risk:${event.id}`,
      category: "risk_review",
      occurredAt: normalizeTimestamp(event.created_at),
      title,
      detail: null,
      actor:
        event.event_type === "admin_approved"
          ? sanitizeActor(event.reviewed_by)
          : null,
    });
  }

  for (const event of snapshot.registrationEvents) {
    if (!event.created_at) continue;
    const title = knownTitle(REGISTRATION_TITLES, event.event_type);
    if (!title) continue;
    events.push({
      id: `registration:${event.id}`,
      category: "registration",
      occurredAt: normalizeTimestamp(event.created_at),
      title,
      detail: null,
      actor: null,
    });
  }

  for (const event of snapshot.brandLinkEvents) {
    const title = knownTitle(BRAND_LINK_TITLES, event.event_type);
    if (!title) continue;
    events.push({
      id: `brand:${event.id}`,
      category: "brand",
      occurredAt: normalizeTimestamp(event.created_at),
      title,
      detail: null,
      actor: sanitizeActor(event.actor_user_id),
    });
  }

  for (const event of snapshot.rejectedBrands) {
    if (!event.archived_at) continue;
    events.push({
      id: `rejected-brand:${event.id}`,
      category: "rejection",
      occurredAt: normalizeTimestamp(event.archived_at),
      title: "Rejected brand archived",
      detail: null,
      actor: null,
    });
  }
  for (const event of snapshot.rejectedCampaigns) {
    if (!event.archived_at) continue;
    events.push({
      id: `rejected-campaign:${event.id}`,
      category: "rejection",
      occurredAt: normalizeTimestamp(event.archived_at),
      title: "Campaign archived during registration recovery",
      detail: null,
      actor: null,
    });
  }

  if (snapshot.calendar?.created_at) {
    events.push({
      id: `calendar:${snapshot.businessId}:current`,
      category: "calendar",
      occurredAt: normalizeTimestamp(snapshot.calendar.created_at),
      title: "Calendar connected",
      detail: null,
      actor: null,
    });
  }

  return events
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 100);
}

const RISK_TITLES: Readonly<Record<string, string>> = {
  scan_passed: "A2P risk screening passed",
  scan_blocked: "A2P risk screening blocked",
  scan_pending_review: "A2P risk review requested",
  review_email_sent: "A2P review notification sent",
  admin_approved: "A2P risk review approved",
};

const REGISTRATION_TITLES: Readonly<Record<string, string>> = {
  brand_submitted: "Brand submission attempt recorded",
  brand_status_changed: "Brand registration status update recorded",
  campaign_submitted: "Campaign submission attempt recorded",
  campaign_status_changed: "Campaign registration status update recorded",
  campaign_status_refreshed: "Campaign registration status check recorded",
  messaging_profile_created: "Messaging-profile creation attempt recorded",
  messaging_profile_create_intent: "Messaging-profile creation intent recorded",
  voice_application_created: "Voice-application creation attempt recorded",
  voice_application_create_intent: "Voice-application creation intent recorded",
  campaign_preflight_checked: "Campaign preflight check recorded",
  phone_number_assignment_started: "Phone-number assignment start recorded",
  phone_number_assignment_status_changed:
    "Phone-number assignment status update recorded",
  phone_number_assignment_failed: "Phone-number assignment failed",
};

const BRAND_LINK_TITLES: Readonly<Record<string, string>> = {
  approval_invalidated: "Existing-brand approval invalidated",
  inspection_recorded: "Existing-brand inspection recorded",
  link_staged: "Existing brand link staged",
  link_approved: "Existing brand link approved",
  link_blocked: "Existing brand link blocked",
  link_reset: "Existing brand link reset",
  link_consumed: "Existing brand linked",
};

function knownTitle(
  titles: Readonly<Record<string, string>>,
  eventType: string,
): string | null {
  return Object.prototype.hasOwnProperty.call(titles, eventType)
    ? titles[eventType]
    : null;
}

function sanitizeActor(value: string | null): string | null {
  if (value === null) return null;
  const parsed = safeActorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function addMilestone(
  events: AdminAccountActivityEvent[],
  id: string,
  occurredAt: string | null | undefined,
  title: string,
) {
  if (!occurredAt) return;
  events.push({
    id,
    category: "lifecycle",
    occurredAt: normalizeTimestamp(occurredAt),
    title,
    detail: null,
    actor: null,
  });
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function parseRows<Schema extends z.ZodTypeAny>(
  source: string,
  result: ReadResult,
  rowSchema: Schema,
): z.infer<Schema>[] {
  assertQuerySucceeded(source, result);
  const parsed = z.array(rowSchema).safeParse(result.data);
  if (!parsed.success) throw invalidResponse(source, parsed.error);
  return parsed.data;
}

function parseOptionalRow<Schema extends z.ZodTypeAny>(
  source: string,
  result: ReadResult,
  rowSchema: Schema,
): z.infer<Schema> | null {
  assertQuerySucceeded(source, result);
  const parsed = rowSchema.nullable().safeParse(result.data);
  if (!parsed.success) throw invalidResponse(source, parsed.error);
  return parsed.data;
}

function parseRequiredRow<Schema extends z.ZodTypeAny>(
  source: string,
  result: ReadResult,
  rowSchema: Schema,
): z.infer<Schema> {
  assertQuerySucceeded(source, result);
  const parsed = rowSchema.safeParse(result.data);
  if (!parsed.success) throw invalidResponse(source, parsed.error);
  return parsed.data;
}

function assertQuerySucceeded(source: string, result: ReadResult) {
  if (result.error) {
    throw new AdminAccountActivityUnavailableError(
      "query_failed",
      source,
      `Could not load ${source}.`,
      result.error,
    );
  }
}

function invalidResponse(source: string, cause: unknown) {
  return new AdminAccountActivityUnavailableError(
    "invalid_response",
    source,
    `${source} returned an invalid activity snapshot.`,
    cause,
  );
}
