import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSmsReadinessForBusiness: vi.fn(),
  getSmsReadinessForBusinessReadOnly: vi.fn(),
  selectedColumns: new Map<string, string>(),
  rowsByTable: {} as Record<string, unknown>,
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

import {
  getOnboardingStateForBusinessId,
  getOnboardingStateForOwnerReadOnly,
} from "./state";

function makeQuery(table: string, data: unknown) {
  const result = { data, error: null };
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
    mocks.selectedColumns.clear();

    mocks.rowsByTable = {
      businesses: {
        id: "business-1",
        owner_id: "owner-1",
        partner_id: null,
        billing_mode: "stripe",
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
      makeQuery(table, mocks.rowsByTable[table] ?? null)
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
});
