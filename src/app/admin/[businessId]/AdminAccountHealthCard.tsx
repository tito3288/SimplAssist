import type { AdminAccountHealth } from "@/lib/admin/accountHealth";
import {
  bodyFaint,
  card,
  statusDanger,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";
import { AdminAccountHealthChips } from "../AdminAccountHealthChips";

export function AdminAccountHealthCard({
  health,
}: {
  health: AdminAccountHealth;
}) {
  return (
    <section className={`${card} p-5 sm:p-6`} aria-labelledby="account-health">
      <div>
        <h2 id="account-health" className="text-lg font-semibold">
          Account health
        </h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Durable operations, billing, setup, channel, and activity signals.
        </p>
      </div>

      <AdminAccountHealthChips health={health} />

      {health.billing.pastDue ? (
        <div className={`mt-4 rounded-2xl px-4 py-3 ${statusWarning}`}>
          <p className="text-sm font-semibold">Payment is past due</p>
          <p className="mt-1 text-xs">
            Existing feature entitlements remain active while Stripe recovery is
            in progress.
          </p>
        </div>
      ) : null}

      {health.failedSetup.failed ? (
        <div className={`mt-4 rounded-2xl px-4 py-3 ${statusDanger}`}>
          <p className="text-sm font-semibold">Setup needs attention</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {health.failedSetup.reasons.map((reason) => (
              <li key={reason.code}>{reason.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <HealthSection title="Operations">
          <HealthRow
            label="Account operations"
            value={
              health.operations.state === "suspended"
                ? "Suspended"
                : "Active"
            }
          />
          <HealthRow
            label="Suspended at"
            value={formatTimestamp(health.operations.suspendedAt)}
          />
          <HealthRow
            label="AI replies"
            value={serviceStateLabel(
              health.operations.services.aiReplies.state,
            )}
          />
          <HealthRow
            label="AI replies paused at"
            value={formatTimestamp(
              health.operations.services.aiReplies.pausedAt,
            )}
          />
          <HealthRow
            label="Texting"
            value={serviceStateLabel(health.operations.services.texting.state)}
          />
          <HealthRow
            label="Texting paused at"
            value={formatTimestamp(health.operations.services.texting.pausedAt)}
          />
          <HealthRow
            label="Bookings"
            value={serviceStateLabel(health.operations.services.bookings.state)}
          />
          <HealthRow
            label="Bookings paused at"
            value={formatTimestamp(health.operations.services.bookings.pausedAt)}
          />
        </HealthSection>

        <HealthSection title="Lifecycle and activity">
          <HealthRow label="Lifecycle" value={lifecycleLabel(health)} />
          {health.lifecycle.state === "onboarding" ? (
            <HealthRow
              label="Onboarding step"
              value={health.lifecycle.onboardingStepLabel}
            />
          ) : null}
          {health.lifecycle.state === "pending_deletion" ? (
            <HealthRow
              label="Terminal cleanup"
              value={formatTimestamp(health.lifecycle.deletionScheduledFor)}
            />
          ) : null}
          <HealthRow
            label="Last activity"
            value={formatTimestamp(health.lastActivityAt)}
          />
        </HealthSection>

        <HealthSection title="Billing">
          <HealthRow label="Mode" value={humanize(health.billing.mode)} />
          <HealthRow
            label="Plan"
            value={health.billing.plan ? humanize(health.billing.plan) : "Unknown"}
          />
          <HealthRow
            label="Status"
            value={
              health.billing.status
                ? humanize(health.billing.status)
                : "Unresolved"
            }
          />
          <HealthRow
            label="Features active"
            value={
              health.billing.state === "active" ||
              health.billing.state === "past_due"
                ? "Yes"
                : "No"
            }
          />
          <HealthRow
            label="Cancel at period end"
            value={health.billing.cancelAtPeriodEnd ? "Yes" : "No"}
          />
        </HealthSection>

        <HealthSection title="Phone and A2P registration">
          <HealthRow
            label="Active phones"
            value={String(health.phone.activeCount)}
          />
          <HealthRow label="SMS readiness" value={phoneLabel(health)} />
          <HealthRow
            label="Assignment"
            value={
              health.phone.assignmentStatus
                ? humanize(health.phone.assignmentStatus)
                : "None"
            }
          />
          <HealthRow
            label="Registration submit"
            value={humanize(health.registration.onboardingStatus)}
          />
          <HealthRow
            label="Risk review"
            value={humanize(health.registration.riskReviewStatus)}
          />
          <HealthRow
            label="Brand"
            value={health.registration.brandStatus ?? "Not submitted"}
          />
          <HealthRow
            label="Campaign"
            value={health.registration.campaignStatus ?? "Not submitted"}
          />
        </HealthSection>

        <HealthSection title="AI, Calendar, and booking">
          <HealthRow
            label="AI configuration"
            value={health.ai.configured ? "Configured" : "Not configured"}
          />
          <HealthRow label="AI status" value={humanize(health.ai.state)} />
          <HealthRow label="AI over SMS" value={humanize(health.ai.sms)} />
          <HealthRow
            label="AI web chat"
            value={humanize(health.ai.webChat)}
          />
          <HealthRow
            label="Calendar"
            value={health.calendar.connected ? "Connected" : "Not connected"}
          />
          <HealthRow label="Booking" value={bookingLabel(health)} />
        </HealthSection>
      </div>
    </section>
  );
}

function HealthSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${tile} p-4`}>
      <h3 className="font-semibold">{title}</h3>
      <dl className="mt-3 space-y-2 text-sm">{children}</dl>
    </section>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={bodyFaint}>{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function lifecycleLabel(health: AdminAccountHealth): string {
  return {
    live: "Live",
    onboarding: "Onboarding",
    pending_deletion: "Pending deletion",
    terminal: "Terminal",
  }[health.lifecycle.state];
}

function phoneLabel(health: AdminAccountHealth): string {
  if (health.phone.state === "ready") return "Ready";
  if (health.phone.state === "missing") return "No active phone";
  if (health.phone.state === "ambiguous") {
    return `Ambiguous (${health.phone.activeCount} active phones)`;
  }
  return health.phone.blockReason
    ? `Blocked: ${humanize(health.phone.blockReason)}`
    : "Blocked";
}

function bookingLabel(health: AdminAccountHealth): string {
  if (health.booking.state === "operational") {
    return health.booking.mode === "schedule_direct"
      ? "Direct booking operational"
      : "Collect-info booking operational";
  }
  if (health.booking.state === "calendar_required") {
    return "Direct booking needs Calendar";
  }
  if (health.booking.state === "plan_limited") {
    return "Direct booking plan limited";
  }
  return health.booking.state === "not_configured"
    ? "Not configured"
    : "Disabled";
}

function serviceStateLabel(state: "active" | "paused"): string {
  return state === "paused" ? "Paused" : "Active";
}

function humanize(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "None recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
