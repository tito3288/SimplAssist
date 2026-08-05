import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  normalizeAdminAccountHealth,
  type AdminAccountHealthInput,
} from "@/lib/admin/accountHealth";
import { AdminAccountHealthChips } from "./AdminAccountHealthChips";

function healthInput(
  overrides: Partial<AdminAccountHealthInput> = {},
): AdminAccountHealthInput {
  return {
    businessId: "11111111-1111-4111-8111-111111111111",
    now: "2026-08-04T12:00:00.000Z",
    deletedAt: null,
    deletionScheduledFor: null,
    operationsSuspendedAt: null,
    aiRepliesPausedAt: null,
    textingPausedAt: null,
    bookingsPausedAt: null,
    onboardingCompletedAt: "2026-07-01T12:00:00.000Z",
    onboardingStep: "complete",
    billingMode: "stripe",
    subscriptionPresent: true,
    entitlements: {
      plan: "sms_and_chat",
      status: "active",
      source: "subscription",
      active: true,
      cancelAtPeriodEnd: false,
    },
    activePhoneCount: 1,
    anyActivePhoneAssignmentFailed: false,
    smsReadiness: {
      smsReady: true,
      blockReason: null,
      campaignStatus: "approved",
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
    },
    onboardingRegistrationStatus: "submitted",
    onboardingRegistrationStartedAt: "2026-07-01T11:00:00.000Z",
    riskReviewStatus: "passed",
    brandStatus: "approved",
    campaignStatus: "approved",
    pendingPhoneFailed: false,
    provisioning: {
      needsAttention: false,
      inviteFailed: false,
      expiredLease: false,
    },
    calendarConnected: true,
    aiConfigured: true,
    aiBookingEnabled: true,
    aiBookingMode: "schedule_direct",
    webChatEnabled: true,
    lastActivityAt: "2026-08-04T11:45:00.000Z",
    ...overrides,
  };
}

function render(overrides: Partial<AdminAccountHealthInput> = {}): string {
  return renderToStaticMarkup(
    <AdminAccountHealthChips
      health={normalizeAdminAccountHealth(healthInput(overrides))}
    />,
  );
}

function billingChipClass(html: string, label: string): string {
  const match = html.match(
    new RegExp(`<span class="([^"]*)">${label}</span>`),
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("AdminAccountHealthChips", () => {
  it("covers operational billing, lifecycle, channels, registration, and activity", () => {
    const html = render();

    for (const label of [
      "Lifecycle: live",
      "Billing: sms and chat · active",
      "SMS: ready",
      "A2P: approved",
      "Calendar: connected",
      "AI: active (SMS + web chat)",
      "Booking: direct",
      "Last activity: Aug 4, 2026, 11:45 AM",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("shows past due separately while retaining active AI presentation", () => {
    const html = render({
      entitlements: {
        plan: "sms_and_chat",
        status: "past_due",
        source: "subscription",
        active: true,
        cancelAtPeriodEnd: false,
      },
    });

    expect(html).toContain("Billing: sms and chat · past due");
    expect(html).toContain("Past due");
    expect(html).toContain("AI: active (SMS + web chat)");
  });

  it("uses the exact neutral no-subscription label only during Stripe onboarding", () => {
    const label = "Billing: not started · no subscription";
    const html = render({
      onboardingCompletedAt: null,
      onboardingStep: "business_info",
      subscriptionPresent: false,
      entitlements: null,
    });

    expect(html).toContain(label);
    const classes = billingChipClass(html, label);
    expect(classes).toContain("text-stone-600");
    expect(classes).not.toContain("text-red-700");
  });

  it.each([
    [
      "launched without a subscription",
      {
        subscriptionPresent: false,
        entitlements: null,
      },
    ],
    [
      "onboarding with a present but unresolved subscription",
      {
        onboardingCompletedAt: null,
        onboardingStep: "business_info" as const,
        subscriptionPresent: true,
        entitlements: null,
      },
    ],
    [
      "pending deletion that began before checkout",
      {
        deletedAt: "2026-08-04T12:00:00.000Z",
        deletionScheduledFor: "2026-10-03T12:00:00.000Z",
        onboardingCompletedAt: null,
        onboardingStep: "business_info" as const,
        subscriptionPresent: false,
        entitlements: null,
      },
    ],
  ])("keeps %s on the existing danger presentation", (_name, overrides) => {
    const label = "Billing: unresolved plan · unknown";
    const html = render(overrides);

    expect(html).toContain(label);
    expect(html).not.toContain("Billing: not started · no subscription");
    const classes = billingChipClass(html, label);
    expect(classes).toContain("text-red-700");
    expect(classes).not.toContain("text-stone-600");
  });

  it("does not treat unresolved partner billing as Stripe billing that has not started", () => {
    const label = "Billing: unresolved plan · invoiced";
    const html = render({
      onboardingCompletedAt: null,
      onboardingStep: "business_info",
      billingMode: "invoiced",
      subscriptionPresent: false,
      entitlements: null,
    });

    expect(html).toContain(label);
    expect(html).not.toContain("Billing: not started · no subscription");
    expect(billingChipClass(html, label)).toContain("text-red-700");
  });

  it.each([
    ["invoiced" as const, "Billing: sms and chat · invoiced"],
    ["comped" as const, "Billing: sms and chat · comped"],
  ])("preserves %s partner billing", (billingMode, label) => {
    const html = render({
      onboardingCompletedAt: null,
      billingMode,
      subscriptionPresent: false,
      entitlements: {
        plan: "sms_and_chat",
        status: "partner_billing",
        source: "partner_billing",
        active: true,
        cancelAtPeriodEnd: false,
      },
    });

    expect(html).toContain(label);
    expect(html).not.toContain("Billing: not started · no subscription");
    expect(billingChipClass(html, label)).toContain("text-green-700");
  });

  it("orders account and stored pause chips before live technical health without duplicating effective pauses", () => {
    const html = render({
      operationsSuspendedAt: "2026-08-04T11:30:00.000Z",
      textingPausedAt: "2026-08-03T09:15:00.000Z",
    });

    expect(html).toContain("Account suspended");
    expect(html).toContain("Texting paused");
    expect(html).not.toContain("AI replies paused");
    expect(html).not.toContain("Bookings paused");
    expect(html.indexOf("Account suspended")).toBeLessThan(
      html.indexOf("Texting paused"),
    );
    expect(html.indexOf("Texting paused")).toBeLessThan(
      html.indexOf("Lifecycle: live"),
    );
    expect(html.indexOf("Lifecycle: live")).toBeLessThan(
      html.indexOf("Billing:"),
    );
  });

  it.each([
    [
      "pending deletion",
      {
        deletedAt: "2026-08-04T12:00:00.000Z",
        deletionScheduledFor: "2026-10-03T12:00:00.000Z",
      },
      "Lifecycle: pending deletion",
    ],
    [
      "terminal cleanup",
      {
        deletedAt: "2026-08-04T12:00:00.000Z",
        deletionScheduledFor: null,
      },
      "Lifecycle: terminal",
    ],
  ] as const)(
    "keeps %s ahead of operation and technical chips",
    (_label, lifecycle, lifecycleChip) => {
      const html = render({
        ...lifecycle,
        operationsSuspendedAt: "2026-08-04T11:30:00.000Z",
        aiRepliesPausedAt: "2026-08-03T09:15:00.000Z",
      });

      expect(html.indexOf(lifecycleChip)).toBeLessThan(
        html.indexOf("Account suspended"),
      );
      expect(html.indexOf("Account suspended")).toBeLessThan(
        html.indexOf("AI replies paused"),
      );
      expect(html.indexOf("AI replies paused")).toBeLessThan(
        html.indexOf("Billing:"),
      );
    },
  );

  it("shows onboarding progress, ambiguous phones, and stable setup reasons", () => {
    const html = render({
      onboardingCompletedAt: null,
      onboardingStep: "legal_verification",
      activePhoneCount: 2,
      anyActivePhoneAssignmentFailed: true,
      smsReadiness: null,
      pendingPhoneFailed: true,
      lastActivityAt: null,
    });

    expect(html).toContain("Onboarding: Business Verification");
    expect(html).toContain("SMS: 2 active phones");
    expect(html).toContain("Setup: Phone assignment failed");
    expect(html).toContain("Setup: Pending number provisioning failed");
    expect(html).toContain("Last activity: none recorded");
  });

  it("never renders source failure text", () => {
    const secret = "provider-secret customer@example.com";
    const html = render({
      anyActivePhoneAssignmentFailed: true,
      smsReadiness: {
        smsReady: false,
        blockReason: "assignment_failed",
        campaignStatus: "approved",
        assignmentStatus: "failed",
        assignmentFailureReason: secret,
      },
    });

    expect(html).toContain("Setup: Phone assignment failed");
    expect(html).not.toContain(secret);
  });
});
