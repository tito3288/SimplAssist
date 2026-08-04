import {
  statusDanger,
  statusInfo,
  statusNeutral,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";
import type {
  AdminAccountHealth,
  AdminHealthTone,
} from "@/lib/admin/accountHealth";

export function AdminAccountHealthChips({
  health,
}: {
  health: AdminAccountHealth;
}) {
  const lifecycle = lifecyclePresentation(health);
  const phone = phonePresentation(health);
  const registration = registrationPresentation(health);
  const ai = aiPresentation(health);
  const booking = bookingPresentation(health);

  return (
    <div
      aria-label="Account health"
      className="mt-2 flex flex-wrap gap-2"
    >
      <HealthChip tone={lifecycle.tone}>{lifecycle.label}</HealthChip>
      <HealthChip tone={billingTone(health)}>
        {billingLabel(health)}
      </HealthChip>
      {health.billing.pastDue ? (
        <HealthChip tone="warning">Past due</HealthChip>
      ) : null}
      <HealthChip tone={phone.tone}>{phone.label}</HealthChip>
      <HealthChip tone={registration.tone}>{registration.label}</HealthChip>
      <HealthChip tone={health.calendar.connected ? "success" : "neutral"}>
        Calendar: {health.calendar.connected ? "connected" : "not connected"}
      </HealthChip>
      <HealthChip tone={ai.tone}>{ai.label}</HealthChip>
      <HealthChip tone={booking.tone}>{booking.label}</HealthChip>
      {health.failedSetup.reasons.map((reason) => (
        <HealthChip key={reason.code} tone="danger">
          Setup: {reason.label}
        </HealthChip>
      ))}
      <HealthChip tone={health.lastActivityAt ? "info" : "neutral"}>
        Last activity: {formatTimestamp(health.lastActivityAt)}
      </HealthChip>
    </div>
  );
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
  if (health.billing.state === "unknown") return "danger";
  if (health.billing.state === "inactive") return "danger";
  return "success";
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

function toneClass(tone: AdminHealthTone): string {
  return {
    success: statusSuccess,
    warning: statusWarning,
    danger: statusDanger,
    info: statusInfo,
    neutral: statusNeutral,
  }[tone];
}
