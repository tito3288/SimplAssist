import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  rpc: vi.fn(),
  ensureCampaignAssignmentForBusiness: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("@/lib/messaging/registration/phoneNumberAssignment", () => ({
  ensureCampaignAssignmentForBusiness:
    mocks.ensureCampaignAssignmentForBusiness,
}));

import { POST } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OTHER_BUSINESS_ID = "10000000-0000-4000-a000-000000000002";
const ADMIN_ID = "20000000-0000-4000-a000-000000000001";
const EVENT_ID = "30000000-0000-4000-a000-000000000001";
const REQUESTED_AT = "2026-08-05T12:34:56.123Z";
const SAFE_AUDIT_RESULT = {
  business_id: BUSINESS_ID,
  admin_event_id: EVENT_ID,
  requested_at: REQUESTED_AT,
};

function makeRequest(
  body: unknown = {},
  options: {
    host?: string | null;
    origin?: string | null;
    fetchSite?: string | null;
    contentType?: string | null;
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

  return new NextRequest(
    `https://simplassist.com/api/admin/businesses/${BUSINESS_ID}/assignment-recheck`,
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
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.rpc.mockResolvedValue({ data: SAFE_AUDIT_RESULT, error: null });
  mocks.ensureCampaignAssignmentForBusiness.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/businesses/[businessId]/assignment-recheck", () => {
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
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    [
      "noncanonical Host",
      { host: "app.alphadogagency.ai", rawBody: "{" },
      404,
      { error: "Not found" },
    ],
    [
      "cross-site Origin",
      {
        origin: "https://attacker.example",
        fetchSite: "cross-site",
        rawBody: "{",
      },
      403,
      { error: "origin_not_allowed" },
    ],
    [
      "non-JSON content type",
      { contentType: "text/plain", rawBody: "{" },
      400,
      { error: "invalid_request" },
    ],
  ] as const)(
    "enforces the admin mutation boundary for %s before params or body",
    async (_label, options, status, expectedBody) => {
      const request = makeRequest(undefined, options);

      const response = await POST(request, routeParams("not-a-uuid"));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(expectedBody);
      expect(request.bodyUsed).toBe(false);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("returns a hidden 404 for an invalid UUID before consuming malformed JSON", async () => {
    const request = makeRequest(undefined, { rawBody: "{" });

    const response = await POST(request, routeParams("../../admin"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(request.bodyUsed).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("rejects malformed JSON after validating the authenticated path", async () => {
    const response = await POST(
      makeRequest(undefined, { rawBody: "{" }),
      routeParams(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    null,
    [],
    "{}",
    { requested: true },
    { reason: "Retry the assignment" },
    { businessId: BUSINESS_ID },
    { actorAdminUserId: ADMIN_ID },
    { p_actor_admin_user_id: ADMIN_ID },
    { summary: { provider_id: "provider-secret" } },
  ])("requires the exact empty JSON object: %j", async (body) => {
    const response = await POST(makeRequest(body), routeParams());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("records the authenticated audit request before invoking the helper with exact arguments", async () => {
    const order: string[] = [];
    mocks.rpc.mockImplementation(async () => {
      order.push("rpc");
      return { data: SAFE_AUDIT_RESULT, error: null };
    });
    mocks.ensureCampaignAssignmentForBusiness.mockImplementation(async () => {
      order.push("helper");
    });

    const response = await POST(
      makeRequest({}),
      routeParams(BUSINESS_ID.toUpperCase()),
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["rpc", "helper"]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_admin_phone_assignment_recheck",
      {
        p_business_id: BUSINESS_ID,
        p_actor_admin_user_id: ADMIN_ID,
      },
    );
    expect(mocks.ensureCampaignAssignmentForBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      { force: true, reason: "admin_recheck" },
    );
    expectPrivateNoStore(response);
  });

  it.each([
    null,
    {},
    {
      business_id: OTHER_BUSINESS_ID,
      admin_event_id: EVENT_ID,
      requested_at: REQUESTED_AT,
    },
    {
      business_id: BUSINESS_ID,
      admin_event_id: "not-a-uuid",
      requested_at: REQUESTED_AT,
    },
    {
      business_id: BUSINESS_ID,
      admin_event_id: EVENT_ID,
      requested_at: "2026-08-05T12:34:56",
    },
    {
      ...SAFE_AUDIT_RESULT,
      telnyx_task_id: "task-secret",
    },
  ])("rejects a non-exact RPC audit result before helper work: %j", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const response = await POST(makeRequest({}), routeParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "assignment_recheck_failed",
    });
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "task-secret",
    );
    expectPrivateNoStore(response);
  });

  it("maps a missing business to the same non-disclosing 404", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0002",
        message: "business_not_found",
        details: "client@example.test +15555550123",
      },
    });

    const response = await POST(makeRequest({}), routeParams());
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: "Not found" });
    expect(text).not.toContain("client@example.test");
    expect(text).not.toContain("+15555550123");
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    ["account_operations_suspended", "account_operations_suspended"],
    [
      "phone_assignment_recheck_in_progress",
      "phone_assignment_recheck_in_progress",
    ],
    ["account_deletion_in_progress", "phone_assignment_recheck_unavailable"],
    [
      "phone_assignment_recheck_unavailable",
      "phone_assignment_recheck_unavailable",
    ],
    [
      "phone_assignment_recheck_not_needed",
      "phone_assignment_recheck_unavailable",
    ],
  ])(
    "maps the safe conflict %s to %s without helper work",
    async (rpcCode, publicCode) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          code: "55000",
          message: rpcCode,
          details: "telnyx-id-secret client@example.test +15555550123",
        },
      });

      const response = await POST(makeRequest({}), routeParams());
      const text = await response.text();

      expect(response.status).toBe(409);
      expect(JSON.parse(text)).toEqual({ error: publicCode });
      expect(text).not.toContain("telnyx-id-secret");
      expect(text).not.toContain("client@example.test");
      expect(text).not.toContain("+15555550123");
      expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it.each([
    {
      code: "XX000",
      message: "account_operations_suspended",
      details: "wrong-sqlstate-secret",
    },
    {
      code: "55000",
      message: "not_phone_assignment_recheck_in_progress_extra",
      details: "lookalike-secret",
    },
  ])("does not promote an untrusted RPC error to a safe conflict: %j", async (error) => {
    mocks.rpc.mockResolvedValue({ data: null, error });

    const response = await POST(makeRequest({}), routeParams());
    const text = await response.text();
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "assignment_recheck_failed" });
    expect(text).not.toContain(error.details);
    expect(logs).not.toContain(error.details);
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("redacts a thrown RPC failure and never invokes the helper", async () => {
    const secret =
      "client@example.test +15555550123 telnyx_task_id=provider-secret";
    mocks.rpc.mockRejectedValue(new Error(secret));

    const response = await POST(makeRequest({}), routeParams());
    const text = await response.text();
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "assignment_recheck_failed" });
    expect(text).not.toContain(secret);
    expect(logs).not.toContain(secret);
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("returns a generic failure if the post-audit helper throws", async () => {
    const order: string[] = [];
    const secret =
      "Telnyx task provider-secret failed for client@example.test +15555550123";
    mocks.rpc.mockImplementation(async () => {
      order.push("rpc");
      return { data: SAFE_AUDIT_RESULT, error: null };
    });
    mocks.ensureCampaignAssignmentForBusiness.mockImplementation(async () => {
      order.push("helper");
      throw new Error(secret);
    });

    const response = await POST(makeRequest({}), routeParams());
    const text = await response.text();
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);

    expect(order).toEqual(["rpc", "helper"]);
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "assignment_recheck_failed" });
    expect(text).not.toContain(secret);
    expect(logs).not.toContain(secret);
    expectPrivateNoStore(response);
  });

  it("returns only the exact acceptance response after audit and helper success", async () => {
    const response = await POST(makeRequest({}), routeParams());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe('{"requested":true}');
    expect(text).not.toContain(BUSINESS_ID);
    expect(text).not.toContain(EVENT_ID);
    expect(text).not.toContain(REQUESTED_AT);
    expect(text).not.toContain("telnyx");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.ensureCampaignAssignmentForBusiness).toHaveBeenCalledOnce();
    expectPrivateNoStore(response);
  });
});
