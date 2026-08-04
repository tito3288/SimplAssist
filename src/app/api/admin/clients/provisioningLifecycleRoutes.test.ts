import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { POST as dismissJob } from "./[provisioningId]/dismiss/route";
import { POST as restoreJob } from "./[provisioningId]/restore/route";

const JOB_ID = "10000000-0000-4000-a000-000000000001";
const OTHER_JOB_ID = "10000000-0000-4000-a000-000000000002";
const ADMIN_ID = "50000000-0000-4000-a000-000000000001";
const PII_SENTINEL = "client-secret@example.test";
const TOKEN_SENTINEL = "token_hash=do-not-serialize";
const PROVIDER_SENTINEL = "provider-secret-detail";

type Action = "dismiss" | "restore";

const actions = {
  dismiss: {
    route: dismissJob,
    rpc: "dismiss_partner_client_provisioning_job",
    status: "dismissed",
  },
  restore: {
    route: restoreJob,
    rpc: "restore_partner_client_provisioning_job",
    status: "needs_attention",
  },
} as const;

function request(
  action: Action,
  body: unknown = {},
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
    `https://simplassist.com/api/admin/clients/${JOB_ID}/${action}`,
    {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    },
  );
}

async function run(
  action: Action,
  options: {
    id?: string;
    body?: unknown;
    request?: Parameters<typeof request>[2];
  } = {},
) {
  const incoming = request(
    action,
    options.body === undefined ? {} : options.body,
    options.request ?? {},
  );
  const response = await actions[action].route(incoming, {
    params: { provisioningId: options.id ?? JOB_ID },
  });
  return { incoming, response };
}

function successfulRow(action: Action) {
  return {
    id: JOB_ID,
    status: actions[action].status,
    email: PII_SENTINEL,
    operation_token: TOKEN_SENTINEL,
    last_error_code: PROVIDER_SENTINEL,
    auth_user_id: "30000000-0000-4000-a000-000000000001",
    business_id: "40000000-0000-4000-a000-000000000001",
  };
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
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
  mocks.rpc.mockImplementation(async (name: string) => {
    const action = name.startsWith("dismiss_") ? "dismiss" : "restore";
    return { data: successfulRow(action), error: null };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(["dismiss", "restore"] as const)(
  "admin provisioning %s route",
  (action) => {
    it("authorizes before Host, Origin, UUID, content type, or body disclosure", async () => {
      mocks.getAdminUser.mockResolvedValue(null);
      const incoming = request(
        action,
        {},
        {
          host: "app.alphadogagency.ai",
          origin: "https://attacker.example",
          fetchSite: "cross-site",
          contentType: "text/plain",
          rawBody: "not-json",
        },
      );

      const response = await actions[action].route(incoming, {
        params: { provisioningId: "not-a-uuid" },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(incoming.bodyUsed).toBe(false);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    });

    it.each([
      ["partner Host", "app.alphadogagency.ai"],
      ["suffix lookalike", "simplassist.com.attacker.example"],
      ["unknown Host", "unknown.example"],
      ["malformed Host", "bad_host.example"],
      ["missing Host", null],
    ])(
      "rejects %s even when forwarded headers name canonical",
      async (_, host) => {
        const { incoming, response } = await run(action, {
          request: {
            host,
            forwardedHost: "simplassist.com",
            forwarded: "host=simplassist.com",
          },
        });

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Not found" });
        expect(incoming.bodyUsed).toBe(false);
        expect(mocks.rpc).not.toHaveBeenCalled();
        expectPrivateNoStore(response);
      },
    );

    it("uses normalized Host only and ignores partner-valued forwarded headers", async () => {
      const { response } = await run(action, {
        request: {
          host: "SIMPLASSIST.COM.:443",
          forwardedHost: "app.alphadogagency.ai",
          forwarded: "host=app.alphadogagency.ai",
        },
      });

      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expectPrivateNoStore(response);
    });

    it.each([
      ["missing Origin", null, "same-origin"],
      ["cross Origin", "https://attacker.example", "cross-site"],
      [
        "suffix Origin",
        "https://simplassist.com.attacker.example",
        "same-origin",
      ],
      ["credentialed Origin", "https://user@simplassist.com", "same-origin"],
      ["path Origin", "https://simplassist.com/path", "same-origin"],
      ["query Origin", "https://simplassist.com/?next=evil", "same-origin"],
      ["cross-site fetch", "https://simplassist.com", "cross-site"],
      ["same-site fetch", "https://simplassist.com", "same-site"],
    ])(
      "rejects %s before UUID or JSON processing",
      async (_, origin, fetchSite) => {
        const incoming = request(
          action,
          {},
          {
            origin,
            fetchSite,
            rawBody: "not-json",
          },
        );
        const response = await actions[action].route(incoming, {
          params: { provisioningId: "not-a-uuid" },
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "origin_not_allowed" });
        expect(incoming.bodyUsed).toBe(false);
        expect(mocks.rpc).not.toHaveBeenCalled();
        expectPrivateNoStore(response);
      },
    );

    it.each([null, "text/plain", "application/json-evil"])(
      "rejects content type %s before UUID or JSON processing",
      async (contentType) => {
        const incoming = request(
          action,
          {},
          {
            contentType,
            rawBody: "not-json",
          },
        );
        const response = await actions[action].route(incoming, {
          params: { provisioningId: "not-a-uuid" },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_request" });
        expect(incoming.bodyUsed).toBe(false);
        expect(mocks.rpc).not.toHaveBeenCalled();
        expectPrivateNoStore(response);
      },
    );

    it("accepts JSON with a charset and an absent Sec-Fetch-Site", async () => {
      const { response } = await run(action, {
        request: {
          contentType: "application/json; charset=utf-8",
          fetchSite: null,
        },
      });

      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expectPrivateNoStore(response);
    });

    it("returns job_not_found for an invalid UUID before consuming malformed JSON", async () => {
      const incoming = request(action, {}, { rawBody: "{" });
      const response = await actions[action].route(incoming, {
        params: { provisioningId: "../../admin" },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "job_not_found" });
      expect(incoming.bodyUsed).toBe(false);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    });

    it.each([
      ["malformed JSON", undefined, "{"],
      ["null", null, undefined],
      ["an array", [], undefined],
      ["a scalar", "value", undefined],
      ["an extra key", { adminId: ADMIN_ID }, undefined],
      ["a client timestamp", { p_now: "2099-01-01T00:00:00Z" }, undefined],
      ["an operation token", { operationToken: TOKEN_SENTINEL }, undefined],
      ["an audit summary", { summary: { email: PII_SENTINEL } }, undefined],
    ])(
      "rejects %s instead of forwarding client state",
      async (_, body, rawBody) => {
        const { response } = await run(action, {
          body,
          request: rawBody === undefined ? undefined : { rawBody },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_request" });
        expect(mocks.rpc).not.toHaveBeenCalled();
        expectPrivateNoStore(response);
      },
    );

    it("passes only the validated job and authenticated admin IDs to the RPC", async () => {
      const { response } = await run(action);

      expect(mocks.rpc).toHaveBeenCalledWith(actions[action].rpc, {
        p_job_id: JOB_ID,
        p_admin_user_id: ADMIN_ID,
      });
      expect(await response.json()).toEqual({
        provisioningId: JOB_ID,
        status: actions[action].status,
      });
      expectPrivateNoStore(response);
    });

    it("returns the same minimal success safely on a network retry", async () => {
      const first = await run(action);
      const second = await run(action);

      await expect(first.response.json()).resolves.toEqual({
        provisioningId: JOB_ID,
        status: actions[action].status,
      });
      await expect(second.response.json()).resolves.toEqual({
        provisioningId: JOB_ID,
        status: actions[action].status,
      });
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expectPrivateNoStore(first.response);
      expectPrivateNoStore(second.response);
    });

    it("projects a composite RPC row to the exact public key whitelist", async () => {
      const { response } = await run(action);
      const text = await response.text();

      expect(JSON.parse(text)).toEqual({
        provisioningId: JOB_ID,
        status: actions[action].status,
      });
      expect(text).not.toContain(PII_SENTINEL);
      expect(text).not.toContain(TOKEN_SENTINEL);
      expect(text).not.toContain(PROVIDER_SENTINEL);
      expect(text).not.toContain("auth_user_id");
      expect(text).not.toContain("business_id");
      expectPrivateNoStore(response);
    });
  },
);

const stableErrors = [
  ["job_not_found", "P0002", "provisioning_job_not_found", 404],
  ["provisioning_in_progress", "55000", "provisioning_in_progress", 409],
  [
    "provisioning_outcome_unknown",
    "55000",
    "provisioning_outcome_unknown",
    409,
  ],
  ["provisioning_has_resources", "55000", "provisioning_has_resources", 409],
  ["job_not_dismissible", "55000", "job_not_dismissible", 409],
] as const;

describe.each(["dismiss", "restore"] as const)(
  "admin provisioning %s route failures",
  (action) => {
    it.each(stableErrors)(
      "maps %s without exposing database details",
      async (publicCode, sqlState, databaseToken, status) => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.rpc.mockResolvedValue({
          data: null,
          error: {
            code: sqlState,
            message: databaseToken,
            details: `${PII_SENTINEL} ${TOKEN_SENTINEL}`,
            hint: PROVIDER_SENTINEL,
          },
        });

        const { response } = await run(action);
        const text = await response.text();

        expect(response.status).toBe(status);
        expect(JSON.parse(text)).toEqual({ error: publicCode });
        expect(text).not.toContain(PII_SENTINEL);
        expect(text).not.toContain(TOKEN_SENTINEL);
        expect(text).not.toContain(PROVIDER_SENTINEL);
        expect(JSON.stringify(log.mock.calls)).not.toContain(PII_SENTINEL);
        expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_SENTINEL);
        expect(JSON.stringify(log.mock.calls)).not.toContain(PROVIDER_SENTINEL);
        expectPrivateNoStore(response);
      },
    );

    it("requires the expected SQLSTATE before trusting a stable error token", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          code: "XX000",
          message: `provisioning_has_resources ${PII_SENTINEL}`,
          details: TOKEN_SENTINEL,
          hint: PROVIDER_SENTINEL,
        },
      });

      const { response } = await run(action);
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ error: "provisioning_action_failed" });
      expect(text).not.toContain(PII_SENTINEL);
      expect(text).not.toContain(TOKEN_SENTINEL);
      expect(text).not.toContain(PROVIDER_SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(PII_SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(PROVIDER_SENTINEL);
      expectPrivateNoStore(response);
    });

    it.each([
      ["a malformed response", { data: successfulRow(action), error: null }],
      [
        "multiple response rows",
        { data: [successfulRow(action), successfulRow(action)], error: null },
      ],
    ])(
      "fails closed for %s without logging returned PII or tokens",
      async (kind, result) => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const badResult =
          kind === "a malformed response"
            ? {
                ...result,
                data: { ...successfulRow(action), id: OTHER_JOB_ID },
              }
            : result;
        mocks.rpc.mockResolvedValue(badResult);

        const { response } = await run(action);
        const text = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(text)).toEqual({
          error: "provisioning_action_failed",
        });
        expect(text).not.toContain(PII_SENTINEL);
        expect(text).not.toContain(TOKEN_SENTINEL);
        expect(text).not.toContain(PROVIDER_SENTINEL);
        expect(JSON.stringify(log.mock.calls)).not.toContain(PII_SENTINEL);
        expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_SENTINEL);
        expect(JSON.stringify(log.mock.calls)).not.toContain(PROVIDER_SENTINEL);
        expectPrivateNoStore(response);
      },
    );

    it("redacts unexpected thrown provider and token details", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error(
        `${PII_SENTINEL} ${TOKEN_SENTINEL} ${PROVIDER_SENTINEL}`,
      );
      Object.assign(error, { recoveryUrl: TOKEN_SENTINEL });
      mocks.rpc.mockRejectedValue(error);

      const { response } = await run(action);
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({ error: "provisioning_action_failed" });
      expect(text).not.toContain(PII_SENTINEL);
      expect(text).not.toContain(TOKEN_SENTINEL);
      expect(text).not.toContain(PROVIDER_SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(PII_SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(PROVIDER_SENTINEL);
      expectPrivateNoStore(response);
    });
  },
);
