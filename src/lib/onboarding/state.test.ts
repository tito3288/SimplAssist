import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getSmsReadinessForBusiness: vi.fn(),
  getSmsReadinessForBusinessReadOnly: vi.fn(),
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  hashA2pRiskInput: vi.fn(() => "risk-hash"),
  registrationHasStartedForRisk: (business: {
    telnyx_brand_id?: string | null;
    brand_status?: string | null;
    campaign_status?: string | null;
    onboarding_registration_status?: string | null;
  }) =>
    Boolean(
      business.telnyx_brand_id ||
        business.brand_status ||
        business.campaign_status ||
        business.onboarding_registration_status === "submitted"
    ),
}));

import { deriveOnboardingStep } from "./state";

function service(name: string) {
  return { name, description: "", price: "" };
}

function faq(question: string) {
  return { question, answer: "A useful answer." };
}

function baseArgs() {
  return {
    business: {
      name: "Ready Business",
      business_type: "general",
      phone_number: "+15745550100",
      email: "owner@example.test",
      address: "1 Main St",
      city: "South Bend",
      state: "IN",
      zip: "46601",
      onboarding_completed_at: null,
      onboarding_registration_status: "not_started",
      pending_phone_number_failure_reason: null,
      telnyx_brand_id: null,
      brand_status: null,
      campaign_status: null,
      has_ein: true,
      legal_business_name: "Ready Business LLC",
      business_entity_type: "llc",
      business_registration_state: "IN",
      ein: "12-3456789",
      authorized_rep_name: "Test Owner",
      authorized_rep_title: "Owner",
      authorized_rep_email: "owner@example.test",
      authorized_rep_phone: "+15745550100",
      compliance_info_completed_at: "2026-07-24T00:00:00.000Z",
      use_case_description: "Customer care",
      estimated_monthly_volume: "under_1k",
      opt_in_description: "Website form",
      sample_messages: ["One", "Two", "Three"],
    },
    hours: Array.from({ length: 7 }, (_, day) => ({
      day: String(day),
      is_closed: false,
      open_time: "09:00",
      close_time: "17:00",
    })),
    services: [service("One"), service("Two"), service("Three")],
    faqs: [faq("One?"), faq("Two?"), faq("Three?")],
    aiSettings: {
      tone: "balanced",
      business_voice: "we",
      language: "en",
      response_delay_seconds: 5,
      web_greeting: "Hello",
      guardrails: "",
      booking_enabled: false,
      booking_mode: "collect_info",
    },
    phoneNumber: "+15745550101",
    smsReady: false,
    riskCleared: true,
  } as unknown as Parameters<typeof deriveOnboardingStep>[0];
}

describe("deriveOnboardingStep 3+3 quality gate", () => {
  it("allows exactly three distinct services and FAQs to advance", () => {
    expect(deriveOnboardingStep(baseArgs())).toBe("review_submit");
  });

  it("returns an incomplete customer when services are below three", () => {
    const args = baseArgs();
    args.services = args.services.slice(0, 2);
    expect(deriveOnboardingStep(args)).toBe("services_faqs");
  });

  it("returns an incomplete customer when answered FAQs are below three", () => {
    const args = baseArgs();
    args.faqs = args.faqs.slice(0, 2);
    expect(deriveOnboardingStep(args)).toBe("services_faqs");
  });

  it("does not count normalized duplicates", () => {
    const args = baseArgs();
    args.services[2] = service("  ONE ");
    args.faqs[2] = faq(" one? ");
    expect(deriveOnboardingStep(args)).toBe("services_faqs");
  });

  it("returns deficient content ahead of an old phone-number failure", () => {
    const args = baseArgs();
    args.services = [];
    args.business.onboarding_registration_status = "failed";
    args.business.pending_phone_number_failure_reason = "Number unavailable";
    expect(deriveOnboardingStep(args)).toBe("services_faqs");
  });

  it("keeps genuine carrier-review customers ahead of the gate", () => {
    const args = baseArgs();
    args.services = [];
    args.faqs = [];
    args.business.telnyx_brand_id = "brand-1";
    expect(deriveOnboardingStep(args)).toBe("carrier_review");
  });

  it("keeps completed customers ahead of the gate", () => {
    const args = baseArgs();
    args.services = [];
    args.faqs = [];
    args.business.onboarding_completed_at = "2026-07-24T00:00:00.000Z";
    expect(deriveOnboardingStep(args)).toBe("complete");
  });
});
