import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSmsReadinessForBusiness: vi.fn(),
  getSmsReadinessForBusinessReadOnly: vi.fn(),
  directFlag: vi.fn(),
  validChatPrice: vi.fn(),
  selectedColumns: new Map<string, string>(),
  rowsByTable: {} as Record<string, unknown>,
  errorsByTable: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getSmsReadinessForBusiness: mocks.getSmsReadinessForBusiness,
  getSmsReadinessForBusinessReadOnly:
    mocks.getSmsReadinessForBusinessReadOnly,
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  hashA2pRiskInput: vi.fn(() => "risk-hash"),
  registrationHasStartedForRisk: vi.fn(() => false),
}));
vi.mock("@/lib/billing/chatOnlyRollout.server", () => ({
  isChatOnlyDirectSalesEnabled: mocks.directFlag,
}));
vi.mock("@/lib/stripe/config", () => ({
  hasValidChatOnlyStripePrice: mocks.validChatPrice,
}));

import {
  getOnboardingStateForBusinessId,
  getOnboardingStateForOwnerReadOnly,
} from "./state";

function makeQuery(table: string, data: unknown, error: unknown) {
  const result = { data, error };
  const query = {
    select: vi.fn((columns: string) => {
      mocks.selectedColumns.set(table, columns);
      return query;
    }),
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    returns: vi.fn(async () => result),
  };
  return query;
}

describe("onboarding knowledge provenance resume loading", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getSmsReadinessForBusiness.mockReset();
    mocks.getSmsReadinessForBusinessReadOnly.mockReset();
    mocks.directFlag.mockReset();
    mocks.validChatPrice.mockReset();
    mocks.selectedColumns.clear();
    mocks.errorsByTable = {};
    mocks.directFlag.mockReturnValue(false);
    mocks.validChatPrice.mockReturnValue(false);

    mocks.rowsByTable = {
      businesses: {
        id: "business-1",
        owner_id: "owner-1",
        partner_id: null,
        billing_mode: "stripe",
        partner_plan: null,
        onboarding_selected_plan: null,
        primary_goal: "signup",
        goal_url: "https://example.test/signup?source=ai#form",
        name: "Provenance Test",
        business_type: "general",
        onboarding_step: "services_faqs",
        onboarding_completed_at: null,
        onboarding_last_saved_at: null,
        onboarding_registration_status: "not_started",
        has_ein: null,
      },
      business_hours: [],
      services: [
        {
          name: "Scanned service",
          description: null,
          price: null,
          source: "scraped",
        },
      ],
      faqs: [
        {
          question: "Suggested question?",
          answer: "Suggested answer.",
          source: "suggested",
        },
        {
          question: "Legacy question?",
          answer: "Legacy answer.",
          source: null,
        },
      ],
      ai_settings: null,
      widget_configs: null,
      phone_numbers: null,
      subscriptions: null,
    };

    mocks.from.mockImplementation((table: string) =>
      makeQuery(
        table,
        mocks.rowsByTable[table] ?? null,
        mocks.errorsByTable[table] ?? null,
      )
    );
    mocks.getSmsReadinessForBusinessReadOnly.mockResolvedValue({
      phoneNumber: null,
      smsReady: false,
      blockReason: null,
      assignmentStatus: null,
      assignmentFailureReason: null,
    });
    mocks.getSmsReadinessForBusiness.mockResolvedValue({
      phoneNumber: null,
      smsReady: false,
      blockReason: null,
      assignmentStatus: null,
      assignmentFailureReason: null,
    });
  });

  function configureCoreReadyBusiness(
    overrides: Record<string, unknown> = {},
  ) {
    mocks.rowsByTable.businesses = {
      ...(mocks.rowsByTable.businesses as Record<string, unknown>),
      name: "Ready Business",
      business_type: "general",
      phone_number: "+15745550100",
      email: "owner@example.test",
      address: "1 Main St",
      city: "South Bend",
      state: "IN",
      zip: "46601",
      primary_goal: "book",
      ...overrides,
    };
    mocks.rowsByTable.business_hours = Array.from({ length: 7 }, (_, day) => ({
      day_of_week: day,
      is_closed: false,
      open_time: "09:00:00",
      close_time: "17:00:00",
    }));
    mocks.rowsByTable.services = ["One", "Two", "Three"].map((name) => ({
      name,
      description: null,
      price: null,
      source: "manual",
    }));
    mocks.rowsByTable.faqs = ["One?", "Two?", "Three?"].map((question) => ({
      question,
      answer: "A useful answer.",
      source: "manual",
    }));
    mocks.rowsByTable.ai_settings = {
      tone: "balanced",
      business_voice: "we",
      language: "en",
      sms_response_delay_seconds: 5,
      guardrails: [],
      booking_enabled: false,
      booking_mode: "collect_info",
    };
  }

  it("selects and retains stored sources while defaulting a legacy null FAQ", async () => {
    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(mocks.selectedColumns.get("services")).toContain("source");
    expect(mocks.selectedColumns.get("faqs")).toContain("source");
    expect(mocks.selectedColumns.get("businesses")).toContain("partner_id");
    expect(mocks.selectedColumns.get("businesses")).toContain("billing_mode");
    expect(mocks.selectedColumns.get("businesses")).toContain("primary_goal");
    expect(mocks.selectedColumns.get("businesses")).toContain("goal_url");
    expect(state?.primaryGoal).toBe("signup");
    expect(state?.goalUrl).toBe(
      "https://example.test/signup?source=ai#form"
    );
    expect(state?.servicesAndFaqs).toEqual({
      services: [
        {
          name: "Scanned service",
          description: "",
          price: "",
          source: "scraped",
        },
      ],
      faqs: [
        {
          question: "Suggested question?",
          answer: "Suggested answer.",
          source: "suggested",
        },
        {
          question: "Legacy question?",
          answer: "Legacy answer.",
          source: "manual",
        },
      ],
    });
    expect(state?.billing).toMatchObject({
      mode: "stripe",
      handledByName: null,
    });
    expect(mocks.from).not.toHaveBeenCalledWith("partners");
  });

  it("selects and returns goal values in the business-id state projection", async () => {
    const state = await getOnboardingStateForBusinessId("business-1");

    expect(mocks.selectedColumns.get("businesses")).toContain("primary_goal");
    expect(mocks.selectedColumns.get("businesses")).toContain("goal_url");
    expect(state?.primaryGoal).toBe("signup");
    expect(state?.goalUrl).toBe(
      "https://example.test/signup?source=ai#form"
    );
  });

  it("preserves every direct subscription billing field in onboarding state", async () => {
    mocks.rowsByTable.subscriptions = {
      plan: "full",
      status: "past_due",
      setup_fee_paid_at: "2026-07-01T12:00:00.000Z",
      current_period_start: "2026-07-01T00:00:00.000Z",
      current_period_end: "2026-08-01T00:00:00.000Z",
    };

    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(mocks.selectedColumns.get("subscriptions")).toBe(
      "plan, status, setup_fee_paid_at, current_period_start, current_period_end"
    );
    expect(state?.billing).toEqual({
      mode: "stripe",
      handledByName: null,
      plan: "full",
      status: "past_due",
      setupFeePaidAt: "2026-07-01T12:00:00.000Z",
      currentPeriodStart: "2026-07-01T00:00:00.000Z",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    });
  });

  it("keeps an SMS-ready null-goal business out of the dashboard", async () => {
    mocks.rowsByTable.businesses = {
      ...(mocks.rowsByTable.businesses as Record<string, unknown>),
      primary_goal: null,
      goal_url: null,
      name: "Ready Business",
      business_type: "general",
      phone_number: "+15745550100",
      email: "owner@example.test",
      address: "1 Main St",
      city: "South Bend",
      state: "IN",
      zip: "46601",
      onboarding_completed_at: "2026-07-24T00:00:00.000Z",
    };
    mocks.rowsByTable.business_hours = Array.from({ length: 7 }, (_, day) => ({
      day_of_week: day,
      is_closed: false,
      open_time: "09:00:00",
      close_time: "17:00:00",
    }));
    mocks.rowsByTable.services = ["One", "Two", "Three"].map((name) => ({
      name,
      description: null,
      price: null,
      source: "manual",
    }));
    mocks.rowsByTable.faqs = ["One?", "Two?", "Three?"].map(
      (question) => ({
        question,
        answer: "A useful answer.",
        source: "manual",
      })
    );
    mocks.getSmsReadinessForBusinessReadOnly.mockResolvedValue({
      phoneNumber: "+15745550101",
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
    });

    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(state).toMatchObject({
      primaryGoal: null,
      goalUrl: null,
      currentStep: "ai_settings",
      dashboardReady: false,
    });
  });

  it("loads the assigned partner name through the service-role state query", async () => {
    mocks.rowsByTable.businesses = {
      ...(mocks.rowsByTable.businesses as Record<string, unknown>),
      partner_id: "11111111-1111-4111-8111-111111111111",
      billing_mode: "invoiced",
    };
    mocks.rowsByTable.partners = { name: "Alpha Dog Agency" };

    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(mocks.from).toHaveBeenCalledWith("partners");
    expect(mocks.selectedColumns.get("partners")).toBe("name");
    expect(state?.billing).toMatchObject({
      mode: "invoiced",
      handledByName: "Alpha Dog Agency",
    });
  });

  it("returns a null handled-by name when the assignment is orphaned", async () => {
    mocks.rowsByTable.businesses = {
      ...(mocks.rowsByTable.businesses as Record<string, unknown>),
      partner_id: "11111111-1111-4111-8111-111111111111",
      billing_mode: "comped",
    };
    mocks.rowsByTable.partners = null;

    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(state?.billing).toMatchObject({
      mode: "comped",
      handledByName: null,
    });
  });

  it("resolves subscription over partner plan over direct intent", async () => {
    configureCoreReadyBusiness({
      partner_plan: "chat_only",
      onboarding_selected_plan: "chat_only",
    });
    mocks.rowsByTable.subscriptions = {
      plan: "sms_only",
      status: "active",
      setup_fee_paid_at: "2026-07-01T00:00:00.000Z",
      current_period_start: "2026-07-01T00:00:00.000Z",
      current_period_end: "2026-08-01T00:00:00.000Z",
    };

    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(state?.planSelection).toMatchObject({
      effectivePlan: "sms_only",
      source: "subscription",
    });
    expect(state?.steps).toEqual([
      "business_info",
      "business_hours",
      "services_faqs",
      "ai_settings",
      "legal_verification",
      "sms_use_case",
      "phone_number",
      "review_submit",
      "carrier_review",
    ]);
  });

  it("keeps the direct intent and extra step hidden until flag and Price are valid", async () => {
    configureCoreReadyBusiness({
      primary_goal: null,
      onboarding_selected_plan: "chat_only",
    });

    const hiddenState = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(hiddenState?.planSelection).toMatchObject({
      effectivePlan: null,
      directIntent: null,
      canChooseDirectPlan: false,
      chatOnlyDirectSalesAvailable: false,
    });
    expect(hiddenState?.currentStep).toBe("ai_settings");
    expect(hiddenState?.steps).toHaveLength(9);

    mocks.directFlag.mockReturnValue(true);
    const missingPriceState = await getOnboardingStateForOwnerReadOnly("owner-1");
    expect(missingPriceState?.planSelection.effectivePlan).toBeNull();
    expect(missingPriceState?.currentStep).toBe("ai_settings");

    mocks.validChatPrice.mockReturnValue(true);
    const enabledState = await getOnboardingStateForOwnerReadOnly("owner-1");
    expect(enabledState?.planSelection).toMatchObject({
      effectivePlan: "chat_only",
      directIntent: "chat_only",
      canChooseDirectPlan: true,
      chatOnlyDirectSalesAvailable: true,
    });
    expect(enabledState?.currentStep).toBe("ai_settings");
    expect(enabledState?.steps).toHaveLength(6);
  });

  it.each(["active", "trialing"] as const)(
    "unlocks completed direct Chat Only for synchronized %s authority",
    async (status) => {
      configureCoreReadyBusiness({
        onboarding_completed_at: "2026-08-18T12:00:00.000Z",
        onboarding_selected_plan: "sms_only",
      });
      mocks.rowsByTable.subscriptions = {
        plan: "chat_only",
        status,
        setup_fee_paid_at: null,
        current_period_start: "2026-08-18T12:00:00.000Z",
        current_period_end: "2026-09-18T12:00:00.000Z",
      };

      const state = await getOnboardingStateForOwnerReadOnly("owner-1");

      expect(state?.planSelection).toMatchObject({
        effectivePlan: "chat_only",
        source: "subscription",
      });
      expect(state).toMatchObject({
        currentStep: "complete",
        dashboardReady: true,
        completedAt: "2026-08-18T12:00:00.000Z",
      });
      expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
      expect(mocks.getSmsReadinessForBusinessReadOnly).not.toHaveBeenCalled();
    },
  );

  it("fails closed on a direct subscription read error before SMS readiness", async () => {
    configureCoreReadyBusiness({
      onboarding_completed_at: "2026-08-18T12:00:00.000Z",
      onboarding_selected_plan: null,
    });
    mocks.rowsByTable.subscriptions = {
      plan: "chat_only",
      status: "active",
      setup_fee_paid_at: null,
      current_period_start: "2026-08-18T12:00:00.000Z",
      current_period_end: "2026-09-18T12:00:00.000Z",
    };
    mocks.errorsByTable.subscriptions = { message: "database unavailable" };

    await expect(
      getOnboardingStateForBusinessId("business-1"),
    ).rejects.toThrow(
      "Failed to read subscription for business-1: database unavailable",
    );
    expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
    expect(mocks.getSmsReadinessForBusinessReadOnly).not.toHaveBeenCalled();
  });

  it("keeps owner intent unready and inert even with retained SMS-ready rows", async () => {
    configureCoreReadyBusiness({
      onboarding_selected_plan: "chat_only",
      onboarding_completed_at: "2026-08-18T12:00:00.000Z",
      pending_phone_number: "+13175550124",
    });
    mocks.rowsByTable.phone_numbers = {
      phone_number: "+13175550123",
      telnyx_campaign_assignment_status: "assigned",
      telnyx_campaign_assignment_failure_reason: null,
    };
    mocks.directFlag.mockReturnValue(true);
    mocks.validChatPrice.mockReturnValue(true);
    mocks.getSmsReadinessForBusiness.mockResolvedValue({
      phoneNumber: "+13175550123",
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
    });
    mocks.getSmsReadinessForBusinessReadOnly.mockResolvedValue({
      phoneNumber: "+13175550123",
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
    });

    const state = await getOnboardingStateForBusinessId("business-1");

    expect(state).toMatchObject({
      currentStep: "review_submit",
      dashboardReady: false,
      phoneNumber: null,
      activePhoneNumber: null,
      pendingPhoneNumber: "+13175550124",
      registration: {
        smsReady: false,
        assignmentStatus: null,
      },
      planSelection: {
        effectivePlan: "chat_only",
        source: "direct_intent",
      },
    });
    expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
    expect(mocks.getSmsReadinessForBusinessReadOnly).not.toHaveBeenCalled();
  });

  it("keeps a previously completed Chat Only account available while past due", async () => {
    configureCoreReadyBusiness({
      onboarding_completed_at: "2026-08-18T12:00:00.000Z",
    });
    mocks.rowsByTable.subscriptions = {
      plan: "chat_only",
      status: "past_due",
      setup_fee_paid_at: null,
      current_period_start: "2026-08-18T12:00:00.000Z",
      current_period_end: "2026-09-18T12:00:00.000Z",
    };

    const state = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(state).toMatchObject({
      currentStep: "complete",
      dashboardReady: true,
      completedAt: "2026-08-18T12:00:00.000Z",
    });
  });

  it("does not let past-due Chat Only create initial completion", async () => {
    configureCoreReadyBusiness({ onboarding_completed_at: null });
    mocks.rowsByTable.subscriptions = {
      plan: "chat_only",
      status: "past_due",
      setup_fee_paid_at: null,
      current_period_start: "2026-08-18T12:00:00.000Z",
      current_period_end: "2026-09-18T12:00:00.000Z",
    };

    const state = await getOnboardingStateForBusinessId("business-1");

    expect(state).toMatchObject({
      currentStep: "review_submit",
      dashboardReady: false,
      completedAt: null,
    });
    expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
    expect(mocks.getSmsReadinessForBusinessReadOnly).not.toHaveBeenCalled();
  });

  it("accepts Chat Only partner authority only in a real partner billing mode", async () => {
    configureCoreReadyBusiness({
      partner_id: "11111111-1111-4111-8111-111111111111",
      billing_mode: "comped",
      partner_plan: "chat_only",
      onboarding_completed_at: "2026-08-18T12:00:00.000Z",
    });
    mocks.rowsByTable.partners = { name: "Alpha Dog Agency" };

    const partnerState = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(partnerState?.planSelection).toMatchObject({
      effectivePlan: "chat_only",
      source: "partner_plan",
    });
    expect(partnerState?.dashboardReady).toBe(true);

    configureCoreReadyBusiness({
      partner_id: null,
      billing_mode: "stripe",
      partner_plan: "chat_only",
      onboarding_completed_at: "2026-08-18T12:00:00.000Z",
    });
    const malformedState = await getOnboardingStateForOwnerReadOnly("owner-1");

    expect(malformedState?.planSelection).toMatchObject({
      effectivePlan: null,
      source: null,
      canChooseDirectPlan: false,
    });
    expect(malformedState?.dashboardReady).toBe(false);
  });
});
