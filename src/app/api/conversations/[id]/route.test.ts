import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  decideFeatureAccess: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
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
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { DELETE } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000041";
const CONVERSATION_ID = "30000000-0000-4000-a000-000000000041";

function request() {
  return new NextRequest(
    `http://localhost/api/conversations/${CONVERSATION_ID}`,
    { method: "DELETE" }
  );
}

function configureTables(channel: "sms" | "web_chat") {
  let conversationCalls = 0;
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> & {
      then?: Promise<{ data: null; error: null }>["then"];
    } = {};
    for (const method of ["select", "eq", "single", "maybeSingle", "delete"]) {
      chain[method] = vi.fn(() => chain);
    }

    if (table === "businesses") {
      chain.single.mockResolvedValue({
        data: { id: BUSINESS_ID },
        error: null,
      });
      return chain;
    }

    conversationCalls += 1;
    if (conversationCalls === 1) {
      chain.maybeSingle.mockResolvedValue({
        data: { id: CONVERSATION_ID, channel },
        error: null,
      });
    } else {
      const result = Promise.resolve({ data: null, error: null });
      chain.then = result.then.bind(result);
    }
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user_41" } } });
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
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "user_41" },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    },
  });
  configureTables("sms");
});

describe("DELETE /api/conversations/[id] entitlement wall", () => {
  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i before conversation or entitlement reads", async (status, body) => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(body, { status }),
    });

    const response = await DELETE(request(), {
      params: { id: CONVERSATION_ID },
    });

    expect(response.status).toBe(status);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
  });

  it("allows an entitled Starter owner to delete an SMS conversation", async () => {
    const response = await DELETE(request(), {
      params: { id: CONVERSATION_ID },
    });

    expect(response.status).toBe(200);
    expect(mocks.decideFeatureAccess).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "sms_only" }),
      "contacts_inbox"
    );
  });

  it("keeps downgraded web-chat history read-only", async () => {
    configureTables("web_chat");
    mocks.decideFeatureAccess.mockReturnValue({
      outcome: "not_entitled",
      allowed: false,
      reason: "plan",
    });

    const response = await DELETE(request(), {
      params: { id: CONVERSATION_ID },
    });

    expect(response.status).toBe(403);
    expect(mocks.decideFeatureAccess).toHaveBeenCalledWith(
      expect.anything(),
      "web_chat"
    );
  });

  it("returns retryable 503 when entitlement resolution is indeterminate", async () => {
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new TestEntitlementResolutionError("subscription lookup failed")
    );

    const response = await DELETE(request(), {
      params: { id: CONVERSATION_ID },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
  });
});
