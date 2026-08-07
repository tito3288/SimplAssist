import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeAdminAccountHealth,
  type AdminAccountHealth,
  type AdminAccountHealthInput,
} from "@/lib/admin/accountHealth";
import {
  AdminAccountHealthChips,
  buildAdminAccountChipDescriptors,
  type AdminAccountListChipFacts,
} from "./AdminAccountHealthChips";
import {
  AdminAccountRow,
  type AdminAccountBusinessRow,
} from "./AdminAccountRow";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

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

function listAccount(
  overrides: Partial<AdminAccountListChipFacts> = {},
): AdminAccountListChipFacts {
  return {
    lifecycle: "active",
    riskReviewStatus: "pending_review",
    brandStatus: "pending",
    campaignStatus: "pending",
    telnyxSubmissionDisabled: false,
    billingPilot: false,
    billingComped: false,
    billingExempt: false,
    deletionScheduledFor: null,
    ...overrides,
  };
}

function normalizedHealth(
  overrides: Partial<AdminAccountHealthInput> = {},
): AdminAccountHealth {
  return normalizeAdminAccountHealth(healthInput(overrides));
}

function healthVariant(
  mutate: (health: AdminAccountHealth) => void,
): AdminAccountHealth {
  const health = normalizedHealth();
  mutate(health);
  return health;
}

function renderList(
  health: AdminAccountHealth | null,
  account: AdminAccountListChipFacts = listAccount(),
): string {
  return renderToStaticMarkup(
    <AdminAccountHealthChips health={health} listAccount={account} />,
  );
}

function directlyVisibleMarkup(html: string): string {
  return html.replace(/<details[\s\S]*?<\/details>/g, "");
}

function business(
  overrides: Partial<AdminAccountBusinessRow> = {},
): AdminAccountBusinessRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Example Dental",
    website_url: "https://example.com",
    business_type: "dentist",
    a2p_risk_review_status: "pending_review",
    a2p_risk_review_message: null,
    onboarding_registration_status: "submitted",
    brand_status: "pending",
    campaign_status: "pending",
    partner_id: null,
    billing_mode: "stripe",
    partner_plan: null,
    partner: null,
    billing_pilot: false,
    billing_comped: false,
    billing_exempt: false,
    telnyx_submission_disabled: false,
    sms_overage_opt_in: false,
    deleted_at: null,
    deletion_scheduled_for: null,
    created_at: "2026-08-04T12:00:00.000Z",
    ...overrides,
  };
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
    const label = "Billing: sms and chat · past due";
    const html = render({
      entitlements: {
        plan: "sms_and_chat",
        status: "past_due",
        source: "subscription",
        active: true,
        cancelAtPeriodEnd: false,
      },
    });

    expect(html).toContain(label);
    expect(html).toContain("Past due");
    expect(html).toContain("AI: active (SMS + web chat)");
    expect(billingChipClass(html, label)).toContain("text-amber-800");
    expect(billingChipClass(html, label)).not.toContain("text-green-700");
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

  it("keeps the unchanged detail-card presentation fully expanded", () => {
    const html = render({
      onboardingCompletedAt: null,
      onboardingStep: "carrier_review",
      onboardingRegistrationStatus: "submitted",
      campaignStatus: "pending",
      calendarConnected: false,
      aiConfigured: false,
      lastActivityAt: null,
    });

    expect(html).toContain("Onboarding: Carrier Review");
    expect(html).toContain("A2P: pending");
    expect(html).toContain("Calendar: not connected");
    expect(html).toContain("AI: not configured");
    expect(html).toContain("Last activity: none recorded");
    expect(html).not.toContain("<details");
    expect(html).not.toContain(" more</summary>");
  });

  it("uses a hardcoded, independent danger/warning inventory and never collapses one", () => {
    // This inventory is deliberately written here instead of imported from, or
    // derived from, the descriptor builder. A severity-map regression must fail.
    const expectedDangerAndWarning = [
      {
        id: "row.lifecycle.terminal",
        label: "Terminally cleaned",
        tone: "danger",
      },
      {
        id: "health.lifecycle",
        label: "Lifecycle: terminal",
        tone: "danger",
      },
      {
        id: "row.telnyx_submission_disabled",
        label: "No Telnyx submit",
        tone: "danger",
      },
      {
        id: "health.operations.suspended",
        label: "Account suspended",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: unresolved plan · unknown",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: unresolved plan · invoiced",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: unresolved plan · comped",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: sms only · canceled",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: sms and chat · canceled",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: full · canceled",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: sms only · invoiced",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: sms and chat · invoiced",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: full · invoiced",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: sms only · comped",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: sms and chat · comped",
        tone: "danger",
      },
      {
        id: "health.billing",
        label: "Billing: full · comped",
        tone: "danger",
      },
      {
        id: "health.sms",
        label: "SMS: assignment failed",
        tone: "danger",
      },
      {
        id: "health.sms",
        label: "SMS: 2 active phones",
        tone: "danger",
      },
      {
        id: "health.a2p",
        label: "A2P: submission failed",
        tone: "danger",
      },
      {
        id: "health.a2p",
        label: "A2P: risk blocked",
        tone: "danger",
      },
      {
        id: "health.a2p",
        label: "A2P: rejected",
        tone: "danger",
      },
      {
        id: "health.setup.registration_failed",
        label: "Setup: Registration failed",
        tone: "danger",
      },
      {
        id: "health.setup.registration_submission_stale",
        label: "Setup: Registration submission stalled",
        tone: "danger",
      },
      {
        id: "health.setup.risk_review_blocked",
        label: "Setup: Risk review blocked",
        tone: "danger",
      },
      {
        id: "health.setup.brand_rejected",
        label: "Setup: Brand rejected",
        tone: "danger",
      },
      {
        id: "health.setup.campaign_rejected",
        label: "Setup: Campaign rejected",
        tone: "danger",
      },
      {
        id: "health.setup.phone_assignment_failed",
        label: "Setup: Phone assignment failed",
        tone: "danger",
      },
      {
        id: "health.setup.pending_phone_failed",
        label: "Setup: Pending number provisioning failed",
        tone: "danger",
      },
      {
        id: "health.setup.provisioning_needs_attention",
        label: "Setup: Partner provisioning needs attention",
        tone: "danger",
      },
      {
        id: "health.setup.provisioning_invite_failed",
        label: "Setup: Setup invite failed",
        tone: "danger",
      },
      {
        id: "health.setup.provisioning_lease_expired",
        label: "Setup: Provisioning outcome unresolved",
        tone: "danger",
      },
      {
        id: "health.lifecycle",
        label: "Lifecycle: pending deletion",
        tone: "warning",
      },
      {
        id: "row.lifecycle.deletion_scheduled",
        label: "Deletion scheduled",
        tone: "warning",
      },
      {
        id: "row.lifecycle.deletion_scheduled",
        label: "Deletion scheduled · 10/3/2026",
        tone: "warning",
      },
      {
        id: "health.operations.ai_replies_paused",
        label: "AI replies paused",
        tone: "warning",
      },
      {
        id: "health.operations.texting_paused",
        label: "Texting paused",
        tone: "warning",
      },
      {
        id: "health.operations.bookings_paused",
        label: "Bookings paused",
        tone: "warning",
      },
      {
        id: "health.billing",
        label: "Billing: sms and chat · past due",
        tone: "warning",
      },
      {
        id: "health.billing.past_due",
        label: "Past due",
        tone: "warning",
      },
      {
        id: "health.sms",
        label: "SMS: blocked",
        tone: "warning",
      },
      {
        id: "health.sms",
        label: "SMS: campaign not approved",
        tone: "warning",
      },
      {
        id: "health.sms",
        label: "SMS: assignment pending",
        tone: "warning",
      },
      {
        id: "health.sms",
        label: "SMS: messaging profile missing",
        tone: "warning",
      },
      {
        id: "health.sms",
        label: "SMS: no active phone",
        tone: "warning",
      },
      {
        id: "health.ai",
        label: "AI: setup pending",
        tone: "warning",
      },
      {
        id: "health.ai",
        label: "AI: plan limited",
        tone: "warning",
      },
      {
        id: "health.booking",
        label: "Booking: Calendar needed",
        tone: "warning",
      },
      {
        id: "health.booking",
        label: "Booking: plan limited",
        tone: "warning",
      },
    ] as const;

    const allFailedSetupReasons: AdminAccountHealth["failedSetup"]["reasons"] =
      [
        { code: "registration_failed", label: "Registration failed" },
        {
          code: "registration_submission_stale",
          label: "Registration submission stalled",
        },
        { code: "risk_review_blocked", label: "Risk review blocked" },
        { code: "brand_rejected", label: "Brand rejected" },
        { code: "campaign_rejected", label: "Campaign rejected" },
        {
          code: "phone_assignment_failed",
          label: "Phone assignment failed",
        },
        {
          code: "pending_phone_failed",
          label: "Pending number provisioning failed",
        },
        {
          code: "provisioning_needs_attention",
          label: "Partner provisioning needs attention",
        },
        {
          code: "provisioning_invite_failed",
          label: "Setup invite failed",
        },
        {
          code: "provisioning_lease_expired",
          label: "Provisioning outcome unresolved",
        },
      ];

    const dangerHealth = healthVariant((health) => {
      health.operations.state = "suspended";
      health.billing = {
        mode: "stripe",
        subscriptionPresent: false,
        plan: null,
        status: null,
        source: null,
        state: "unknown",
        pastDue: false,
        cancelAtPeriodEnd: false,
      };
      health.phone = {
        state: "blocked",
        activeCount: 1,
        smsReady: false,
        blockReason: "assignment_failed",
        assignmentStatus: "failed",
      };
      health.registration.state = "failed";
      health.failedSetup = { failed: true, reasons: allFailedSetupReasons };
    });
    const warningHealth = healthVariant((health) => {
      health.lifecycle.state = "pending_deletion";
      health.lifecycle.deletionScheduledFor =
        "2026-10-03T12:00:00.000Z";
      health.operations.services.aiReplies.pausedAt =
        "2026-08-04T09:00:00.000Z";
      health.operations.services.texting.pausedAt =
        "2026-08-04T09:01:00.000Z";
      health.operations.services.bookings.pausedAt =
        "2026-08-04T09:02:00.000Z";
      health.billing.pastDue = true;
      health.billing.state = "past_due";
      health.billing.status = "past_due";
      health.phone = {
        state: "blocked",
        activeCount: 1,
        smsReady: false,
        blockReason: null,
        assignmentStatus: null,
      };
      health.ai.state = "setup_pending";
      health.booking.state = "calendar_required";
      health.booking.mode = "schedule_direct";
    });
    const terminalHealth = healthVariant((health) => {
      health.lifecycle.state = "terminal";
    });
    const canceledBillingHealth = (
      mode: "stripe" | "invoiced" | "comped",
      plan: "sms_only" | "sms_and_chat" | "full",
    ) =>
      healthVariant((health) => {
        health.billing = {
          mode,
          subscriptionPresent: true,
          plan,
          status: "canceled",
          source: "subscription",
          state: "inactive",
          pastDue: false,
          cancelAtPeriodEnd: false,
        };
      });
    const unresolvedBillingHealth = (mode: "invoiced" | "comped") =>
      healthVariant((health) => {
        health.billing = {
          mode,
          subscriptionPresent: false,
          plan: null,
          status: null,
          source: null,
          state: "unknown",
          pastDue: false,
          cancelAtPeriodEnd: false,
        };
      });
    const ambiguousPhoneHealth = healthVariant((health) => {
      health.phone = {
        state: "ambiguous",
        activeCount: 2,
        smsReady: false,
        blockReason: null,
        assignmentStatus: null,
      };
    });
    const blockedRegistrationHealth = healthVariant((health) => {
      health.registration.state = "blocked";
    });
    const rejectedRegistrationHealth = healthVariant((health) => {
      health.registration.state = "rejected";
    });
    const planLimitedHealth = healthVariant((health) => {
      health.ai.state = "plan_limited";
      health.booking.state = "plan_limited";
      health.booking.mode = "schedule_direct";
    });
    const phoneWarningHealth = (
      blockReason: AdminAccountHealth["phone"]["blockReason"],
    ) =>
      healthVariant((health) => {
        health.phone = {
          state: "blocked",
          activeCount: 1,
          smsReady: false,
          blockReason,
          assignmentStatus: null,
        };
      });
    const missingPhoneHealth = healthVariant((health) => {
      health.phone = {
        state: "missing",
        activeCount: 0,
        smsReady: false,
        blockReason: null,
        assignmentStatus: null,
      };
    });

    const fixtures = [
      {
        health: null,
        account: listAccount({ lifecycle: "terminal" }),
      },
      {
        health: terminalHealth,
        account: listAccount(),
      },
      {
        health: dangerHealth,
        account: listAccount({ telnyxSubmissionDisabled: true }),
      },
      {
        health: unresolvedBillingHealth("invoiced"),
        account: listAccount(),
      },
      {
        health: unresolvedBillingHealth("comped"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("stripe", "sms_only"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("stripe", "sms_and_chat"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("stripe", "full"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("invoiced", "sms_only"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("invoiced", "sms_and_chat"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("invoiced", "full"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("comped", "sms_only"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("comped", "sms_and_chat"),
        account: listAccount(),
      },
      {
        health: canceledBillingHealth("comped", "full"),
        account: listAccount(),
      },
      {
        health: ambiguousPhoneHealth,
        account: listAccount(),
      },
      {
        health: blockedRegistrationHealth,
        account: listAccount(),
      },
      {
        health: rejectedRegistrationHealth,
        account: listAccount(),
      },
      {
        health: warningHealth,
        account: listAccount({ lifecycle: "scheduled" }),
      },
      {
        health: warningHealth,
        account: listAccount({
          lifecycle: "scheduled",
          deletionScheduledFor: "2026-10-03T12:00:00.000Z",
        }),
      },
      {
        health: phoneWarningHealth("campaign_not_approved"),
        account: listAccount(),
      },
      {
        health: phoneWarningHealth("assignment_pending"),
        account: listAccount(),
      },
      {
        health: phoneWarningHealth("missing_messaging_profile"),
        account: listAccount(),
      },
      {
        health: missingPhoneHealth,
        account: listAccount(),
      },
      {
        health: planLimitedHealth,
        account: listAccount(),
      },
    ].map(({ health, account }) => ({
      descriptors: buildAdminAccountChipDescriptors({
        health,
        listAccount: account,
      }),
      html: renderList(health, account),
    }));

    for (const expected of expectedDangerAndWarning) {
      const fixture = fixtures.find(({ descriptors }) =>
        descriptors.some(
          (descriptor) =>
            descriptor.id === expected.id &&
            descriptor.label === expected.label,
        ),
      );
      expect(fixture, `${expected.id}: ${expected.label}`).toBeDefined();
      const matchingDescriptor = fixture?.descriptors.find(
        (descriptor) =>
          descriptor.id === expected.id && descriptor.label === expected.label,
      );
      expect(matchingDescriptor?.tone).toBe(expected.tone);
      expect(directlyVisibleMarkup(fixture?.html ?? "")).toContain(
        expected.label,
      );
    }
  });

  it("has a full-coverage fixture that preserves every list badge and health chip slot", () => {
    const health = healthVariant((value) => {
      value.lifecycle.state = "pending_deletion";
      value.operations = {
        state: "suspended",
        suspendedAt: "2026-08-04T08:00:00.000Z",
        services: {
          aiReplies: {
            state: "paused",
            pausedAt: "2026-08-04T08:01:00.000Z",
          },
          texting: {
            state: "paused",
            pausedAt: "2026-08-04T08:02:00.000Z",
          },
          bookings: {
            state: "paused",
            pausedAt: "2026-08-04T08:03:00.000Z",
          },
        },
      };
      value.billing.state = "past_due";
      value.billing.status = "past_due";
      value.billing.pastDue = true;
      value.phone = {
        state: "ambiguous",
        activeCount: 2,
        smsReady: false,
        blockReason: null,
        assignmentStatus: null,
      };
      value.registration.state = "failed";
      value.calendar.connected = false;
      value.ai.state = "setup_pending";
      value.ai.operationalChannels = [];
      value.booking = { mode: "schedule_direct", state: "calendar_required" };
      value.failedSetup = {
        failed: true,
        reasons: [
          { code: "registration_failed", label: "Registration failed" },
          {
            code: "registration_submission_stale",
            label: "Registration submission stalled",
          },
          { code: "risk_review_blocked", label: "Risk review blocked" },
          { code: "brand_rejected", label: "Brand rejected" },
          { code: "campaign_rejected", label: "Campaign rejected" },
          {
            code: "phone_assignment_failed",
            label: "Phone assignment failed",
          },
          {
            code: "pending_phone_failed",
            label: "Pending number provisioning failed",
          },
          {
            code: "provisioning_needs_attention",
            label: "Partner provisioning needs attention",
          },
          {
            code: "provisioning_invite_failed",
            label: "Setup invite failed",
          },
          {
            code: "provisioning_lease_expired",
            label: "Provisioning outcome unresolved",
          },
        ],
      };
    });
    const account = listAccount({
      lifecycle: "scheduled",
      telnyxSubmissionDisabled: true,
      billingPilot: true,
      billingComped: true,
      billingExempt: true,
    });
    const descriptors = [
      ...buildAdminAccountChipDescriptors({
        health,
        listAccount: account,
      }),
      ...buildAdminAccountChipDescriptors({
        health: null,
        listAccount: listAccount({ lifecycle: "terminal" }),
      }),
    ];

    expect(descriptors.map(({ label }) => label)).toEqual(
      expect.arrayContaining([
        "Lifecycle: pending deletion",
        "Account suspended",
        "AI replies paused",
        "Texting paused",
        "Bookings paused",
        "Billing: sms and chat · past due",
        "Past due",
        "SMS: 2 active phones",
        "A2P: submission failed",
        "Calendar: not connected",
        "AI: setup pending",
        "Booking: Calendar needed",
        "Setup: Registration failed",
        "Setup: Registration submission stalled",
        "Setup: Risk review blocked",
        "Setup: Brand rejected",
        "Setup: Campaign rejected",
        "Setup: Phone assignment failed",
        "Setup: Pending number provisioning failed",
        "Setup: Partner provisioning needs attention",
        "Setup: Setup invite failed",
        "Setup: Provisioning outcome unresolved",
        "Last activity: Aug 4, 2026, 11:45 AM",
        "Risk: pending_review",
        "Brand: pending",
        "Campaign: pending",
        "No Telnyx submit",
        "Pilot",
        "Comped",
        "Billing exempt",
        "Deletion scheduled",
        "Terminally cleaned",
      ]),
    );
    expect(descriptors).toHaveLength(32);

    const onboardingHealth = normalizedHealth({
      onboardingCompletedAt: null,
      onboardingStep: "carrier_review",
      subscriptionPresent: false,
      entitlements: null,
      activePhoneCount: 0,
      smsReadiness: null,
      onboardingRegistrationStatus: null,
      riskReviewStatus: null,
      brandStatus: null,
      campaignStatus: null,
      calendarConnected: false,
      aiConfigured: false,
      aiBookingEnabled: false,
      aiBookingMode: null,
      lastActivityAt: null,
    });
    const coverageHealthVariants = [
      normalizedHealth(),
      onboardingHealth,
      healthVariant((value) => {
        value.lifecycle.state = "terminal";
      }),
      healthVariant((value) => {
        value.billing = {
          mode: "stripe",
          subscriptionPresent: true,
          plan: null,
          status: null,
          source: null,
          state: "unknown",
          pastDue: false,
          cancelAtPeriodEnd: false,
        };
      }),
      healthVariant((value) => {
        value.billing.state = "inactive";
        value.billing.status = "canceled";
      }),
      healthVariant((value) => {
        value.billing.mode = "invoiced";
        value.billing.status = "partner_billing";
        value.billing.source = "partner_billing";
      }),
      healthVariant((value) => {
        value.billing.mode = "comped";
        value.billing.status = "partner_billing";
        value.billing.source = "partner_billing";
      }),
      ...(
        [
          null,
          "campaign_not_approved",
          "assignment_pending",
          "assignment_failed",
          "missing_messaging_profile",
          "missing_phone_number",
        ] as const
      ).map((blockReason) =>
        healthVariant((value) => {
          value.phone = {
            state: "blocked",
            activeCount: 1,
            smsReady: false,
            blockReason,
            assignmentStatus:
              blockReason === "assignment_failed" ? "failed" : null,
          };
        }),
      ),
      ...(
        ["pending", "blocked", "rejected"] as const
      ).map((registrationState) =>
        healthVariant((value) => {
          value.registration.state = registrationState;
        }),
      ),
      healthVariant((value) => {
        value.ai.state = "plan_limited";
      }),
      healthVariant((value) => {
        value.booking = { mode: "collect_info", state: "operational" };
      }),
      healthVariant((value) => {
        value.booking = { mode: "schedule_direct", state: "plan_limited" };
      }),
      healthVariant((value) => {
        value.booking = { mode: null, state: "disabled" };
      }),
    ];
    const fallbackAccount = listAccount({
      lifecycle: "scheduled",
      riskReviewStatus: null,
      brandStatus: null,
      campaignStatus: null,
      deletionScheduledFor: "2026-10-03T12:00:00.000Z",
    });
    const fallbackRowDescriptors = buildAdminAccountChipDescriptors({
      health: normalizedHealth(),
      listAccount: fallbackAccount,
    });
    const coverageLabels = new Set([
      ...descriptors.map(({ label }) => label),
      ...coverageHealthVariants.flatMap((variant) =>
        buildAdminAccountChipDescriptors({ health: variant }).map(
          ({ label }) => label,
        ),
      ),
      ...fallbackRowDescriptors.map(({ label }) => label),
    ]);
    const everyCurrentLabelBranch = [
      "Terminally cleaned",
      "Lifecycle: live",
      "Onboarding: Carrier Review",
      "Lifecycle: pending deletion",
      "Lifecycle: terminal",
      "Account suspended",
      "AI replies paused",
      "Texting paused",
      "Bookings paused",
      "Billing: sms and chat · active",
      "Billing: not started · no subscription",
      "Billing: unresolved plan · unknown",
      "Billing: sms and chat · canceled",
      "Billing: sms and chat · past due",
      "Billing: sms and chat · invoiced",
      "Billing: sms and chat · comped",
      "Past due",
      "SMS: ready",
      "SMS: blocked",
      "SMS: campaign not approved",
      "SMS: assignment pending",
      "SMS: assignment failed",
      "SMS: messaging profile missing",
      "SMS: no active phone",
      "SMS: 2 active phones",
      "A2P: approved",
      "A2P: pending",
      "A2P: submission failed",
      "A2P: risk blocked",
      "A2P: rejected",
      "A2P: not started",
      "Calendar: connected",
      "Calendar: not connected",
      "AI: active (SMS + web chat)",
      "AI: plan limited",
      "AI: setup pending",
      "AI: not configured",
      "Booking: direct",
      "Booking: collect info",
      "Booking: Calendar needed",
      "Booking: plan limited",
      "Booking: disabled",
      "Booking: not configured",
      "Setup: Registration failed",
      "Setup: Registration submission stalled",
      "Setup: Risk review blocked",
      "Setup: Brand rejected",
      "Setup: Campaign rejected",
      "Setup: Phone assignment failed",
      "Setup: Pending number provisioning failed",
      "Setup: Partner provisioning needs attention",
      "Setup: Setup invite failed",
      "Setup: Provisioning outcome unresolved",
      "Last activity: Aug 4, 2026, 11:45 AM",
      "Last activity: none recorded",
      "Risk: pending_review",
      "Risk: not_started",
      "Brand: pending",
      "Brand: not submitted",
      "Campaign: pending",
      "Campaign: not submitted",
      "No Telnyx submit",
      "Pilot",
      "Comped",
      "Billing exempt",
      "Deletion scheduled",
      "Deletion scheduled · 10/3/2026",
    ] as const;

    for (const label of everyCurrentLabelBranch) {
      expect(coverageLabels, label).toContain(label);
    }

    for (const variant of coverageHealthVariants) {
      const variantAccount = listAccount();
      const variantDescriptors = buildAdminAccountChipDescriptors({
        health: variant,
        listAccount: variantAccount,
      });
      const variantHtml = renderList(variant, variantAccount);
      const variantDisclosure =
        variantHtml.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";

      for (const descriptor of variantDescriptors.filter(
        ({ primaryLifecycle, tone }) =>
          !primaryLifecycle && (tone === "info" || tone === "neutral"),
      )) {
        expect(variantDisclosure, descriptor.label).toContain(descriptor.label);
      }
    }

    const fallbackDisclosure =
      renderList(normalizedHealth(), fallbackAccount).match(
        /<details[\s\S]*?<\/details>/,
      )?.[0] ?? "";
    for (const descriptor of fallbackRowDescriptors.filter(
      ({ primaryLifecycle, tone }) =>
        !primaryLifecycle && (tone === "info" || tone === "neutral"),
    )) {
      expect(fallbackDisclosure, descriptor.label).toContain(descriptor.label);
    }
    expect(directlyVisibleMarkup(renderList(onboardingHealth))).toContain(
      "Onboarding: Carrier Review",
    );

    const html = renderList(health, account);
    const disclosure = html.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
    for (const collapsedLabel of [
      "Last activity: Aug 4, 2026, 11:45 AM",
      "Calendar: not connected",
      "Risk: pending_review",
      "Brand: pending",
      "Campaign: pending",
      "Pilot",
      "Comped",
      "Billing exempt",
    ]) {
      expect(disclosure).toContain(collapsedLabel);
    }
    expect(disclosure).toContain("+8 more");
  });

  it("pins lifecycle first, then applies severity, category, and stable rank ordering", () => {
    const health = healthVariant((value) => {
      value.lifecycle.state = "onboarding";
      value.lifecycle.onboardingStepLabel = "Carrier Review";
      value.operations.state = "suspended";
      value.billing = {
        mode: "stripe",
        subscriptionPresent: true,
        plan: null,
        status: null,
        source: null,
        state: "unknown",
        pastDue: false,
        cancelAtPeriodEnd: false,
      };
      value.phone = {
        state: "blocked",
        activeCount: 1,
        smsReady: false,
        blockReason: "campaign_not_approved",
        assignmentStatus: null,
      };
    });
    const account = listAccount({ telnyxSubmissionDisabled: true });
    const descriptors = buildAdminAccountChipDescriptors({
      health,
      listAccount: account,
    });

    expect(descriptors.map(({ id }) => id)).toEqual([
      "health.lifecycle",
      "health.operations.suspended",
      "health.billing",
      "row.telnyx_submission_disabled",
      "health.sms",
      "health.a2p",
      "health.calendar",
      "health.ai",
      "health.booking",
      "row.risk",
      "row.brand",
      "row.campaign",
      "health.activity",
    ]);

    const html = renderList(health, account);
    const visible = directlyVisibleMarkup(html);
    expect(visible.indexOf("Onboarding: Carrier Review")).toBeLessThan(
      visible.indexOf("Account suspended"),
    );
    expect(visible).toContain("No Telnyx submit");
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain("+4 more");
  });

  it("uses fixed setup-reason ranks even when source reasons arrive reversed", () => {
    const health = healthVariant((value) => {
      value.failedSetup = {
        failed: true,
        reasons: [
          {
            code: "provisioning_lease_expired",
            label: "Provisioning outcome unresolved",
          },
          {
            code: "provisioning_invite_failed",
            label: "Setup invite failed",
          },
          {
            code: "provisioning_needs_attention",
            label: "Partner provisioning needs attention",
          },
          {
            code: "pending_phone_failed",
            label: "Pending number provisioning failed",
          },
          {
            code: "phone_assignment_failed",
            label: "Phone assignment failed",
          },
          { code: "campaign_rejected", label: "Campaign rejected" },
          { code: "brand_rejected", label: "Brand rejected" },
          { code: "risk_review_blocked", label: "Risk review blocked" },
          {
            code: "registration_submission_stale",
            label: "Registration submission stalled",
          },
          { code: "registration_failed", label: "Registration failed" },
        ],
      };
    });
    const setupIds = buildAdminAccountChipDescriptors({
      health,
      listAccount: listAccount(),
    })
      .filter(({ id }) => id.startsWith("health.setup."))
      .map(({ id }) => id);

    expect(setupIds).toEqual([
      "health.setup.registration_failed",
      "health.setup.registration_submission_stale",
      "health.setup.risk_review_blocked",
      "health.setup.brand_rejected",
      "health.setup.campaign_rejected",
      "health.setup.phone_assignment_failed",
      "health.setup.pending_phone_failed",
      "health.setup.provisioning_needs_attention",
      "health.setup.provisioning_invite_failed",
      "health.setup.provisioning_lease_expired",
    ]);
  });

  it("keeps deletion scheduling and suspension visible while disclosure expands inline", () => {
    const health = healthVariant((value) => {
      value.lifecycle.state = "pending_deletion";
      value.lifecycle.deletionScheduledFor =
        "2026-10-03T12:00:00.000Z";
      value.operations.state = "suspended";
    });
    const account = listAccount({
      lifecycle: "scheduled",
      deletionScheduledFor: "2026-10-03T12:00:00.000Z",
    });
    const html = renderList(health, account);
    const visible = directlyVisibleMarkup(html);

    expect(visible).toContain("Lifecycle: pending deletion");
    expect(visible).toContain("Account suspended");
    expect(visible).toContain("Deletion scheduled · 10/3/2026");
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain("+4 more");
  });

  it("offers Show less while the native chip disclosure is expanded", () => {
    const html = renderList(normalizedHealth());

    expect(html).toContain('<details class="group basis-full">');
    expect(html).toMatch(
      /<span class="group-open:hidden">\+\d+ more<\/span>/,
    );
    expect(html).toContain(
      '<span class="hidden group-open:inline">Show less</span>',
    );
  });

  it("keeps the account metadata linked and uses a text-only hover affordance", () => {
    const html = renderToStaticMarkup(
      <AdminAccountRow
        business={business()}
        subscription={{
          business_id: "11111111-1111-4111-8111-111111111111",
          plan: "sms_and_chat",
          status: "active",
        }}
        usage={undefined}
        health={normalizedHealth()}
      />,
    );
    const detailsIndex = html.indexOf("<details");
    const lastAnchorOpen = html.lastIndexOf("<a", detailsIndex);
    const lastAnchorClose = html.lastIndexOf("</a>", detailsIndex);
    const rowClass = html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
    const linkClass =
      html.match(/<a href="\/admin\/[^"]+" class="([^"]*)"/)?.[1] ?? "";

    expect(detailsIndex).toBeGreaterThan(-1);
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(lastAnchorClose).toBeGreaterThan(lastAnchorOpen);
    expect(rowClass).not.toContain("hover:bg-[#faf6ef]");
    expect(rowClass).not.toContain("dark:hover:bg-white/[0.04]");
    expect(linkClass).not.toContain("hover:bg-[#faf6ef]");
    expect(linkClass).not.toContain("dark:hover:bg-white/[0.04]");
    expect(linkClass).toContain(
      "hover:text-[var(--brand-primary-active)]",
    );
    expect(linkClass).toContain(
      "dark:hover:text-[var(--brand-primary-dark)]",
    );
    expect(html).toContain(
      'href="/admin/11111111-1111-4111-8111-111111111111"',
    );
  });
});
