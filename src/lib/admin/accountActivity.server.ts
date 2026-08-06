import "server-only";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const ACCOUNT_ACTIVITY_PAGE_SIZE = 500;

export const ACCOUNT_ACTIVITY_COLUMNS = {
  milestones:
    "compliance_info_completed_at, onboarding_registration_submitted_at, onboarding_completed_at",
  releaseScheduled: "id, triggered_at, release_at",
  releaseCanceled: "id, canceled_at",
  adminActions:
    "id, action, actor_admin_user_id, created_at, deletion_scheduled_for, reason:summary->>reason, service:summary->>service",
  provisioningJob: "id",
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

export type AdminAccountActivityFacet =
  | "lifecycle"
  | "admin"
  | "registration";

export type AdminAccountActivityEvent = {
  id: string;
  category: AdminAccountActivityCategory;
  facets: readonly AdminAccountActivityFacet[];
  registrationEventType: "campaign_status_refreshed" | null;
  occurredAt: string;
  title: string;
  detail: string | null;
  actor: string | null;
};

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
const safeAdminEmailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .refine(
    (value) =>
      !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(
        value,
      ),
  );
const adminReasonSchema = z
  .string()
  .refine((value) => {
    const characterCount = Array.from(value).length;
    return characterCount >= 8 && characterCount <= 500;
  })
  .refine((value) => value === value.trim())
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value));

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
const provisioningJobSchema = z.object({ id: z.string().uuid() }).strict();
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

const OPERATIONAL_ADMIN_ACTIONS = new Set([
  "account_operations_suspended",
  "account_operations_reactivated",
  "account_service_paused",
  "account_service_resumed",
  "phone_assignment_recheck_requested",
]);
const PROVISIONING_ADMIN_ACTIONS = new Set([
  "provisioning_job_dismissed",
  "provisioning_job_restored",
]);
const ADMIN_AUTHORED_BRAND_LINK_EVENTS = new Set([
  "inspection_recorded",
  "link_staged",
  "link_approved",
  "link_reset",
]);
const OPERATIONAL_SERVICE_LABELS = {
  ai_replies: "AI replies",
  texting: "Texting",
  bookings: "Bookings",
} as const;
type OperationalService = keyof typeof OPERATIONAL_SERVICE_LABELS;

const adminActionRowSchema = z
  .object({
    id: z.string().uuid(),
    action: z.string().trim().min(1),
    actor_admin_user_id: z.string().uuid(),
    created_at: timestampSchema,
    deletion_scheduled_for: nullableTimestampSchema,
    reason: z.string().nullable(),
    service: z.string().nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.action === "account_deletion_scheduled") {
      if (
        row.deletion_scheduled_for === null ||
        row.service !== null ||
        (row.reason !== null && !adminReasonSchema.safeParse(row.reason).success)
      ) {
        context.addIssue({
          code: "custom",
          message: "Account deletion audit summary is inconsistent",
        });
      }
      return;
    }

    if (PROVISIONING_ADMIN_ACTIONS.has(row.action)) {
      if (
        row.deletion_scheduled_for !== null ||
        row.reason !== null ||
        row.service !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Provisioning audit summary is inconsistent",
        });
      }
      return;
    }

    if (!OPERATIONAL_ADMIN_ACTIONS.has(row.action)) return;
    if (row.deletion_scheduled_for !== null) {
      context.addIssue({
        code: "custom",
        message: "Operational action has a deletion target",
      });
      return;
    }
    if (row.action === "phone_assignment_recheck_requested") {
      if (row.reason !== null || row.service !== null) {
        context.addIssue({
          code: "custom",
          message: "Assignment recheck audit summary is inconsistent",
        });
      }
      return;
    }
    const isAccountAction =
      row.action === "account_operations_suspended" ||
      row.action === "account_operations_reactivated";
    if (
      isAccountAction &&
      (row.reason === null ||
        !adminReasonSchema.safeParse(row.reason).success ||
        row.service !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Account operational action summary is inconsistent",
      });
    }
    if (
      !isAccountAction &&
      (row.service === null ||
        !isOperationalService(row.service) ||
        (row.reason !== null && !adminReasonSchema.safeParse(row.reason).success))
    ) {
      context.addIssue({
        code: "custom",
        message: "Service operational action summary is inconsistent",
      });
    }
  });

type MilestonesRow = z.infer<typeof milestonesSchema>;
type ReleaseScheduledRow = z.infer<typeof releaseScheduledRowSchema>;
type ReleaseCanceledRow = z.infer<typeof releaseCanceledRowSchema>;
type AdminActionRow = z.infer<typeof adminActionRowSchema>;
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
  businessAdminEvents: AdminActionRow[];
  provisioningAdminEvents: AdminActionRow[];
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
    releaseScheduled,
    releaseCanceled,
    businessAdminEvents,
    riskEvents,
    registrationEvents,
    brandLinkEvents,
    rejectedBrands,
    rejectedCampaigns,
    calendarResult,
    provisioningAdminEvents,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select(ACCOUNT_ACTIVITY_COLUMNS.milestones)
      .eq("id", businessId)
      .maybeSingle(),
    loadAllPages(
      "deletion schedules",
      releaseScheduledRowSchema,
      (cursor) => {
        let query = supabaseAdmin
          .from("telnyx_resource_release_reasons")
          .select(ACCOUNT_ACTIVITY_COLUMNS.releaseScheduled)
          .eq("business_id", businessId)
          .eq("reason_type", "account_deletion")
          .order("id", { ascending: true })
          .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
        if (cursor !== null) query = query.gt("id", cursor);
        return query;
      },
    ),
    loadAllPages(
      "deletion cancellations",
      releaseCanceledRowSchema,
      (cursor) => {
        let query = supabaseAdmin
          .from("telnyx_resource_release_reasons")
          .select(ACCOUNT_ACTIVITY_COLUMNS.releaseCanceled)
          .eq("business_id", businessId)
          .eq("reason_type", "account_deletion")
          .not("canceled_at", "is", null)
          .order("id", { ascending: true })
          .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
        if (cursor !== null) query = query.gt("id", cursor);
        return query;
      },
    ),
    loadAllPages("business admin actions", adminActionRowSchema, (cursor) => {
      let query = supabaseAdmin
        .from("admin_action_events")
        .select(ACCOUNT_ACTIVITY_COLUMNS.adminActions)
        .eq("business_id", businessId)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    }),
    loadAllPages("risk review activity", riskRowSchema, (cursor) => {
      let query = supabaseAdmin
        .from("a2p_risk_review_events")
        .select(ACCOUNT_ACTIVITY_COLUMNS.risk)
        .eq("business_id", businessId)
        .not("created_at", "is", null)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    }),
    loadAllPages("registration activity", registrationRowSchema, (cursor) => {
      let query = supabaseAdmin
        .from("telnyx_registration_events")
        .select(ACCOUNT_ACTIVITY_COLUMNS.registration)
        .eq("business_id", businessId)
        .not("created_at", "is", null)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    }),
    loadAllPages("existing-brand activity", brandLinkRowSchema, (cursor) => {
      let query = supabaseAdmin
        .from("telnyx_brand_link_events")
        .select(ACCOUNT_ACTIVITY_COLUMNS.brandLink)
        .eq("business_id", businessId)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    }),
    loadAllPages("rejected brand history", rejectedRowSchema, (cursor) => {
      let query = supabaseAdmin
        .from("rejected_brands")
        .select(ACCOUNT_ACTIVITY_COLUMNS.rejected)
        .eq("business_id", businessId)
        .not("archived_at", "is", null)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    }),
    loadAllPages("rejected campaign history", rejectedRowSchema, (cursor) => {
      let query = supabaseAdmin
        .from("rejected_campaigns")
        .select(ACCOUNT_ACTIVITY_COLUMNS.rejected)
        .eq("business_id", businessId)
        .not("archived_at", "is", null)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    }),
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
  const calendar = parseOptionalRow(
    "Calendar connection",
    calendarResult,
    calendarSchema,
  );

  const events = normalizeAdminAccountActivity({
    businessId,
    milestones,
    releaseScheduled,
    releaseCanceled,
    businessAdminEvents,
    provisioningAdminEvents,
    riskEvents,
    registrationEvents,
    brandLinkEvents,
    rejectedBrands,
    rejectedCampaigns,
    calendar,
  });

  return resolveAdminActorEmails(
    events,
    [
      ...businessAdminEvents.map((event) => event.actor_admin_user_id),
      ...provisioningAdminEvents.map((event) => event.actor_admin_user_id),
    ],
    brandLinkEvents.flatMap((event) =>
      ADMIN_AUTHORED_BRAND_LINK_EVENTS.has(event.event_type) &&
      event.actor_user_id !== null &&
      z.string().uuid().safeParse(event.actor_user_id).success
        ? [{ eventId: `brand:${event.id}`, actorId: event.actor_user_id }]
        : [],
    ),
  );
}

async function loadProvisioningAdminEvents(
  businessId: string,
): Promise<AdminActionRow[]> {
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

  return loadAllPages(
    "provisioning admin actions",
    adminActionRowSchema,
    (cursor) => {
      let query = supabaseAdmin
        .from("admin_action_events")
        .select(ACCOUNT_ACTIVITY_COLUMNS.adminActions)
        .eq("provisioning_job_id", provisioningJob.id)
        .order("id", { ascending: true })
        .limit(ACCOUNT_ACTIVITY_PAGE_SIZE);
      if (cursor !== null) query = query.gt("id", cursor);
      return query;
    },
  );
}

export function normalizeAdminAccountActivity(
  snapshot: AdminAccountActivitySnapshot,
): AdminAccountActivityEvent[] {
  const events: AdminAccountActivityEvent[] = [];
  const deletionAudits = new Map<string, AdminActionRow[]>();
  const consumedDeletionAuditIds = new Set<string>();

  for (const event of snapshot.businessAdminEvents) {
    if (
      event.action !== "account_deletion_scheduled" ||
      event.deletion_scheduled_for === null
    ) {
      continue;
    }
    const scheduledFor = normalizeTimestamp(event.deletion_scheduled_for);
    const matching = deletionAudits.get(scheduledFor) ?? [];
    matching.push(event);
    deletionAudits.set(scheduledFor, matching);
  }
  deletionAudits.forEach((matching) => {
    matching.sort(compareAdminActionsNewestFirst);
  });

  for (const reason of snapshot.releaseScheduled) {
    const releaseAt = normalizeTimestamp(reason.release_at);
    const deletionAudit = deletionAudits.get(releaseAt)?.find(
      (candidate) => !consumedDeletionAuditIds.has(candidate.id),
    );
    if (deletionAudit) consumedDeletionAuditIds.add(deletionAudit.id);
    events.push({
      id: `lifecycle:${reason.id}:scheduled`,
      category: "lifecycle",
      facets: deletionAudit ? ["lifecycle", "admin"] : ["lifecycle"],
      registrationEventType: null,
      occurredAt: normalizeTimestamp(reason.triggered_at),
      title: "Account deletion scheduled",
      detail: deletionAudit?.reason
        ? `Reason: ${deletionAudit.reason} · Terminal cleanup target: ${releaseAt}`
        : `Terminal cleanup target: ${releaseAt}`,
      actor: deletionAudit?.actor_admin_user_id ?? null,
    });
  }

  for (const reason of snapshot.releaseCanceled) {
    if (!reason.canceled_at) continue;
    events.push({
      id: `lifecycle:${reason.id}:canceled`,
      category: "lifecycle",
      facets: ["lifecycle"],
      registrationEventType: null,
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

  for (const event of snapshot.businessAdminEvents) {
    if (event.action === "account_deletion_scheduled") {
      if (!consumedDeletionAuditIds.has(event.id)) {
        events.push(standaloneDeletionAudit(event));
      }
      continue;
    }
    events.push(normalizeAdminAction(event, "business"));
  }

  for (const event of snapshot.provisioningAdminEvents) {
    events.push(normalizeAdminAction(event, "provisioning"));
  }

  for (const event of snapshot.riskEvents) {
    if (!event.created_at) continue;
    const title = knownTitle(RISK_TITLES, event.event_type);
    const isKnown = title !== null;
    events.push({
      id: `risk:${event.id}`,
      category: "risk_review",
      facets: ["registration"],
      registrationEventType: null,
      occurredAt: normalizeTimestamp(event.created_at),
      title: title ?? "A2P risk review event recorded",
      detail: null,
      actor:
        isKnown && event.event_type === "admin_approved"
          ? sanitizeActor(event.reviewed_by)
          : null,
    });
  }

  for (const event of snapshot.registrationEvents) {
    if (!event.created_at) continue;
    const title = knownTitle(REGISTRATION_TITLES, event.event_type);
    events.push({
      id: `registration:${event.id}`,
      category: "registration",
      facets: ["registration"],
      registrationEventType:
        event.event_type === "campaign_status_refreshed"
          ? "campaign_status_refreshed"
          : null,
      occurredAt: normalizeTimestamp(event.created_at),
      title: title ?? "Registration event recorded",
      detail: null,
      actor: null,
    });
  }

  for (const event of snapshot.brandLinkEvents) {
    const title = knownTitle(BRAND_LINK_TITLES, event.event_type);
    const isKnown = title !== null;
    events.push({
      id: `brand:${event.id}`,
      category: "brand",
      facets: ["registration"],
      registrationEventType: null,
      occurredAt: normalizeTimestamp(event.created_at),
      title: title ?? "Existing-brand event recorded",
      detail: null,
      actor: isKnown ? sanitizeActor(event.actor_user_id) : null,
    });
  }

  for (const event of snapshot.rejectedBrands) {
    if (!event.archived_at) continue;
    events.push({
      id: `rejected-brand:${event.id}`,
      category: "rejection",
      facets: ["registration"],
      registrationEventType: null,
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
      facets: ["registration"],
      registrationEventType: null,
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
      facets: [],
      registrationEventType: null,
      occurredAt: normalizeTimestamp(snapshot.calendar.created_at),
      title: "Calendar connected",
      detail: null,
      actor: null,
    });
  }

  return events.sort(compareActivityEventsNewestFirst);
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

function normalizeAdminAction(
  event: AdminActionRow,
  association: "business" | "provisioning",
): AdminAccountActivityEvent {
  const knownOperational = OPERATIONAL_ADMIN_ACTIONS.has(event.action);
  const knownProvisioning = PROVISIONING_ADMIN_ACTIONS.has(event.action);
  if (knownOperational) {
    return {
      id: `admin:${event.id}`,
      category: "admin",
      facets: ["admin"],
      registrationEventType: null,
      occurredAt: normalizeTimestamp(event.created_at),
      title: operationalAdminTitle(event),
      detail: event.reason,
      actor: event.actor_admin_user_id,
    };
  }
  if (knownProvisioning) {
    return {
      id: `admin:${event.id}`,
      category: "admin",
      facets: ["admin"],
      registrationEventType: null,
      occurredAt: normalizeTimestamp(event.created_at),
      title:
        event.action === "provisioning_job_dismissed"
          ? "Provisioning issue dismissed"
          : "Provisioning issue restored",
      detail: null,
      actor: event.actor_admin_user_id,
    };
  }
  return {
    id: `admin:${event.id}`,
    category: "admin",
    facets: ["admin"],
    registrationEventType: null,
    occurredAt: normalizeTimestamp(event.created_at),
    title:
      association === "provisioning"
        ? "Provisioning admin action recorded"
        : "Admin action recorded",
    detail: null,
    actor: null,
  };
}

function standaloneDeletionAudit(
  event: AdminActionRow,
): AdminAccountActivityEvent {
  if (event.deletion_scheduled_for === null) {
    throw new Error("Deletion audit is missing its scheduled target");
  }
  const releaseAt = normalizeTimestamp(event.deletion_scheduled_for);
  return {
    id: `admin:${event.id}`,
    category: "admin",
    facets: ["admin"],
    registrationEventType: null,
    occurredAt: normalizeTimestamp(event.created_at),
    title: "Account deletion scheduled",
    detail: event.reason
      ? `Reason: ${event.reason} · Terminal cleanup target: ${releaseAt}`
      : `Terminal cleanup target: ${releaseAt}`,
    actor: event.actor_admin_user_id,
  };
}

function operationalAdminTitle(event: AdminActionRow): string {
  if (event.action === "phone_assignment_recheck_requested") {
    return "Phone assignment recheck requested";
  }
  if (event.action === "account_operations_suspended") {
    return "Account operations suspended";
  }
  if (event.action === "account_operations_reactivated") {
    return "Account operations reactivated";
  }
  if (!isOperationalService(event.service)) {
    throw new Error("Operational service action is missing its service");
  }
  return `${OPERATIONAL_SERVICE_LABELS[event.service]} ${
    event.action === "account_service_paused" ? "paused" : "resumed"
  }`;
}

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

function sanitizeAdminEmail(value: string | null): string | null {
  if (value === null) return null;
  const parsed = safeAdminEmailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function resolveAdminActorEmails(
  events: AdminAccountActivityEvent[],
  actorAdminUserIds: readonly string[],
  brandLinkAdminActors: readonly { eventId: string; actorId: string }[],
): Promise<AdminAccountActivityEvent[]> {
  const provenanceIds = new Set(actorAdminUserIds);
  const brandActorByEventId = new Map(
    brandLinkAdminActors.map(({ eventId, actorId }) => [eventId, actorId]),
  );
  const visibleActorIds = Array.from(
    new Set(
      events.flatMap((event) =>
        isResolvableAdminActorEvent(
          event,
          provenanceIds,
          brandActorByEventId,
        )
          ? [event.actor]
          : [],
      ),
    ),
  );
  const resolvedEntries = await Promise.all(
    visibleActorIds.map(async (actorId) => {
      try {
        const result = await supabaseAdmin.auth.admin.getUserById(actorId);
        if (result.error) return [actorId, null] as const;
        return [
          actorId,
          sanitizeAdminEmail(result.data.user?.email ?? null),
        ] as const;
      } catch {
        return [actorId, null] as const;
      }
    }),
  );
  const emailByActorId = new Map<string, string>();
  for (const [actorId, email] of resolvedEntries) {
    if (email !== null) emailByActorId.set(actorId, email);
  }
  if (emailByActorId.size === 0) return events;

  return events.map((event) => {
    if (!isResolvableAdminActorEvent(event, provenanceIds, brandActorByEventId)) {
      return event;
    }
    const email = emailByActorId.get(event.actor);
    return email ? { ...event, actor: email } : event;
  });
}

function isResolvableAdminActorEvent(
  event: AdminAccountActivityEvent,
  adminActionActorIds: ReadonlySet<string>,
  brandActorByEventId: ReadonlyMap<string, string>,
): event is AdminAccountActivityEvent & { actor: string } {
  if (event.actor === null) return false;
  return (
    (event.facets.includes("admin") && adminActionActorIds.has(event.actor)) ||
    brandActorByEventId.get(event.id) === event.actor
  );
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
    facets: ["lifecycle"],
    registrationEventType: null,
    occurredAt: normalizeTimestamp(occurredAt),
    title,
    detail: null,
    actor: null,
  });
}

function compareAdminActionsNewestFirst(
  left: AdminActionRow,
  right: AdminActionRow,
): number {
  return (
    Date.parse(right.created_at) - Date.parse(left.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function compareActivityEventsNewestFirst(
  left: AdminAccountActivityEvent,
  right: AdminAccountActivityEvent,
): number {
  return (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function isOperationalService(value: string | null): value is OperationalService {
  return (
    value !== null &&
    Object.prototype.hasOwnProperty.call(OPERATIONAL_SERVICE_LABELS, value)
  );
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

async function loadAllPages<Schema extends z.ZodTypeAny>(
  source: string,
  rowSchema: Schema,
  fetchPage: (cursor: string | null) => PromiseLike<ReadResult>,
): Promise<z.infer<Schema>[]> {
  const rows: z.infer<Schema>[] = [];
  let cursor: string | null = null;

  while (true) {
    const page: Array<z.infer<Schema>> = parseRows(
      source,
      await fetchPage(cursor),
      rowSchema,
    );
    if (page.length === 0) return rows;
    const nextCursor: string = (page.at(-1) as { id: string }).id;
    if (cursor !== null && nextCursor <= cursor) {
      throw invalidResponse(
        source,
        new Error("Activity page did not advance its ID cursor"),
      );
    }
    rows.push(...page);
    cursor = nextCursor;
  }
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
