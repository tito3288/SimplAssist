import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  adminFrom: vi.fn(),
  ensureUniqueSlug: vi.fn(),
  appendRegistrationEvent: vi.fn(),
  registrationHasStartedForRisk: vi.fn(),
  screenA2pRiskForBusiness: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));
vi.mock("@/lib/util/slug.server", () => ({
  ensureUniqueSlug: mocks.ensureUniqueSlug,
}));
vi.mock("@/lib/messaging/registration/audit", () => ({
  appendRegistrationEvent: mocks.appendRegistrationEvent,
  serializeError: (error: unknown) => String(error),
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  registrationHasStartedForRisk: mocks.registrationHasStartedForRisk,
  screenA2pRiskForBusiness: mocks.screenA2pRiskForBusiness,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { POST } from "./route";
import { REJECTION_SUPPORT_MESSAGE } from "@/lib/onboarding/rejectionGuidance";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000020";

function business(overrides: Record<string, unknown>) {
  return {
    id: BUSINESS_ID,
    compliance_info_completed_at: "2026-07-01T00:00:00.000Z",
    slug: "example-service",
    privacy_terms_mode: "hosted",
    privacy_url_override: null,
    terms_url_override: null,
    website_url: "https://example.test",
    legal_business_name: "Example Service LLC",
    business_entity_type: "llc",
    business_registration_state: "IN",
    has_ein: true,
    ein: "12-3456789",
    authorized_rep_name: "Taylor Example",
    authorized_rep_title: "Owner",
    authorized_rep_email: "taylor@example.test",
    authorized_rep_phone: "+13175550100",
    telnyx_brand_id: "brand-1",
    brand_status: null,
    campaign_status: null,
    onboarding_registration_status: "failed",
    ...overrides,
  };
}

function userClient(businessRow: Record<string, unknown>) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: businessRow, error: null });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    from: vi.fn(() => chain),
  };
}

function request() {
  return new NextRequest("http://localhost/api/onboarding/sms-use-case", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId: BUSINESS_ID,
      use_case_description:
        "We respond to existing customer questions about requested services.",
      estimated_monthly_volume: "under_1k",
      sample_messages: [
        "Example Service LLC: We received your service question. Reply STOP to unsubscribe.",
        "Example Service LLC: What day works best for a quick call?",
        "Example Service LLC: Thanks, our team will follow up shortly.",
      ],
      opt_in_description:
        "Customers opt in by contacting the business for help through its website or phone number.",
      a2p_risk_checklist_answer: "none",
      a2p_risk_checklist_selections: [],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access: {} });
  mocks.registrationHasStartedForRisk.mockReturnValue(false);
  mocks.screenA2pRiskForBusiness.mockResolvedValue({
    registrationStarted: false,
    status: "passed",
  });
});

describe("POST /api/onboarding/sms-use-case rejection lock", () => {
  it.each([
    ["campaign-only", { brand_status: "approved", campaign_status: "rejected" }],
    ["brand-only", { brand_status: "rejected", campaign_status: null }],
    ["dual", { brand_status: "rejected", campaign_status: "rejected" }],
  ])(
    "locks a stale %s form before risk checks, audit events, or writes",
    async (_label, statuses) => {
      const client = userClient(business(statuses));
      mocks.createClient.mockResolvedValue(client);

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: REJECTION_SUPPORT_MESSAGE,
        code: "rejection_support_required",
      });
      expect(mocks.registrationHasStartedForRisk).not.toHaveBeenCalled();
      expect(mocks.ensureUniqueSlug).not.toHaveBeenCalled();
      expect(mocks.screenA2pRiskForBusiness).not.toHaveBeenCalled();
      expect(mocks.appendRegistrationEvent).not.toHaveBeenCalled();
      expect(mocks.adminFrom).not.toHaveBeenCalled();
    },
  );
});
