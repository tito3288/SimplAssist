import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  saveAdminMetricsReportConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));
vi.mock("@/lib/admin/metricsReportConfigs.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/admin/metricsReportConfigs.server")
    >();
  return {
    ...actual,
    saveAdminMetricsReportConfig: mocks.saveAdminMetricsReportConfig,
  };
});

import { AdminMetricsReportConfigError } from "@/lib/admin/metricsReportConfigs.server";
import { POST } from "./route";

const ADMIN_ID = "20000000-0000-4000-a000-000000000001";
const CONFIG_ID = "30000000-0000-4000-a000-000000000001";
const PARTNER_ID = "40000000-0000-4000-a000-00000000000a";
const BUSINESS_ID = "50000000-0000-4000-a000-00000000000a";
const REPORTING_STARTS_ON = "2026-07-01";
const RECIPIENT = "bryan+metrics@example.com";
const DISABLED_RECIPIENT = "kyle@example.com";

const DIRECT_REQUEST = {
  scopeKind: "direct" as const,
  selectionMode: "selected" as const,
  reportingStartsOn: REPORTING_STARTS_ON,
  enabled: true,
  recipients: [
    { email: RECIPIENT, enabled: true },
    { email: DISABLED_RECIPIENT, enabled: false },
  ],
  selectedBusinessIds: [BUSINESS_ID],
};

const SAFE_DIRECT_CONFIG = {
  id: CONFIG_ID,
  scopeKind: "direct" as const,
  partnerId: null,
  selectionMode: "selected" as const,
  reportingStartsOn: REPORTING_STARTS_ON,
  enabled: true,
  recipients: [
    { email: RECIPIENT, enabled: true },
    { email: DISABLED_RECIPIENT, enabled: false },
  ],
  selectedBusinessIds: [BUSINESS_ID],
};

function makeRequest(
  body: unknown = DIRECT_REQUEST,
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
    "https://simplassist.com/api/admin/metrics/report-configs",
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
  mocks.saveAdminMetricsReportConfig.mockResolvedValue(SAFE_DIRECT_CONFIG);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/metrics/report-configs", () => {
  it("authenticates before Host, Origin, content type, or body processing", async () => {
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

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.saveAdminMetricsReportConfig).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    ["noncanonical Host", { host: "app.alphadogagency.ai" }, 404, "Not found"],
    ["missing Origin", { origin: null }, 403, "origin_not_allowed"],
    [
      "cross-site Origin",
      { origin: "https://attacker.example", fetchSite: "cross-site" },
      403,
      "origin_not_allowed",
    ],
    ["missing content type", { contentType: null }, 400, "invalid_request"],
    [
      "non-JSON content type",
      { contentType: "text/plain" },
      400,
      "invalid_request",
    ],
  ] as const)(
    "rejects %s before consuming malformed JSON",
    async (_label, options, status, error) => {
      const request = makeRequest(undefined, { ...options, rawBody: "{" });

      const response = await POST(request);

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(request.bodyUsed).toBe(false);
      expect(mocks.saveAdminMetricsReportConfig).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("rejects malformed JSON before the save adapter", async () => {
    const response = await POST(makeRequest(undefined, { rawBody: "{" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.saveAdminMetricsReportConfig).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("accepts JSON with parameters and absent fetch metadata", async () => {
    const response = await POST(
      makeRequest(DIRECT_REQUEST, {
        contentType: "Application/JSON; charset=utf-8",
        fetchSite: null,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.saveAdminMetricsReportConfig).toHaveBeenCalledWith(
      DIRECT_REQUEST,
    );
    expectPrivateNoStore(response);
  });

  it.each([
    null,
    [],
    {},
    { ...DIRECT_REQUEST, scopeKind: "global" },
    { ...DIRECT_REQUEST, partnerId: null },
    {
      ...DIRECT_REQUEST,
      scopeKind: "partner",
    },
    {
      ...DIRECT_REQUEST,
      scopeKind: "partner",
      partnerId: "not-a-uuid",
    },
    { ...DIRECT_REQUEST, reportingStartsOn: "2026-07-02" },
    { ...DIRECT_REQUEST, reportingStartsOn: "2026-7-01" },
    { ...DIRECT_REQUEST, selectionMode: "all" },
    { ...DIRECT_REQUEST, selectedBusinessIds: [] },
    {
      ...DIRECT_REQUEST,
      recipients: [{ email: "not-an-email", enabled: true }],
    },
    {
      ...DIRECT_REQUEST,
      recipients: [{ email: RECIPIENT, enabled: false }],
    },
    {
      ...DIRECT_REQUEST,
      recipients: [{ email: RECIPIENT, enabled: true, name: "Bryan" }],
    },
    {
      ...DIRECT_REQUEST,
      recipients: [
        { email: RECIPIENT, enabled: true },
        { email: RECIPIENT.toUpperCase(), enabled: false },
      ],
    },
    {
      ...DIRECT_REQUEST,
      selectedBusinessIds: [BUSINESS_ID, BUSINESS_ID.toUpperCase()],
    },
    { ...DIRECT_REQUEST, actorAdminUserId: ADMIN_ID },
  ])(
    "rejects a malformed, contradictory, or non-strict body: %j",
    async (body) => {
      const response = await POST(makeRequest(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(mocks.saveAdminMetricsReportConfig).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("normalizes recipient email and UUID case before saving a direct config", async () => {
    const response = await POST(
      makeRequest({
        ...DIRECT_REQUEST,
        recipients: [
          { email: `  ${RECIPIENT.toUpperCase()}  `, enabled: true },
          { email: DISABLED_RECIPIENT.toUpperCase(), enabled: false },
        ],
        selectedBusinessIds: [BUSINESS_ID.toUpperCase()],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.saveAdminMetricsReportConfig).toHaveBeenCalledWith(
      DIRECT_REQUEST,
    );
    expect(await response.json()).toEqual(SAFE_DIRECT_CONFIG);
    expectPrivateNoStore(response);
  });

  it("accepts the exact partner branch and canonicalizes its partner ID", async () => {
    const partnerRequest = {
      scopeKind: "partner" as const,
      partnerId: PARTNER_ID.toUpperCase(),
      selectionMode: "all" as const,
      reportingStartsOn: REPORTING_STARTS_ON,
      enabled: false,
      recipients: [],
      selectedBusinessIds: [],
    };
    const partnerConfig = {
      ...partnerRequest,
      id: CONFIG_ID,
      partnerId: PARTNER_ID,
    };
    mocks.saveAdminMetricsReportConfig.mockResolvedValue(partnerConfig);

    const response = await POST(makeRequest(partnerRequest));

    expect(response.status).toBe(200);
    expect(mocks.saveAdminMetricsReportConfig).toHaveBeenCalledWith({
      ...partnerRequest,
      partnerId: PARTNER_ID,
    });
    expect(await response.json()).toEqual(partnerConfig);
    expectPrivateNoStore(response);
  });

  it("returns only a strictly parsed safe config DTO", async () => {
    mocks.saveAdminMetricsReportConfig.mockResolvedValue({
      ...SAFE_DIRECT_CONFIG,
      raw_database_error: "secret database detail",
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(makeRequest());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "save_failed" });
    expect(text).not.toContain("secret database detail");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "secret database detail",
    );
    expectPrivateNoStore(response);
  });

  it.each([
    ["invalid_request", 400],
    ["partner_not_found", 404],
    ["business_out_of_scope", 409],
    ["invalid_selection", 422],
    ["enabled_recipient_required", 422],
    ["save_failed", 500],
  ] as const)("returns the stable typed %s failure", async (code, status) => {
    mocks.saveAdminMetricsReportConfig.mockRejectedValue(
      new AdminMetricsReportConfigError(code, status),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(makeRequest());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
    expect(log).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("redacts recipient and raw database details from unexpected failures", async () => {
    const secret = `${RECIPIENT} constraint detail provider-secret`;
    mocks.saveAdminMetricsReportConfig.mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(makeRequest());
    const text = await response.text();
    const logs = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "save_failed" });
    expect(text).not.toContain(RECIPIENT);
    expect(text).not.toContain(secret);
    expect(logs).not.toContain(RECIPIENT);
    expect(logs).not.toContain(secret);
    expect(logs).toContain("[admin:metrics-report-configs] save failed");
    expectPrivateNoStore(response);
  });
});
