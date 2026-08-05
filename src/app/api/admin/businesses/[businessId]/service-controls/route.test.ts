import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  setAdminAccountServiceControl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));
vi.mock("@/lib/admin/accountServiceControls.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/admin/accountServiceControls.server")
    >();
  return {
    ...actual,
    setAdminAccountServiceControl: mocks.setAdminAccountServiceControl,
  };
});

import { AdminAccountServiceControlsError } from "@/lib/admin/accountServiceControls.server";
import { POST } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const ADMIN_ID = "20000000-0000-4000-a000-000000000001";
const EVENT_ID = "30000000-0000-4000-a000-000000000001";
const REASON = "Account review requires a temporary hold";
const SAFE_RESPONSE = {
  changed: true,
  adminEventId: EVENT_ID,
  controls: {
    businessId: BUSINESS_ID,
    operationsSuspendedAt: "2026-08-04T12:00:00.000Z",
    aiRepliesPausedAt: null,
    textingPausedAt: "2026-08-04T12:01:00.000Z",
    bookingsPausedAt: null,
  },
};

function makeRequest(
  body: unknown = { action: "suspend", reason: REASON },
  options: {
    host?: string | null;
    origin?: string | null;
    fetchSite?: string | null;
    contentType?: string | null;
    forwardedHost?: string | null;
    forwarded?: string | null;
    rawBody?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  if (options.host !== null) {
    headers.set("host", options.host ?? "simplassist.com");
  }
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://simplassist.com");
  }
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin");
  }
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.forwardedHost !== null) {
    headers.set(
      "x-forwarded-host",
      options.forwardedHost ?? "app.alphadogagency.ai",
    );
  }
  if (options.forwarded !== null) {
    headers.set("forwarded", options.forwarded ?? "host=app.alphadogagency.ai");
  }

  return new NextRequest(
    `https://simplassist.com/api/admin/businesses/${BUSINESS_ID}/service-controls`,
    {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    },
  );
}

function makeInspectableRequest({
  headers = new Headers(),
  json = vi.fn(),
}: {
  headers?: Headers;
  json?: ReturnType<typeof vi.fn>;
} = {}) {
  return { headers, json } as unknown as NextRequest;
}

function routeParams(businessId = BUSINESS_ID) {
  return { params: { businessId } };
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("vary")).toBe("Cookie, Origin");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.setAdminAccountServiceControl.mockResolvedValue(SAFE_RESPONSE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/businesses/[businessId]/service-controls", () => {
  it("authenticates before Host, Origin, content type, params, or body processing", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const json = vi.fn().mockRejectedValue(new Error("must not parse"));
    const request = makeInspectableRequest({
      headers: new Headers({
        host: "app.alphadogagency.ai",
        origin: "https://attacker.example",
        "content-type": "text/plain",
        "sec-fetch-site": "cross-site",
      }),
      json,
    });

    const response = await POST(request, routeParams("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    ["partner Host", "app.alphadogagency.ai"],
    ["suffix lookalike", "simplassist.com.evil.example"],
    ["malformed Host", "https://simplassist.com/path"],
    ["missing Host", null],
  ])(
    "rejects a valid mocked admin on a noncanonical %s before body processing",
    async (_label, host) => {
      const incoming = makeRequest(undefined, {
        host,
        forwardedHost: "simplassist.com",
        forwarded: "host=simplassist.com",
        rawBody: "{",
      });

      const response = await POST(incoming, routeParams("not-a-uuid"));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(incoming.bodyUsed).toBe(false);
      expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("uses normalized Host only and ignores forwarded partner-host spoofing", async () => {
    const response = await POST(
      makeRequest(undefined, {
        host: "SIMPLASSIST.COM.:443",
        forwardedHost: "app.alphadogagency.ai",
        forwarded: "host=app.alphadogagency.ai",
      }),
      routeParams(),
    );

    expect(response.status).toBe(200);
    expect(mocks.setAdminAccountServiceControl).toHaveBeenCalledOnce();
    expectPrivateNoStore(response);
  });

  it("canonicalizes a valid uppercase path UUID before the adapter call", async () => {
    const response = await POST(
      makeRequest(),
      routeParams(BUSINESS_ID.toUpperCase()),
    );

    expect(response.status).toBe(200);
    expect(mocks.setAdminAccountServiceControl).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID }),
    );
    expectPrivateNoStore(response);
  });

  it.each([
    ["missing Origin", null, "same-origin"],
    ["cross origin", "https://attacker.example", "cross-site"],
    [
      "suffix-lookalike Origin",
      "https://simplassist.com.evil.example",
      "same-origin",
    ],
    ["Origin with credentials", "https://user@simplassist.com", "same-origin"],
    ["Origin with path", "https://simplassist.com/path", "same-origin"],
    ["cross-site metadata", "https://simplassist.com", "cross-site"],
    ["same-site metadata", "https://simplassist.com", "same-site"],
  ])("rejects %s before params or JSON", async (_label, origin, fetchSite) => {
    const incoming = makeRequest(undefined, {
      origin,
      fetchSite,
      rawBody: "{",
    });

    const response = await POST(incoming, routeParams("not-a-uuid"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
    expect(incoming.bodyUsed).toBe(false);
    expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([null, "text/plain", "application/json-evil", "text/json"])(
    "requires the exact JSON media type before params or JSON: %s",
    async (contentType) => {
      const incoming = makeRequest(undefined, {
        contentType,
        rawBody: "{",
      });

      const response = await POST(incoming, routeParams("not-a-uuid"));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(incoming.bodyUsed).toBe(false);
      expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it.each(["application/json", "Application/JSON; charset=utf-8"])(
    "accepts %s with absent Sec-Fetch-Site",
    async (contentType) => {
      const response = await POST(
        makeRequest(undefined, { contentType, fetchSite: null }),
        routeParams(),
      );

      expect(response.status).toBe(200);
      expect(mocks.setAdminAccountServiceControl).toHaveBeenCalledOnce();
      expectPrivateNoStore(response);
    },
  );

  it("returns a hidden 404 for an invalid UUID before consuming malformed JSON", async () => {
    const incoming = makeRequest(undefined, { rawBody: "{" });

    const response = await POST(incoming, routeParams("../../admin"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(incoming.bodyUsed).toBe(false);
    expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(
      makeRequest(undefined, { rawBody: "{" }),
      routeParams(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    null,
    [],
    {},
    { action: "suspend" },
    { action: "suspend", reason: "short" },
    { action: "pause" },
    { action: "pause", service: "email" },
    { action: "resume", service: "texting", reason: "" },
    { action: "delete", reason: REASON },
    { action: "suspend", reason: REASON, actorAdminUserId: ADMIN_ID },
    { action: "suspend", reason: REASON, actor: ADMIN_ID },
    { action: "suspend", reason: REASON, p_actor_admin_user_id: ADMIN_ID },
    { action: "suspend", reason: REASON, summary: { reason: REASON } },
  ])("rejects malformed, extra, or actor-controlled input: %j", async (body) => {
    const response = await POST(makeRequest(body), routeParams());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.setAdminAccountServiceControl).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    [{ action: "suspend", reason: ` ${REASON} ` }, { action: "suspend", reason: REASON }],
    [
      { action: "reactivate", reason: ` ${REASON} ` },
      { action: "reactivate", reason: REASON },
    ],
    [
      { action: "pause", service: "ai_replies" },
      { action: "pause", service: "ai_replies" },
    ],
    [
      { action: "pause", service: "texting", reason: ` ${REASON} ` },
      { action: "pause", service: "texting", reason: REASON },
    ],
    [
      { action: "pause", service: "bookings" },
      { action: "pause", service: "bookings" },
    ],
    [
      { action: "resume", service: "ai_replies", reason: REASON },
      { action: "resume", service: "ai_replies", reason: REASON },
    ],
    [
      { action: "resume", service: "texting" },
      { action: "resume", service: "texting" },
    ],
    [
      { action: "resume", service: "bookings", reason: REASON },
      { action: "resume", service: "bookings", reason: REASON },
    ],
  ] as const)(
    "passes only the validated %j action and authenticated actor",
    async (body, expectedInput) => {
      const response = await POST(makeRequest(body), routeParams());

      expect(response.status).toBe(200);
      expect(mocks.setAdminAccountServiceControl).toHaveBeenCalledWith({
        businessId: BUSINESS_ID,
        actorAdminUserId: ADMIN_ID,
        input: expectedInput,
      });
      expectPrivateNoStore(response);
    },
  );

  it("returns only the safe response contract and never echoes a reason", async () => {
    const response = await POST(
      makeRequest({ action: "suspend", reason: REASON }),
      routeParams(),
    );
    const text = await response.text();

    expect(JSON.parse(text)).toEqual(SAFE_RESPONSE);
    expect(text).not.toContain(REASON);
    expect(text).not.toContain("operations_suspended_at");
    expect(text).not.toContain("admin_event_id");
    expectPrivateNoStore(response);
  });

  it("returns an idempotent no-op as a successful complete snapshot", async () => {
    const noOp = { ...SAFE_RESPONSE, changed: false, adminEventId: null };
    mocks.setAdminAccountServiceControl.mockResolvedValue(noOp);

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(noOp);
    expectPrivateNoStore(response);
  });

  it("maps a missing target to the same hidden 404 as an invalid path", async () => {
    mocks.setAdminAccountServiceControl.mockRejectedValue(
      new AdminAccountServiceControlsError("business_not_found", 404),
    );

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expectPrivateNoStore(response);
  });

  it("returns the stable deletion-lifecycle conflict", async () => {
    mocks.setAdminAccountServiceControl.mockRejectedValue(
      new AdminAccountServiceControlsError(
        "account_deletion_in_progress",
        409,
      ),
    );

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "account_deletion_in_progress",
    });
    expectPrivateNoStore(response);
  });

  it("returns a non-diagnostic typed database failure", async () => {
    mocks.setAdminAccountServiceControl.mockRejectedValue(
      new AdminAccountServiceControlsError("service_controls_failed", 500),
    );

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "service_controls_failed" });
    expectPrivateNoStore(response);
  });

  it("redacts unexpected error, reason, and provider details from logs", async () => {
    const secret = `${REASON} client@example.test +15555550123 provider-secret`;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.setAdminAccountServiceControl.mockRejectedValue(new Error(secret));

    const response = await POST(makeRequest(), routeParams());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "service_controls_failed" });
    expect(text).not.toContain(secret);
    expect(text).not.toContain(REASON);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(REASON);
    expectPrivateNoStore(response);
  });
});
