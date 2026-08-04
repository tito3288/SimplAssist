import { describe, expect, it } from "vitest";
import {
  applyDeletionPreviewLifecycle,
  normalizeAdminAccountHealth,
  type AdminAccountHealthInput,
} from "./accountHealth";

const NOW = "2026-08-04T12:00:00.000Z";
const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";

function input(
  overrides: Partial<AdminAccountHealthInput> = {},
): AdminAccountHealthInput {
  return {
    businessId: BUSINESS_ID,
    now: NOW,
    deletedAt: null,
    deletionScheduledFor: null,
    operationsSuspendedAt: null,
    aiRepliesPausedAt: null,
    textingPausedAt: null,
    bookingsPausedAt: null,
    onboardingCompletedAt: "2026-07-01T12:00:00.000Z",
    onboardingStep: "complete",
    billingMode: "stripe",
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

describe("normalizeAdminAccountHealth", () => {
  it("normalizes a fully operational account from durable facts", () => {
    expect(normalizeAdminAccountHealth(input())).toMatchObject({
      businessId: BUSINESS_ID,
      operations: {
        state: "active",
        suspendedAt: null,
        services: {
          aiReplies: { state: "active", pausedAt: null },
          texting: { state: "active", pausedAt: null },
          bookings: { state: "active", pausedAt: null },
        },
      },
      lifecycle: {
        state: "live",
        onboardingCompleted: true,
        onboardingStep: "complete",
        onboardingStepLabel: "Complete",
      },
      billing: { state: "active", pastDue: false },
      phone: { state: "ready", smsReady: true, activeCount: 1 },
      registration: { state: "approved" },
      calendar: { connected: true },
      ai: {
        state: "active",
        sms: "operational",
        webChat: "operational",
        operationalChannels: ["sms", "web_chat"],
      },
      booking: { state: "operational", mode: "schedule_direct" },
      failedSetup: { failed: false, reasons: [] },
      lastActivityAt: "2026-08-04T11:45:00.000Z",
    });
  });

  it("derives effective service pauses without erasing stored pause timestamps", () => {
    const suspendedAt = "2026-08-04T11:30:00.000Z";
    const textingPausedAt = "2026-08-03T09:15:00.000Z";
    const suspended = normalizeAdminAccountHealth(
      input({
        operationsSuspendedAt: suspendedAt,
        textingPausedAt,
      }),
    );

    expect(suspended.operations).toEqual({
      state: "suspended",
      suspendedAt,
      services: {
        aiReplies: { state: "paused", pausedAt: null },
        texting: { state: "paused", pausedAt: textingPausedAt },
        bookings: { state: "paused", pausedAt: null },
      },
    });

    const resumed = normalizeAdminAccountHealth(
      input({ textingPausedAt }),
    );
    expect(resumed.operations).toEqual({
      state: "active",
      suspendedAt: null,
      services: {
        aiReplies: { state: "active", pausedAt: null },
        texting: { state: "paused", pausedAt: textingPausedAt },
        bookings: { state: "active", pausedAt: null },
      },
    });
  });

  it("keeps past-due Stripe accounts feature-active with a separate warning fact", () => {
    const health = normalizeAdminAccountHealth(
      input({
        entitlements: {
          plan: "sms_and_chat",
          status: "past_due",
          source: "subscription",
          active: true,
          cancelAtPeriodEnd: false,
        },
      }),
    );

    expect(health.billing).toMatchObject({
      state: "past_due",
      pastDue: true,
    });
    expect(health.ai.state).toBe("active");
    expect(health.ai.operationalChannels).toEqual(["sms", "web_chat"]);
  });

  it("applies lifecycle precedence and retains the current onboarding label", () => {
    expect(
      normalizeAdminAccountHealth(
        input({
          onboardingCompletedAt: null,
          onboardingStep: "legal_verification",
        }),
      ).lifecycle,
    ).toMatchObject({
      state: "onboarding",
      onboardingStepLabel: "Business Verification",
    });
    expect(
      normalizeAdminAccountHealth(
        input({
          deletedAt: NOW,
          deletionScheduledFor: "2026-10-03T12:00:00.000Z",
        }),
      ).lifecycle.state,
    ).toBe("pending_deletion");
    expect(
      normalizeAdminAccountHealth(
        input({ deletedAt: NOW, deletionScheduledFor: null }),
      ).lifecycle.state,
    ).toBe("terminal");
    expect(
      normalizeAdminAccountHealth(
        input({ deletedAt: null, deletionScheduledFor: NOW }),
      ).lifecycle.state,
    ).toBe("terminal");
  });

  it("lets a fresh deletion preview override a stale lifecycle snapshot", () => {
    const health = normalizeAdminAccountHealth(input());
    const scheduled = applyDeletionPreviewLifecycle(health, {
      lifecycleStage: "suspended",
      deletionScheduledFor: "2026-10-03T12:00:00.000Z",
    });

    expect(scheduled.lifecycle).toMatchObject({
      state: "pending_deletion",
      onboardingCompleted: true,
      deletionScheduledFor: "2026-10-03T12:00:00.000Z",
    });
    expect(
      applyDeletionPreviewLifecycle(scheduled, {
        lifecycleStage: "onboarding",
        deletionScheduledFor: null,
      }).lifecycle,
    ).toMatchObject({
      state: "onboarding",
      onboardingCompleted: false,
      deletionScheduledFor: null,
    });
  });

  it("detects ambiguous active phones without inventing SMS readiness", () => {
    const health = normalizeAdminAccountHealth(
      input({
        activePhoneCount: 2,
        smsReadiness: null,
        anyActivePhoneAssignmentFailed: true,
      }),
    );

    expect(health.phone).toMatchObject({
      state: "ambiguous",
      activeCount: 2,
      smsReady: false,
    });
    expect(health.failedSetup.reasons.map(({ code }) => code)).toContain(
      "phone_assignment_failed",
    );
  });

  it.each([
    [
      "registration_failed",
      { onboardingRegistrationStatus: "failed" },
    ],
    [
      "registration_submission_stale",
      {
        onboardingRegistrationStatus: "submitting",
        onboardingRegistrationStartedAt: null,
      },
    ],
    ["risk_review_blocked", { riskReviewStatus: "blocked" }],
    ["brand_rejected", { brandStatus: "rejected" }],
    ["campaign_rejected", { campaignStatus: "rejected" }],
    [
      "phone_assignment_failed",
      { anyActivePhoneAssignmentFailed: true },
    ],
    ["pending_phone_failed", { pendingPhoneFailed: true }],
    [
      "provisioning_needs_attention",
      {
        provisioning: {
          needsAttention: true,
          inviteFailed: false,
          expiredLease: false,
        },
      },
    ],
    [
      "provisioning_invite_failed",
      {
        provisioning: {
          needsAttention: false,
          inviteFailed: true,
          expiredLease: false,
        },
      },
    ],
    [
      "provisioning_lease_expired",
      {
        provisioning: {
          needsAttention: false,
          inviteFailed: false,
          expiredLease: true,
        },
      },
    ],
  ] as const)("derives the %s failed-setup reason", (code, overrides) => {
    const health = normalizeAdminAccountHealth(
      input(overrides as Partial<AdminAccountHealthInput>),
    );
    expect(health.failedSetup.failed).toBe(true);
    expect(health.failedSetup.reasons.map((reason) => reason.code)).toContain(
      code,
    );
  });

  it("uses the full fifteen-minute registration lease boundary", () => {
    expect(
      normalizeAdminAccountHealth(
        input({
          onboardingRegistrationStatus: "submitting",
          onboardingRegistrationStartedAt: "2026-08-04T11:45:00.000Z",
        }),
      ).failedSetup.reasons.map(({ code }) => code),
    ).toContain("registration_submission_stale");
    expect(
      normalizeAdminAccountHealth(
        input({
          onboardingRegistrationStatus: "submitting",
          onboardingRegistrationStartedAt: "2026-08-04T11:45:00.001Z",
        }),
      ).failedSetup.reasons,
    ).toEqual([]);
  });

  it("does not turn ordinary setup states or a recovered assignment into failures", () => {
    const health = normalizeAdminAccountHealth(
      input({
        onboardingCompletedAt: null,
        onboardingStep: "carrier_review",
        onboardingRegistrationStatus: "submitting",
        onboardingRegistrationStartedAt: "2026-08-04T11:50:00.000Z",
        riskReviewStatus: "pending_review",
        brandStatus: "pending",
        campaignStatus: "pending",
        smsReadiness: {
          smsReady: true,
          blockReason: null,
          campaignStatus: "approved",
          assignmentStatus: "assigned",
          assignmentFailureReason: "historical failure",
        },
      }),
    );

    expect(health.failedSetup).toEqual({ failed: false, reasons: [] });
  });

  it("derives AI channel and booking states from configuration and entitlements", () => {
    expect(
      normalizeAdminAccountHealth(
        input({ aiConfigured: false, aiBookingEnabled: false }),
      ).ai.state,
    ).toBe("not_configured");

    const limited = normalizeAdminAccountHealth(
      input({
        entitlements: {
          plan: "sms_only",
          status: "active",
          source: "subscription",
          active: true,
          cancelAtPeriodEnd: false,
        },
      }),
    );
    expect(limited.ai).toMatchObject({
      state: "plan_limited",
      planLimitedChannels: ["sms", "web_chat"],
    });
    expect(limited.booking.state).toBe("plan_limited");

    const setupPending = normalizeAdminAccountHealth(
      input({
        smsReadiness: {
          smsReady: false,
          blockReason: "assignment_pending",
          campaignStatus: "approved",
          assignmentStatus: "pending",
          assignmentFailureReason: null,
        },
        webChatEnabled: false,
      }),
    );
    expect(setupPending.ai.state).toBe("setup_pending");

    const webOnly = normalizeAdminAccountHealth(
      input({
        smsReadiness: {
          smsReady: false,
          blockReason: "assignment_pending",
          campaignStatus: "approved",
          assignmentStatus: "pending",
          assignmentFailureReason: null,
        },
      }),
    );
    expect(webOnly.ai).toMatchObject({
      state: "active",
      operationalChannels: ["web_chat"],
    });
  });

  it("treats collect-info booking as operational without Calendar", () => {
    const collectInfo = normalizeAdminAccountHealth(
      input({
        calendarConnected: false,
        aiBookingMode: "collect_info",
      }),
    );
    expect(collectInfo.booking).toEqual({
      state: "operational",
      mode: "collect_info",
    });

    const direct = normalizeAdminAccountHealth(
      input({ calendarConnected: false }),
    );
    expect(direct.booking.state).toBe("calendar_required");

    expect(
      normalizeAdminAccountHealth(
        input({ aiBookingEnabled: true, aiBookingMode: null }),
      ).booking.state,
    ).toBe("disabled");
  });

  it("fails closed on unresolved billing and malformed activity timestamps", () => {
    const health = normalizeAdminAccountHealth(
      input({ entitlements: null, lastActivityAt: "not-a-date" }),
    );
    expect(health.billing).toMatchObject({
      state: "unknown",
      plan: null,
      status: null,
    });
    expect(health.ai.state).toBe("plan_limited");
    expect(health.lastActivityAt).toBeNull();
  });
});
