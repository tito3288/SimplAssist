import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  createClient: vi.fn(),
  startWebsiteScan: vi.fn(),
  loadWebsiteScan: vi.fn(),
  validateWebsiteScanSourceUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/website-scans/ownerActions.server", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/website-scans/ownerActions.server")
  >();
  return { ...original, startWebsiteScan: mocks.startWebsiteScan };
});
vi.mock("@/lib/website-scans/ownerRepository.server", () => ({
  loadWebsiteScan: mocks.loadWebsiteScan,
}));
vi.mock("@/lib/website-scans/sourceUrl.server", () => ({
  validateWebsiteScanSourceUrl: mocks.validateWebsiteScanSourceUrl,
}));

import { POST } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OWNER_ID = "20000000-0000-4000-a000-000000000002";
const REQUEST_ID = "30000000-0000-4000-a000-000000000003";
const SCAN_ID = "40000000-0000-4000-a000-000000000004";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/website-scans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function onboardingClient() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: { onboarding_completed_at: null },
    error: null,
  }));
  return { from: vi.fn(() => chain) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      user: { id: OWNER_ID },
      business: { id: BUSINESS_ID },
    },
  });
  mocks.createClient.mockResolvedValue(onboardingClient());
  mocks.validateWebsiteScanSourceUrl.mockResolvedValue("https://example.com/");
  mocks.startWebsiteScan.mockResolvedValue({ data: { id: SCAN_ID }, error: null });
  mocks.loadWebsiteScan.mockResolvedValue({
    id: SCAN_ID,
    websiteUrl: "https://example.com/",
    status: "queued",
    coverage: null,
    version: 0,
    pageCount: 0,
    failedPageCount: 0,
    draft: null,
  });
});

describe("POST /api/website-scans", () => {
  it("returns the workspace denial before parsing or doing database/provider work", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "workspace_access_denied" }, { status: 403 }),
    });
    const nextRequest = request({
      url: "https://example.com",
      trigger: "onboarding",
      clientRequestId: REQUEST_ID,
    });
    const jsonSpy = vi.spyOn(nextRequest, "json");

    const response = await POST(nextRequest);

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.validateWebsiteScanSourceUrl).not.toHaveBeenCalled();
  });

  it("starts an owner-scoped onboarding scan without accepting a body business ID", async () => {
    const response = await POST(
      request({
        url: "https://example.com",
        trigger: "onboarding",
        clientRequestId: REQUEST_ID,
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(mocks.startWebsiteScan).toHaveBeenCalledWith(expect.anything(), {
      businessId: BUSINESS_ID,
      sourceUrl: "https://example.com/",
      purpose: "onboarding",
      idempotencyKey: REQUEST_ID,
    });
    await expect(response.json()).resolves.toMatchObject({
      scan: { id: SCAN_ID, status: "queued" },
    });
  });

  it("rejects unknown authority fields before starting a scan", async () => {
    const response = await POST(
      request({
        url: "https://example.com",
        trigger: "onboarding",
        clientRequestId: REQUEST_ID,
        businessId: "50000000-0000-4000-a000-000000000005",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.startWebsiteScan).not.toHaveBeenCalled();
  });
});
