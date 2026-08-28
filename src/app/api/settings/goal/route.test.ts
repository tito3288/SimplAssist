import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  registrationHasStartedForRisk: (business: {
    telnyx_brand_id: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    onboarding_registration_status: string | null;
  }) =>
    Boolean(
      business.telnyx_brand_id ||
        business.brand_status ||
        business.campaign_status ||
        business.onboarding_registration_status === "submitted"
    ),
}));

import {
  REGISTRATION_STATE_UNAVAILABLE_CODE,
  SETTINGS_REGISTRATION_LOCK_CODE,
  SETTINGS_STATE_CHANGED_CODE,
  SETTINGS_STATE_CHANGED_MESSAGE,
  GOAL_SIGNUP_LOCK_COPY,
} from "@/lib/settings/registrationLockCopy";
import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";

type QueryResult = {
  data: unknown;
  error: unknown;
};

type QueryChain = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

const chains: QueryChain[] = [];

function queueResults(...results: QueryResult[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected database query" },
    };
    const chain = {} as QueryChain;
    chain.select = vi.fn(() => chain);
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => result);
    chains.push(chain);
    return chain;
  });
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/settings/goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string) {
  return new NextRequest("http://localhost/api/settings/goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function goalState(
  overrides: Partial<{
    primary_goal: "book" | "signup" | "quote" | "callback" | null;
    telnyx_brand_id: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    onboarding_registration_status:
      | "not_started"
      | "submitting"
      | "submitted"
      | "failed";
  }> = {}
) {
  return {
    primary_goal: "book" as const,
    telnyx_brand_id: null,
    brand_status: null,
    campaign_status: null,
    onboarding_registration_status: "not_started" as const,
    ...overrides,
  };
}

function lockedState(
  primaryGoal: "book" | "signup" | "quote" | "callback" | null
) {
  return goalState({
    primary_goal: primaryGoal,
    telnyx_brand_id: "brand-1",
    brand_status: "approved",
    campaign_status: "approved",
    onboarding_registration_status: "submitted",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      user: { id: USER_ID },
      business: { id: BUSINESS_ID },
    },
  });
  queueResults();
});

describe("POST /api/settings/goal", () => {
  it("awaits the workspace gate before parsing input or reading state", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_denied" },
        { status: 403 }
      ),
    });
    const request = makeRequest({ primary_goal: "book" });
    const jsonSpy = vi.spyOn(request, "json");

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "workspace_access_denied" });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before reading registration state", async () => {
    const response = await POST(makeRawRequest("{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns 401 before parsing or reading state without a workspace user", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: { user: null, business: { id: BUSINESS_ID } },
    });
    const request = makeRequest({ primary_goal: "book" });
    const jsonSpy = vi.spyOn(request, "json");

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    [{ primary_goal: "book", goal_url: "https://example.com" }],
    [{ primary_goal: "signup" }],
    [
      {
        primary_goal: "signup",
        goal_url: "https://example.com",
        businessId: BUSINESS_ID,
      },
    ],
    [{ primary_goal: "signup", goal_url: "http://example.com" }],
    [{ primary_goal: "quote" }],
  ])("rejects non-PrimaryGoalUpdate shape %j", async (body) => {
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid goal settings" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed when fresh registration state is unavailable", async () => {
    queueResults({ data: null, error: { message: "unavailable" } });

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: REGISTRATION_STATE_UNAVAILABLE_CODE,
    });
  });

  it("fails closed when fresh registration-state lookup throws", async () => {
    mocks.from.mockImplementationOnce(() => {
      throw new Error("database offline");
    });

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: REGISTRATION_STATE_UNAVAILABLE_CODE,
    });
  });

  it.each(["book", "quote", "callback", null] as const)(
    "returns the exact lock response for filed %s to signup",
    async (currentGoal) => {
      queueResults({ data: lockedState(currentGoal), error: null });

      const response = await POST(
        makeRequest({
          primary_goal: "signup",
          goal_url: "https://example.com/signup",
        })
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: SETTINGS_REGISTRATION_LOCK_CODE,
        error: GOAL_SIGNUP_LOCK_COPY.message,
      });
      expect(mocks.from).toHaveBeenCalledTimes(1);
    }
  );

  it("allows a filed signup URL edit and compares registration plus current goal", async () => {
    queueResults(
      { data: lockedState("signup"), error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );

    const response = await POST(
      makeRequest({
        primary_goal: "signup",
        goal_url: "  HttpS://example.com/Path?Camp=Summer#SignUp  ",
      })
    );

    expect(response.status).toBe(200);
    expect(chains[1].update).toHaveBeenCalledExactlyOnceWith({
      primary_goal: "signup",
      goal_url: "https://example.com/Path?Camp=Summer#SignUp",
    });
    expect(chains[1].eq.mock.calls).toEqual([
      ["id", BUSINESS_ID],
      ["owner_id", USER_ID],
      ["telnyx_brand_id", "brand-1"],
      ["brand_status", "approved"],
      ["campaign_status", "approved"],
      ["onboarding_registration_status", "submitted"],
      ["primary_goal", "signup"],
    ]);
    expect(chains[1].is).toHaveBeenCalledExactlyOnceWith("deleted_at", null);
  });

  it("allows signup to book after filing and leaves goal_url untouched", async () => {
    queueResults(
      { data: lockedState("signup"), error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(200);
    expect(chains[1].update).toHaveBeenCalledExactlyOnceWith({
      primary_goal: "book",
    });
    expect(chains[1].update.mock.calls[0]?.[0]).not.toHaveProperty("goal_url");
  });

  it("allows filed book to be saved as book", async () => {
    queueResults(
      { data: lockedState("book"), error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(200);
    expect(chains[1].update).toHaveBeenCalledWith({ primary_goal: "book" });
  });

  it("lets failed registration unlock a book to signup change", async () => {
    queueResults(
      {
        data: goalState({
          primary_goal: "book",
          telnyx_brand_id: "brand-1",
          brand_status: "failed",
          onboarding_registration_status: "failed",
        }),
        error: null,
      },
      { data: { id: BUSINESS_ID }, error: null }
    );

    const response = await POST(
      makeRequest({
        primary_goal: "signup",
        goal_url: "https://example.com/signup",
      })
    );

    expect(response.status).toBe(200);
    expect(chains[1].update).toHaveBeenCalledWith({
      primary_goal: "signup",
      goal_url: "https://example.com/signup",
    });
  });

  it.each([
    ["book to signup", "book", { primary_goal: "signup", goal_url: "https://example.com/signup" }],
    ["signup URL", "signup", { primary_goal: "signup", goal_url: "https://example.com/updated" }],
    ["signup to book", "signup", { primary_goal: "book" }],
  ] as const)(
    "keeps rejected carrier filing input %s locked even when registration failed",
    async (_label, currentGoal, body) => {
      queueResults({
        data: goalState({
          primary_goal: currentGoal,
          telnyx_brand_id: "brand-1",
          brand_status: "approved",
          campaign_status: "rejected",
          onboarding_registration_status: "failed",
        }),
        error: null,
      });

      const response = await POST(makeRequest(body));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: SETTINGS_REGISTRATION_LOCK_CODE,
        error: GOAL_SIGNUP_LOCK_COPY.message,
      });
      expect(mocks.from).toHaveBeenCalledTimes(1);
    }
  );

  it("does not broaden the rejection lock to a non-filing book re-save", async () => {
    queueResults(
      {
        data: goalState({
          primary_goal: "book",
          telnyx_brand_id: "brand-1",
          brand_status: "rejected",
          onboarding_registration_status: "failed",
        }),
        error: null,
      },
      { data: { id: BUSINESS_ID }, error: null }
    );

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(200);
  });

  it("uses null-safe registration and current-goal compare-and-swap filters", async () => {
    queueResults(
      { data: goalState({ primary_goal: null }), error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(200);
    expect(chains[1].is.mock.calls).toEqual([
      ["deleted_at", null],
      ["telnyx_brand_id", null],
      ["brand_status", null],
      ["campaign_status", null],
      ["primary_goal", null],
    ]);
    expect(chains[1].eq).toHaveBeenCalledWith(
      "onboarding_registration_status",
      "not_started"
    );
  });

  it("rereads a missed compare-and-swap and returns the lock if registration started", async () => {
    queueResults(
      { data: goalState({ primary_goal: "book" }), error: null },
      { data: null, error: null },
      { data: lockedState("book"), error: null }
    );

    const response = await POST(
      makeRequest({
        primary_goal: "signup",
        goal_url: "https://example.com/signup",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: SETTINGS_REGISTRATION_LOCK_CODE,
      error: GOAL_SIGNUP_LOCK_COPY.message,
    });
    expect(mocks.from).toHaveBeenCalledTimes(3);
  });

  it("returns the lock when a CAS loses to a carrier rejection affecting signup filing", async () => {
    queueResults(
      { data: goalState({ primary_goal: "signup" }), error: null },
      { data: null, error: null },
      {
        data: goalState({
          primary_goal: "signup",
          telnyx_brand_id: "brand-1",
          brand_status: "approved",
          campaign_status: "rejected",
          onboarding_registration_status: "failed",
        }),
        error: null,
      }
    );

    const response = await POST(
      makeRequest({
        primary_goal: "signup",
        goal_url: "https://example.com/updated",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: SETTINGS_REGISTRATION_LOCK_CODE,
      error: GOAL_SIGNUP_LOCK_COPY.message,
    });
  });

  it("returns a conflict when a missed compare-and-swap remains unlocked", async () => {
    queueResults(
      { data: goalState({ primary_goal: "book" }), error: null },
      { data: null, error: null },
      { data: goalState({ primary_goal: "quote" }), error: null }
    );

    const response = await POST(makeRequest({ primary_goal: "book" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: SETTINGS_STATE_CHANGED_CODE,
      error: SETTINGS_STATE_CHANGED_MESSAGE,
    });
  });
});
