import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  normalizeAdminAccountHealth,
  type AdminAccountHealthInput,
} from "@/lib/admin/accountHealth";
import { AdminAccountHealthCard } from "./AdminAccountHealthCard";

function input(
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
      plan: "full",
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
    <AdminAccountHealthCard
      health={normalizeAdminAccountHealth(input(overrides))}
    />,
  );
}

describe("AdminAccountHealthCard", () => {
  it("renders a complete read-only health summary", () => {
    const html = render();

    for (const label of [
      "Account health",
      "Operations",
      "Account operations",
      "Lifecycle and activity",
      "Billing",
      "Phone and A2P registration",
      "AI, Calendar, and booking",
      "Last activity",
      "Aug 4, 2026, 11:45 AM",
      "Direct booking operational",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("shows effective service pauses while retaining only independently stored pause times", () => {
    const html = render({
      operationsSuspendedAt: "2026-08-04T11:30:00.000Z",
      textingPausedAt: "2026-08-03T09:15:00.000Z",
    });

    expect(html).toMatch(
      /Account operations<\/dt><dd[^>]*>Suspended<\/dd>/,
    );
    expect(html).toContain("Aug 4, 2026, 11:30 AM");
    expect(html).toMatch(/AI replies<\/dt><dd[^>]*>Paused<\/dd>/);
    expect(html).toMatch(/Texting<\/dt><dd[^>]*>Paused<\/dd>/);
    expect(html).toMatch(/Bookings<\/dt><dd[^>]*>Paused<\/dd>/);
    expect(html).toMatch(
      /AI replies paused at<\/dt><dd[^>]*>None recorded<\/dd>/,
    );
    expect(html).toMatch(
      /Texting paused at<\/dt><dd[^>]*>Aug 3, 2026, 9:15 AM<\/dd>/,
    );
    expect(html).toMatch(
      /Bookings paused at<\/dt><dd[^>]*>None recorded<\/dd>/,
    );
  });

  it("distinguishes an independent pause from active account operations", () => {
    const html = render({
      bookingsPausedAt: "2026-08-03T09:15:00.000Z",
    });

    expect(html).toMatch(/Account operations<\/dt><dd[^>]*>Active<\/dd>/);
    expect(html).toMatch(/AI replies<\/dt><dd[^>]*>Active<\/dd>/);
    expect(html).toMatch(/Texting<\/dt><dd[^>]*>Active<\/dd>/);
    expect(html).toMatch(/Bookings<\/dt><dd[^>]*>Paused<\/dd>/);
    expect(html).toMatch(
      /Bookings paused at<\/dt><dd[^>]*>Aug 3, 2026, 9:15 AM<\/dd>/,
    );
  });

  it("explains that past-due billing remains feature-active", () => {
    const html = render({
      entitlements: {
        plan: "full",
        status: "past_due",
        source: "subscription",
        active: true,
        cancelAtPeriodEnd: false,
      },
    });

    expect(html).toContain("Payment is past due");
    expect(html).toContain(
      "Existing feature entitlements remain active while Stripe recovery is in progress.",
    );
    expect(html).toContain("Features active");
    expect(html).toContain(">Yes<");
  });

  it("shows fresh pending-deletion timing and onboarding detail when applicable", () => {
    const scheduled = render({
      deletedAt: "2026-08-04T12:00:00.000Z",
      deletionScheduledFor: "2026-10-03T12:00:00.000Z",
    });
    expect(scheduled).toContain("Pending deletion");
    expect(scheduled).toContain("Terminal cleanup");
    expect(scheduled).toContain("Oct 3, 2026, 12:00 PM");

    const onboarding = render({
      onboardingCompletedAt: null,
      onboardingStep: "sms_use_case",
    });
    expect(onboarding).toContain("Onboarding step");
    expect(onboarding).toContain("SMS Use Case");
  });

  it("distinguishes collect-info booking from direct-booking setup", () => {
    const html = render({
      calendarConnected: false,
      aiBookingMode: "collect_info",
    });
    expect(html).toContain("Collect-info booking operational");
    expect(html).not.toContain("Direct booking needs Calendar");

    expect(render({ calendarConnected: false })).toContain(
      "Direct booking needs Calendar",
    );
  });

  it("renders only stable failed-setup labels, never stored error text", () => {
    const secret = "provider payload customer@example.com";
    const html = render({
      anyActivePhoneAssignmentFailed: true,
      smsReadiness: {
        smsReady: false,
        blockReason: "assignment_failed",
        campaignStatus: "approved",
        assignmentStatus: "failed",
        assignmentFailureReason: secret,
      },
      provisioning: {
        needsAttention: true,
        inviteFailed: true,
        expiredLease: true,
      },
    });

    expect(html).toContain("Setup needs attention");
    expect(html).toContain("Phone assignment failed");
    expect(html).toContain("Partner provisioning needs attention");
    expect(html).toContain("Setup invite failed");
    expect(html).toContain("Provisioning outcome unresolved");
    expect(html).not.toContain(secret);
  });
});
