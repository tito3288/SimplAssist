import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSmsReadinessForBusinessReadOnly: vi.fn(),
  selectedColumns: new Map<string, string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getSmsReadinessForBusiness: vi.fn(),
  getSmsReadinessForBusinessReadOnly:
    mocks.getSmsReadinessForBusinessReadOnly,
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  hashA2pRiskInput: vi.fn(() => "risk-hash"),
  registrationHasStartedForRisk: vi.fn(() => false),
}));

import { getOnboardingStateForOwnerReadOnly } from "./state";

function makeQuery(table: string, data: unknown) {
  const result = { data, error: null };
  const query = {
    select: vi.fn((columns: string) => {
      mocks.selectedColumns.set(table, columns);
      return query;
    }),
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
    mocks.getSmsReadinessForBusinessReadOnly.mockReset();
    mocks.selectedColumns.clear();

    const rowsByTable: Record<string, unknown> = {
      businesses: {
        id: "business-1",
        owner_id: "owner-1",
        name: "Provenance Test",
        business_type: "general",
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
      makeQuery(table, rowsByTable[table] ?? null)
    );
    mocks.getSmsReadinessForBusinessReadOnly.mockResolvedValue({
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
  });
});
