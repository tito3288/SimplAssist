import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  crawlSite: vi.fn(),
  extractBusinessInfo: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));
vi.mock("@/lib/firecrawl/crawl", () => ({
  CRAWL_AUTOFILL_OPTS: {},
  crawlSite: mocks.crawlSite,
}));
vi.mock("@/lib/firecrawl/extract", () => ({
  extractBusinessInfo: mocks.extractBusinessInfo,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { POST } from "./route";

function queueBusinessResult(result: unknown) {
  mocks.from.mockImplementation(() => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });
}

function request(ip = "203.0.113.10") {
  return new NextRequest("http://localhost/api/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ url: "https://example.test" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access: {} });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  queueBusinessResult({
    data: { id: "business-1", onboarding_completed_at: null },
    error: null,
  });
  mocks.crawlSite.mockResolvedValue({
    homepageOk: true,
    homepageMarkdown: "Landscaping services",
    subpages: [],
  });
  mocks.extractBusinessInfo.mockResolvedValue({
    business_name: "Green Leaf",
    services: [],
    faqs: [],
    business_hours: null,
  });
});

describe("POST /api/scrape", () => {
  it("returns a workspace denial before auth, rate limiting, or providers", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_denied" },
        { status: 403 },
      ),
    });

    const response = await POST(request("203.0.113.100"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "workspace_access_denied" });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.crawlSite).not.toHaveBeenCalled();
    expect(mocks.extractBusinessInfo).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before crawling or Anthropic", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(request("203.0.113.11"));

    expect(response.status).toBe(401);
    expect(mocks.crawlSite).not.toHaveBeenCalled();
    expect(mocks.extractBusinessInfo).not.toHaveBeenCalled();
  });

  it("rejects completed onboarding before crawling or Anthropic", async () => {
    queueBusinessResult({
      data: {
        id: "business-1",
        onboarding_completed_at: "2026-07-18T12:00:00.000Z",
      },
      error: null,
    });

    const response = await POST(request("203.0.113.12"));

    expect(response.status).toBe(403);
    expect(mocks.crawlSite).not.toHaveBeenCalled();
    expect(mocks.extractBusinessInfo).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when onboarding authorization is unreadable", async () => {
    queueBusinessResult({
      data: null,
      error: { message: "connection reset" },
    });

    const response = await POST(request("203.0.113.13"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ retryable: true });
    expect(mocks.crawlSite).not.toHaveBeenCalled();
    expect(mocks.extractBusinessInfo).not.toHaveBeenCalled();
  });

  it("keeps the authenticated pre-checkout onboarding scan available", async () => {
    const response = await POST(request("203.0.113.14"));

    expect(response.status).toBe(200);
    expect(mocks.crawlSite).toHaveBeenCalledWith(
      "https://example.test",
      expect.any(Object)
    );
    expect(mocks.extractBusinessInfo).toHaveBeenCalledWith(
      "Landscaping services"
    );
    expect(await response.json()).toMatchObject({ business_name: "Green Leaf" });
  });
});
