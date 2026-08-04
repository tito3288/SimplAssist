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
    onboardingCompletedAt: "2026-07-01T12:00:00.000Z",
    onboardingStep: "complete",
    billingMode: "stripe",
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
