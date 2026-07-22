import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  createBillingPortalSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));

vi.mock("@/lib/stripe/checkout", () => ({
  createBillingPortalSession: mocks.createBillingPortalSession,
}));

import { POST } from "./route";

function queueResults(...results: unknown[]) {
  const queue = [...results];
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected database query" },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "single"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });
}

function request() {
  return new NextRequest("http://localhost:8080/api/billing/portal", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.createBillingPortalSession.mockResolvedValue(
    "https://billing.stripe.test/session"
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/billing/portal redirect URL", () => {
  it("uses the configured public origin instead of Railway's localhost origin", async () => {
    queueResults(
      { data: { id: "business-1" }, error: null },
      { data: { stripe_customer_id: "cus_test_1" }, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createBillingPortalSession).toHaveBeenCalledWith(
      "cus_test_1",
      "https://simplassist.com/billing"
    );
    expect(await response.json()).toEqual({
      url: "https://billing.stripe.test/session",
    });
  });

  it("fails before creating a portal session when production has no public URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    queueResults(
      { data: { id: "business-1" }, error: null },
      { data: { stripe_customer_id: "cus_test_1" }, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.createBillingPortalSession).not.toHaveBeenCalled();
  });
});
