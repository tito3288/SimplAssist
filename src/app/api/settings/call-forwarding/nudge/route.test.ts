import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;

  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected database query" },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};

    for (const method of ["select", "update", "eq", "is", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }

    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    chains.push(chain);
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  queueResults();
});

describe("POST /api/settings/call-forwarding/nudge", () => {
  it("requires an authenticated owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("scopes the business lookup to the authenticated owner", async () => {
    queueResults(
      {
        data: {
          id: BUSINESS_ID,
          call_forwarding_nudge_resolved_at: null,
        },
        error: null,
      },
      { error: null }
    );

    const response = await POST();

    expect(response.status).toBe(200);
    expect(chains[0].select).toHaveBeenCalledWith(
      "id, call_forwarding_nudge_resolved_at"
    );
    expect(chains[0].eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(chains[1].eq).toHaveBeenCalledWith("id", BUSINESS_ID);
    expect(chains[1].is).toHaveBeenCalledWith(
      "call_forwarding_nudge_resolved_at",
      null
    );
  });

  it("returns 404 when the owner has no business", async () => {
    queueResults({ data: null, error: null });

    const response = await POST();

    expect(response.status).toBe(404);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("is idempotent when the nudge is already resolved", async () => {
    queueResults({
      data: {
        id: BUSINESS_ID,
        call_forwarding_nudge_resolved_at: "2026-07-19T12:00:00.000Z",
      },
      error: null,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the owner lookup fails", async () => {
    queueResults({ data: null, error: { message: "connection reset" } });

    const response = await POST();

    expect(response.status).toBe(500);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when persistence fails", async () => {
    queueResults(
      {
        data: {
          id: BUSINESS_ID,
          call_forwarding_nudge_resolved_at: null,
        },
        error: null,
      },
      { error: { message: "write unavailable" } }
    );

    const response = await POST();

    expect(response.status).toBe(500);
    expect(chains[1].update).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: expect.any(String),
    });
  });
});
