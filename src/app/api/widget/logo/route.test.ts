import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
  requiredPlanForFeature: () => "full",
  EntitlementResolutionError: class EntitlementResolutionError extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  },
}));

import { POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

function request() {
  return new NextRequest("http://localhost/api/widget/logo", {
    method: "POST",
    body: new FormData(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "user-1" },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    },
  });
});

describe("POST /api/widget/logo workspace access", () => {
  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i before parsing, entitlement, or storage work", async (status, body) => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(body, { status }),
    });
    const guardedRequest = request();
    const formData = vi.spyOn(guardedRequest, "formData");

    const response = await POST(guardedRequest);

    expect(response.status).toBe(status);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
