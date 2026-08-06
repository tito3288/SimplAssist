import {
  statusDanger,
  statusInfo,
  statusNeutral,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";
import type {
  AdminAccountHealth,
  AdminFailedSetupReasonCode,
  AdminHealthTone,
} from "@/lib/admin/accountHealth";
import type { AdminBusinessLifecycle } from "@/lib/admin/accountLifecycle";

export type AdminAccountChipCategory =
  | "lifecycle"
  | "operations"
  | "billing"
  | "pipeline"
  | "product"
  | "activity";

export type AdminAccountChipDescriptor = {
  id: string;
  label: string;
  tone: AdminHealthTone;
  category: AdminAccountChipCategory;
  rank: number;
  primaryLifecycle: boolean;
};

export type AdminAccountListChipFacts = {
  lifecycle: AdminBusinessLifecycle;
  riskReviewStatus: string | null;
  brandStatus: string | null;
  campaignStatus: string | null;
  telnyxSubmissionDisabled: boolean;
  billingPilot: boolean;
  billingComped: boolean;
  billingExempt: boolean;
  deletionScheduledFor: string | null;
};

const FAILED_SETUP_RANK = {
  registration_failed: 0,
  registration_submission_stale: 1,
  risk_review_blocked: 2,
  brand_rejected: 3,
  campaign_rejected: 4,
  phone_assignment_failed: 5,
  pending_phone_failed: 6,
  provisioning_needs_attention: 7,
  provisioning_invite_failed: 8,
  provisioning_lease_expired: 9,
} as const satisfies Record<AdminFailedSetupReasonCode, number>;

export function buildAdminAccountChipDescriptors({
  health,
  listAccount,
}: {
  health: AdminAccountHealth | null;
  listAccount?: AdminAccountListChipFacts;
}): AdminAccountChipDescriptor[] {
  const healthDescriptors =
    listAccount?.lifecycle === "terminal" || !health
      ? []
      : buildHealthDescriptors(health);
  const listDescriptors = listAccount
    ? buildListDescriptors(listAccount, health !== null)
    : [];

  return [...healthDescriptors, ...listDescriptors].sort(compareDescriptors);
}

export function AdminAccountHealthChips({
  health,
  listAccount,
}: {
  health: AdminAccountHealth | null;
  listAccount?: AdminAccountListChipFacts;
}) {
  const isListPresentation = listAccount !== undefined;
  const descriptors = isListPresentation
    ? buildAdminAccountChipDescriptors({ health, listAccount })
    : health
      ? buildHealthDescriptors(health)
      : [];
  const collapsed = isListPresentation
    ? descriptors.filter(isCollapsibleDescriptor)
    : [];
  const visible = isListPresentation
    ? descriptors.filter((descriptor) => !isCollapsibleDescriptor(descriptor))
    : descriptors;

  if (descriptors.length === 0) return null;

  return (
    <div aria-label="Account health" className="mt-2 flex flex-wrap gap-2">
      {visible.map((descriptor) => (
        <HealthChip key={descriptor.id} tone={descriptor.tone}>
          {descriptor.label}
        </HealthChip>
      ))}
      {collapsed.length > 0 ? (
        <details className="basis-full">
          <summary
            className={`inline-flex cursor-pointer rounded-full px-2 py-0.5 text-xs marker:hidden ${statusNeutral}`}
          >
            +{collapsed.length} more
          </summary>
          <div
            aria-label="More account health"
            className="mt-2 flex flex-wrap gap-2"
          >
            {collapsed.map((descriptor) => (
              <HealthChip key={descriptor.id} tone={descriptor.tone}>
                {descriptor.label}
              </HealthChip>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function buildHealthDescriptors(
  health: AdminAccountHealth,
): AdminAccountChipDescriptor[] {
  const descriptors: AdminAccountChipDescriptor[] = [];
  const lifecycle = lifecyclePresentation(health);
  const phone = phonePresentation(health);
  const registration = registrationPresentation(health);
  const ai = aiPresentation(health);
  const booking = bookingPresentation(health);
  const lifecycleHasPriority =
    health.lifecycle.state === "pending_deletion" ||
    health.lifecycle.state === "terminal";
  const lifecycleDescriptor = descriptor({
    id: "health.lifecycle",
    label: lifecycle.label,
    tone: lifecycle.tone,
    category: "lifecycle",
    rank: 0,
    primaryLifecycle: true,
  });

  if (lifecycleHasPriority) descriptors.push(lifecycleDescriptor);
  if (health.operations.state === "suspended") {
    descriptors.push(
      descriptor({
        id: "health.operations.suspended",
        label: "Account suspended",
        tone: "danger",
        category: "operations",
        rank: 0,
      }),
    );
  }
  if (health.operations.services.aiReplies.pausedAt) {
    descriptors.push(
      descriptor({
        id: "health.operations.ai_replies_paused",
        label: "AI replies paused",
        tone: "warning",
        category: "operations",
        rank: 10,
      }),
    );
  }
  if (health.operations.services.texting.pausedAt) {
    descriptors.push(
      descriptor({
        id: "health.operations.texting_paused",
        label: "Texting paused",
        tone: "warning",
        category: "operations",
        rank: 20,
      }),
    );
  }
  if (health.operations.services.bookings.pausedAt) {
    descriptors.push(
      descriptor({
        id: "health.operations.bookings_paused",
        label: "Bookings paused",
        tone: "warning",
        category: "operations",
        rank: 30,
      }),
    );
  }
  if (!lifecycleHasPriority) descriptors.push(lifecycleDescriptor);

  descriptors.push(
    descriptor({
      id: "health.billing",
      label: billingLabel(health),
      tone: billingTone(health),
      category: "billing",
      rank: 0,
    }),
  );
  if (health.billing.pastDue) {
    descriptors.push(
      descriptor({
        id: "health.billing.past_due",
        label: "Past due",
        tone: "warning",
        category: "billing",
        rank: 10,
      }),
    );
  }
  descriptors.push(
    descriptor({
      id: "health.sms",
      label: phone.label,
      tone: phone.tone,
      category: "pipeline",
      rank: 10,
    }),
    descriptor({
      id: "health.a2p",
      label: registration.label,
      tone: registration.tone,
      category: "pipeline",
      rank: 20,
    }),
    descriptor({
      id: "health.calendar",
      label: `Calendar: ${health.calendar.connected ? "connected" : "not connected"}`,
      tone: health.calendar.connected ? "success" : "neutral",
      category: "product",
      rank: 0,
    }),
    descriptor({
      id: "health.ai",
      label: ai.label,
      tone: ai.tone,
      category: "product",
      rank: 10,
    }),
    descriptor({
      id: "health.booking",
      label: booking.label,
      tone: booking.tone,
      category: "product",
      rank: 20,
    }),
  );
  health.failedSetup.reasons.forEach((reason) => {
    descriptors.push(
      descriptor({
        id: `health.setup.${reason.code}`,
        label: `Setup: ${reason.label}`,
        tone: "danger",
        category: "pipeline",
        rank: 30 + FAILED_SETUP_RANK[reason.code],
      }),
    );
  });
  descriptors.push(
    descriptor({
      id: "health.activity",
      label: `Last activity: ${formatTimestamp(health.lastActivityAt)}`,
      tone: health.lastActivityAt ? "info" : "neutral",
      category: "activity",
      rank: 0,
    }),
  );

  return descriptors;
}

function buildListDescriptors(
  account: AdminAccountListChipFacts,
  hasHealth: boolean,
): AdminAccountChipDescriptor[] {
  if (account.lifecycle === "terminal") {
    return [
      descriptor({
        id: "row.lifecycle.terminal",
        label: "Terminally cleaned",
        tone: "danger",
        category: "lifecycle",
        rank: 0,
        primaryLifecycle: true,
      }),
    ];
  }

  const descriptors = [
    descriptor({
      id: "row.risk",
      label: `Risk: ${account.riskReviewStatus ?? "not_started"}`,
      tone: "neutral",
      category: "pipeline",
      rank: 0,
    }),
    descriptor({
      id: "row.brand",
      label: `Brand: ${account.brandStatus ?? "not submitted"}`,
      tone: "neutral",
      category: "pipeline",
      rank: 1,
    }),
    descriptor({
      id: "row.campaign",
      label: `Campaign: ${account.campaignStatus ?? "not submitted"}`,
      tone: "neutral",
      category: "pipeline",
      rank: 2,
    }),
  ];

  if (account.telnyxSubmissionDisabled) {
    descriptors.push(
      descriptor({
        id: "row.telnyx_submission_disabled",
        label: "No Telnyx submit",
        tone: "danger",
        category: "pipeline",
        rank: 0,
      }),
    );
  }
  if (account.billingPilot) {
    descriptors.push(
      descriptor({
        id: "row.billing.pilot",
        label: "Pilot",
        tone: "neutral",
        category: "billing",
        rank: 10,
      }),
    );
  }
  if (account.billingComped) {
    descriptors.push(
      descriptor({
        id: "row.billing.comped",
        label: "Comped",
        tone: "neutral",
        category: "billing",
        rank: 20,
      }),
    );
  }
  if (account.billingExempt) {
    descriptors.push(
      descriptor({
        id: "row.billing.exempt",
        label: "Billing exempt",
        tone: "neutral",
        category: "billing",
        rank: 30,
      }),
    );
  }
  if (account.lifecycle === "scheduled") {
    descriptors.push(
      descriptor({
        id: "row.lifecycle.deletion_scheduled",
        label: `Deletion scheduled${
          account.deletionScheduledFor
            ? ` · ${formatDate(account.deletionScheduledFor)}`
            : ""
        }`,
        tone: "warning",
        category: "lifecycle",
        rank: 10,
        primaryLifecycle: !hasHealth,
      }),
    );
  }

  return descriptors;
}

function descriptor(
  value: Omit<AdminAccountChipDescriptor, "primaryLifecycle"> & {
    primaryLifecycle?: boolean;
  },
): AdminAccountChipDescriptor {
  return { ...value, primaryLifecycle: value.primaryLifecycle ?? false };
}

function compareDescriptors(
  left: AdminAccountChipDescriptor,
  right: AdminAccountChipDescriptor,
): number {
  if (left.primaryLifecycle !== right.primaryLifecycle) {
    return left.primaryLifecycle ? -1 : 1;
  }
  const toneDifference = toneRank(left.tone) - toneRank(right.tone);
  if (toneDifference !== 0) return toneDifference;
  const categoryDifference =
    categoryRank(left.category) - categoryRank(right.category);
  if (categoryDifference !== 0) return categoryDifference;
  if (left.rank !== right.rank) return left.rank - right.rank;
  return left.id.localeCompare(right.id);
}

function isCollapsibleDescriptor(
  descriptor: AdminAccountChipDescriptor,
): boolean {
  return (
    !descriptor.primaryLifecycle &&
    (descriptor.tone === "info" || descriptor.tone === "neutral")
  );
}

function toneRank(tone: AdminHealthTone): number {
  return {
    danger: 0,
    warning: 1,
    success: 2,
    info: 3,
    neutral: 3,
  }[tone];
}

function categoryRank(category: AdminAccountChipCategory): number {
  return {
    lifecycle: 0,
    operations: 1,
    billing: 2,
    pipeline: 3,
    product: 4,
    activity: 5,
  }[category];
}

function HealthChip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: AdminHealthTone;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${toneClass(tone)}`}
    >
      {children}
    </span>
  );
}

function lifecyclePresentation(health: AdminAccountHealth): {
  label: string;
  tone: AdminHealthTone;
} {
  switch (health.lifecycle.state) {
    case "live":
      return { label: "Lifecycle: live", tone: "success" };
    case "onboarding":
      return {
        label: `Onboarding: ${health.lifecycle.onboardingStepLabel}`,
        tone: "info",
      };
    case "pending_deletion":
      return { label: "Lifecycle: pending deletion", tone: "warning" };
    case "terminal":
      return { label: "Lifecycle: terminal", tone: "danger" };
  }
}

function billingLabel(health: AdminAccountHealth): string {
  if (isBillingNotStarted(health)) {
    return "Billing: not started · no subscription";
  }
  const plan = health.billing.plan
    ? humanize(health.billing.plan)
    : "unresolved plan";
  const authority =
    health.billing.mode === "stripe"
      ? (health.billing.status ?? "unknown")
      : health.billing.mode;
  return `Billing: ${plan} · ${humanize(authority)}`;
}

function billingTone(health: AdminAccountHealth): AdminHealthTone {
  if (isBillingNotStarted(health)) return "neutral";
  if (health.billing.state === "unknown") return "danger";
  if (health.billing.state === "inactive") return "danger";
  return "success";
}

function isBillingNotStarted(health: AdminAccountHealth): boolean {
  return (
    health.lifecycle.state === "onboarding" &&
    health.billing.mode === "stripe" &&
    health.billing.subscriptionPresent === false &&
    health.billing.plan === null &&
    health.billing.status === null &&
    health.billing.source === null &&
    health.billing.state === "unknown"
  );
}

function phonePresentation(health: AdminAccountHealth): {
  label: string;
  tone: AdminHealthTone;
} {
  switch (health.phone.state) {
    case "ready":
      return { label: "SMS: ready", tone: "success" };
    case "blocked":
      return {
        label: `SMS: ${blockReasonLabel(health.phone.blockReason)}`,
        tone:
          health.phone.blockReason === "assignment_failed"
            ? "danger"
            : "warning",
      };
    case "missing":
      return { label: "SMS: no active phone", tone: "warning" };
    case "ambiguous":
      return {
        label: `SMS: ${health.phone.activeCount} active phones`,
        tone: "danger",
      };
  }
}

function registrationPresentation(health: AdminAccountHealth): {
  label: string;
  tone: AdminHealthTone;
} {
  switch (health.registration.state) {
    case "approved":
      return { label: "A2P: approved", tone: "success" };
    case "pending":
      return { label: "A2P: pending", tone: "info" };
    case "failed":
      return { label: "A2P: submission failed", tone: "danger" };
    case "blocked":
      return { label: "A2P: risk blocked", tone: "danger" };
    case "rejected":
      return { label: "A2P: rejected", tone: "danger" };
    case "not_started":
      return { label: "A2P: not started", tone: "neutral" };
  }
}

function aiPresentation(health: AdminAccountHealth): {
  label: string;
  tone: AdminHealthTone;
} {
  switch (health.ai.state) {
    case "active":
      return {
        label: `AI: active (${health.ai.operationalChannels.map(channelLabel).join(" + ")})`,
        tone: "success",
      };
    case "plan_limited":
      return { label: "AI: plan limited", tone: "warning" };
    case "setup_pending":
      return { label: "AI: setup pending", tone: "warning" };
    case "not_configured":
      return { label: "AI: not configured", tone: "neutral" };
  }
}

function bookingPresentation(health: AdminAccountHealth): {
  label: string;
  tone: AdminHealthTone;
} {
  switch (health.booking.state) {
    case "operational":
      return {
        label:
          health.booking.mode === "schedule_direct"
            ? "Booking: direct"
            : "Booking: collect info",
        tone: "success",
      };
    case "calendar_required":
      return { label: "Booking: Calendar needed", tone: "warning" };
    case "plan_limited":
      return { label: "Booking: plan limited", tone: "warning" };
    case "disabled":
      return { label: "Booking: disabled", tone: "neutral" };
    case "not_configured":
      return { label: "Booking: not configured", tone: "neutral" };
  }
}

function channelLabel(channel: "sms" | "web_chat"): string {
  return channel === "sms" ? "SMS" : "web chat";
}

function blockReasonLabel(
  reason: AdminAccountHealth["phone"]["blockReason"],
): string {
  if (!reason) return "blocked";
  return {
    campaign_not_approved: "campaign not approved",
    assignment_pending: "assignment pending",
    assignment_failed: "assignment failed",
    missing_messaging_profile: "messaging profile missing",
    missing_phone_number: "no active phone",
  }[reason];
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "none recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function toneClass(tone: AdminHealthTone): string {
  return {
    success: statusSuccess,
    warning: statusWarning,
    danger: statusDanger,
    info: statusInfo,
    neutral: statusNeutral,
  }[tone];
}
