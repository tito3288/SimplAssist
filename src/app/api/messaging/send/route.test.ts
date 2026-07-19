import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  decideFeatureAccess: vi.fn(),
  getOutboundSendContext: vi.fn(),
  preflightOutboundSms: vi.fn(),
  recordOutboundSmsUsage: vi.fn(),
  send: vi.fn(),
}));

class TestEntitlementResolutionError extends Error {}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  decideFeatureAccess: mocks.decideFeatureAccess,
  isEntitlementResolutionError: (error: unknown) =>
    error instanceof TestEntitlementResolutionError,
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getOutboundSendContext: mocks.getOutboundSendContext,
  smsBlockCode: vi.fn(() => "campaign_not_approved"),
  smsBlockMessage: vi.fn(() => "SMS is unavailable"),
}));
vi.mock("@/lib/billing/usage", () => ({
  preflightOutboundSms: mocks.preflightOutboundSms,
  recordOutboundSmsUsage: mocks.recordOutboundSmsUsage,
}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: { messages: { send: mocks.send } },
}));

import { POST } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000040";
const REQUEST_BODY = {
  to: "+15745550100",
  message: "Thanks for reaching out.",
  businessId: BUSINESS_ID,
};

function request() {
  return new NextRequest("http://localhost/api/messaging/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(REQUEST_BODY),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user_40" } } });
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.maybeSingle.mockResolvedValue(
      table === "businesses"
        ? { data: { id: BUSINESS_ID }, error: null }
        : { data: { phone_number: "+15745550200" }, error: null }
    );
    return chain;
  });
  mocks.resolveBusinessEntitlements.mockResolvedValue({
    businessId: BUSINESS_ID,
    plan: "sms_only",
    status: "active",
    source: "subscription",
    active: true,
    cancelAtPeriodEnd: false,
  });
  mocks.decideFeatureAccess.mockReturnValue({
    outcome: "resolved",
    allowed: true,
  });
  mocks.getOutboundSendContext.mockResolvedValue({
    smsReady: true,
    messagingProfileId: "profile_40",
    blockReason: null,
  });
  mocks.preflightOutboundSms.mockResolvedValue({ allowed: true });
  mocks.send.mockResolvedValue({ data: { id: "message_40" } });
  mocks.recordOutboundSmsUsage.mockResolvedValue(undefined);
});

describe("POST /api/messaging/send entitlement wall", () => {
  it("allows Starter manual SMS and records the provider send", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.decideFeatureAccess).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "sms_only", active: true }),
      "manual_sms"
    );
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.recordOutboundSmsUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        providerMessageId: "message_40",
      })
    );
  });

  it("returns 403 for a known inactive-plan denial before Telnyx", async () => {
    mocks.decideFeatureAccess.mockReturnValue({
      outcome: "not_entitled",
      allowed: false,
      reason: "inactive_subscription",
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when billing authority cannot be determined", async () => {
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new TestEntitlementResolutionError("subscription lookup failed")
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when the business authorization lookup errors", async () => {
    mocks.from.mockImplementation((table: string) => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ["select", "eq", "maybeSingle"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.maybeSingle.mockResolvedValue(
        table === "businesses"
          ? { data: null, error: { message: "connection reset" } }
          : { data: { phone_number: "+15745550200" }, error: null }
      );
      return chain;
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when the active phone-number lookup errors", async () => {
    mocks.from.mockImplementation((table: string) => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ["select", "eq", "maybeSingle"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.maybeSingle.mockResolvedValue(
        table === "businesses"
          ? { data: { id: BUSINESS_ID }, error: null }
          : { data: null, error: { message: "connection reset" } }
      );
      return chain;
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
