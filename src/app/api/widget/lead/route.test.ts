import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class WidgetOfflineLeadConflictError extends Error {}

  return {
    WidgetOfflineLeadConflictError,
    resolvePublicWidgetAccess: vi.fn(),
    recordWidgetOfflineLead: vi.fn(),
    readWidgetBearerToken: vi.fn(),
    verifyWidgetToken: vi.fn(),
    resolveBusinessEntitlements: vi.fn(),
    canUseFeature: vi.fn(),
    resolveBusinessOperationalControls: vi.fn(),
    resolveOperationalBlockReason: vi.fn(),
    acquireWidgetIngressTraffic: vi.fn(),
    acquireWidgetTraffic: vi.fn(),
    deriveWidgetNetworkKey: vi.fn(),
    deriveWidgetRequestKey: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/widget/access.server", () => ({
  resolvePublicWidgetAccess: mocks.resolvePublicWidgetAccess,
}));
vi.mock("@/lib/widget/offlineLead.server", () => ({
  WidgetOfflineLeadConflictError: mocks.WidgetOfflineLeadConflictError,
  recordWidgetOfflineLead: mocks.recordWidgetOfflineLead,
}));
vi.mock("@/lib/widget/token.server", () => ({
  readWidgetBearerToken: mocks.readWidgetBearerToken,
  verifyWidgetToken: mocks.verifyWidgetToken,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("@/lib/account/operationalControls.server", () => ({
  resolveBusinessOperationalControls: mocks.resolveBusinessOperationalControls,
  resolveOperationalBlockReason: mocks.resolveOperationalBlockReason,
}));
vi.mock("@/lib/widget/ingressTraffic.server", () => ({
  acquireWidgetIngressTraffic: mocks.acquireWidgetIngressTraffic,
}));
vi.mock("@/lib/widget/traffic.server", () => ({
  acquireWidgetTraffic: mocks.acquireWidgetTraffic,
  deriveWidgetNetworkKey: mocks.deriveWidgetNetworkKey,
  deriveWidgetRequestKey: mocks.deriveWidgetRequestKey,
}));

import { OPTIONS, POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_BUSINESS_ID = "00000000-0000-4000-8000-000000000099";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const CLIENT_LEAD_ID = "00000000-0000-4000-8000-000000000003";
const SOURCE_CLIENT_MESSAGE_ID = "00000000-0000-4000-8000-000000000004";
const SESSION_NONCE = "abcdefghijklmnopqrstuvwx";
const ORIGIN = "https://allowed.example";

const VALID_BODY = {
  businessId: BUSINESS_ID,
  sessionId: SESSION_ID,
  sessionNonce: SESSION_NONCE,
  clientLeadId: CLIENT_LEAD_ID,
  sourceClientMessageId: SOURCE_CLIENT_MESSAGE_ID,
  message: "Please contact me about weekly service.",
  visitorName: "Pat",
};

function leadRequest(
  body: Record<string, unknown> = VALID_BODY,
  options: {
    origin?: string;
    authorization?: string | null;
    businessId?: string;
    sessionId?: string;
  } = {},
) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: options.origin ?? ORIGIN,
  });
  if (options.authorization !== null) {
    headers.set("Authorization", options.authorization ?? "Bearer test-token");
  }
  return new NextRequest(
    `https://app.simplassist.test/api/widget/lead?businessId=${encodeURIComponent(options.businessId ?? BUSINESS_ID)}&sessionId=${encodeURIComponent(options.sessionId ?? SESSION_ID)}`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

function preflightRequest(origin = ORIGIN) {
  return new NextRequest(
    `https://app.simplassist.test/api/widget/lead?businessId=${BUSINESS_ID}&sessionId=${SESSION_ID}`,
    { method: "OPTIONS", headers: { Origin: origin } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.readWidgetBearerToken.mockReturnValue("test-token");
  mocks.verifyWidgetToken.mockReturnValue(true);
  mocks.resolvePublicWidgetAccess.mockResolvedValue({
    status: "allowed",
    config: { is_active: true },
  });
  mocks.resolveBusinessEntitlements.mockResolvedValue({ plan: "chat_only" });
  mocks.canUseFeature.mockReturnValue(true);
  mocks.resolveBusinessOperationalControls.mockResolvedValue({});
  mocks.resolveOperationalBlockReason.mockReturnValue(null);
  mocks.deriveWidgetNetworkKey.mockReturnValue("network-key");
  mocks.deriveWidgetRequestKey.mockReturnValue("request-key");
  mocks.acquireWidgetIngressTraffic.mockResolvedValue({ status: "allowed" });
  mocks.acquireWidgetTraffic.mockResolvedValue({
    status: "allowed",
    lease: { sharedLeaseToken: null, localConcurrencyKeys: [] },
  });
  mocks.recordWidgetOfflineLead.mockResolvedValue(
    "00000000-0000-4000-8000-000000000005",
  );
});

describe("widget offline lead route", () => {
  it("answers exact preflight without database or durable traffic work", async () => {
    const response = await OPTIONS(preflightRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization",
    );
    expect(response.headers.get("vary")).toContain("Origin");
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
    expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
  });

  it("rejects malformed preflight without echoing or doing work", async () => {
    const response = await OPTIONS(preflightRequest("null"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
  });

  it("normalizes and durably records an authorized lead", async () => {
    const response = await POST(
      leadRequest({
        ...VALID_BODY,
        message: "  Please contact me about weekly service.  ",
        visitorName: "  Pat Example  ",
        visitorEmail: "  PAT@Example.COM  ",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.verifyWidgetToken).toHaveBeenCalledWith("test-token", {
      businessId: BUSINESS_ID,
      origin: ORIGIN,
      sessionId: SESSION_ID,
      sessionNonce: SESSION_NONCE,
    });
    expect(mocks.resolvePublicWidgetAccess).toHaveBeenCalledWith(BUSINESS_ID, {
      origin: ORIGIN,
      hostname: "allowed.example",
    });
    expect(mocks.acquireWidgetTraffic).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      originHostname: "allowed.example",
      sessionId: SESSION_ID,
      endpoint: "lead",
      networkKey: "network-key",
      requestKey: "request-key",
    });
    expect(mocks.deriveWidgetRequestKey).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
      endpoint: "lead",
      clientMessageId: CLIENT_LEAD_ID,
    });
    expect(mocks.recordWidgetOfflineLead).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
      sessionNonce: SESSION_NONCE,
      clientLeadId: CLIENT_LEAD_ID,
      sourceClientMessageId: SOURCE_CLIENT_MESSAGE_ID,
      message: "Please contact me about weekly service.",
      visitorName: "Pat Example",
      visitorEmail: "pat@example.com",
    });
    expect(mocks.acquireWidgetTraffic.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolvePublicWidgetAccess.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["no contact identity", { ...VALID_BODY, visitorName: undefined }],
    ["an unknown field", { ...VALID_BODY, admin: true }],
    [
      "a control character in the message",
      { ...VALID_BODY, message: "Bad\u0000" },
    ],
    ["a multiline name", { ...VALID_BODY, visitorName: "Pat\nInjected" }],
  ])(
    "strictly rejects %s before token or database work",
    async (_label, body) => {
      const response = await POST(leadRequest(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
      expect(mocks.verifyWidgetToken).not.toHaveBeenCalled();
      expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
      expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
    },
  );

  it("rejects a query/body binding mismatch before token verification", async () => {
    const response = await POST(
      leadRequest({ ...VALID_BODY, businessId: OTHER_BUSINESS_ID }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
    expect(mocks.verifyWidgetToken).not.toHaveBeenCalled();
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
  });

  it("counts invalid bearer and rotating business attempts at ingress before any authority read", async () => {
    mocks.acquireWidgetIngressTraffic.mockResolvedValueOnce({
      status: "rate_limited",
      retryAfterSeconds: 23,
    });
    mocks.readWidgetBearerToken.mockReturnValue(null);
    const response = await POST(
      leadRequest(
        { ...VALID_BODY, businessId: OTHER_BUSINESS_ID },
        {
          businessId: OTHER_BUSINESS_ID,
          origin: "https://untrusted.example",
          authorization: null,
        },
      ),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "rate_limited",
      retryable: true,
    });
    expect(response.headers.get("retry-after")).toBe("23");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mocks.acquireWidgetIngressTraffic).toHaveBeenCalledWith({
      endpoint: "lead",
      networkKey: "network-key",
    });
    expect(mocks.readWidgetBearerToken).not.toHaveBeenCalled();
    expect(mocks.verifyWidgetToken).not.toHaveBeenCalled();
    expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
    expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
  });

  it("fails ingress closed without echoing an unverified origin", async () => {
    mocks.acquireWidgetIngressTraffic.mockRejectedValueOnce(
      new Error("private ingress failure"),
    );

    const response = await POST(leadRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "service_unavailable",
      retryable: true,
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mocks.readWidgetBearerToken).not.toHaveBeenCalled();
    expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
  });

  it("requires a token and verifies its full origin/session binding before reads", async () => {
    mocks.readWidgetBearerToken.mockReturnValueOnce(null);
    const missing = await POST(
      leadRequest(VALID_BODY, { authorization: null }),
    );
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "unauthorized" });
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();

    mocks.readWidgetBearerToken.mockReturnValueOnce("test-token");
    mocks.verifyWidgetToken.mockReturnValueOnce(false);
    const replayed = await POST(leadRequest());
    expect(replayed.status).toBe(401);
    expect(mocks.verifyWidgetToken).toHaveBeenCalledWith("test-token", {
      businessId: BUSINESS_ID,
      origin: ORIGIN,
      sessionId: SESSION_ID,
      sessionNonce: SESSION_NONCE,
    });
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden origin", { status: "forbidden" }, 403],
    ["unavailable origin state", { status: "unavailable" }, 503],
    [
      "inactive widget",
      { status: "allowed", config: { is_active: false } },
      403,
    ],
  ])(
    "fails closed for %s without persisting",
    async (_label, access, status) => {
      mocks.resolvePublicWidgetAccess.mockResolvedValueOnce(access);

      const response = await POST(leadRequest());

      expect(response.status).toBe(status);
      expect(mocks.acquireWidgetTraffic).toHaveBeenCalledOnce();
      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
      expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["origin_not_allowed", null],
    ["widget_inactive", ORIGIN],
  ] as const)(
    "preserves shared %s semantics without downstream reads",
    async (status, corsOrigin) => {
      mocks.acquireWidgetTraffic.mockResolvedValueOnce({ status });

      const response = await POST(leadRequest());

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "origin_not_allowed" });
      expect(response.headers.get("access-control-allow-origin")).toBe(
        corsOrigin,
      );
      expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
      expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
    },
  );

  it("keeps entitlement and operational denials generic", async () => {
    mocks.canUseFeature.mockReturnValueOnce(false);
    const notEntitled = await POST(leadRequest());
    expect(notEntitled.status).toBe(403);
    expect(await notEntitled.json()).toEqual({ error: "origin_not_allowed" });
    expect(mocks.acquireWidgetTraffic).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.readWidgetBearerToken.mockReturnValue("test-token");
    mocks.verifyWidgetToken.mockReturnValue(true);
    mocks.resolvePublicWidgetAccess.mockResolvedValue({
      status: "allowed",
      config: { is_active: true },
    });
    mocks.resolveBusinessEntitlements.mockResolvedValue({ plan: "chat_only" });
    mocks.canUseFeature.mockReturnValue(true);
    mocks.resolveBusinessOperationalControls.mockResolvedValue({});
    mocks.resolveOperationalBlockReason.mockReturnValue("ai_replies_paused");
    mocks.acquireWidgetIngressTraffic.mockResolvedValue({ status: "allowed" });
    mocks.acquireWidgetTraffic.mockResolvedValue({
      status: "allowed",
      lease: { sharedLeaseToken: null, localConcurrencyKeys: [] },
    });
    const paused = await POST(leadRequest());
    expect(paused.status).toBe(403);
    expect(await paused.json()).toEqual({ error: "origin_not_allowed" });
    expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
  });

  it("returns generic 429/503 traffic failures without persistence", async () => {
    mocks.acquireWidgetTraffic.mockResolvedValueOnce({
      status: "rate_limited",
      retryAfterSeconds: 11,
    });
    const limited = await POST(leadRequest());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "rate_limited",
      retryable: true,
    });
    expect(limited.headers.get("retry-after")).toBe("11");
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
    expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();

    mocks.acquireWidgetTraffic.mockRejectedValueOnce(
      new Error("private adapter failure"),
    );
    const unavailable = await POST(leadRequest());
    expect(unavailable.status).toBe(503);
    const unavailableBody = await unavailable.json();
    expect(unavailableBody).toEqual({
      error: "service_unavailable",
      retryable: true,
    });
    expect(JSON.stringify(unavailableBody)).not.toContain(
      "private adapter failure",
    );
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
    expect(mocks.recordWidgetOfflineLead).not.toHaveBeenCalled();
  });

  it("maps durable conflicts without leaking state", async () => {
    mocks.recordWidgetOfflineLead.mockRejectedValueOnce(
      new mocks.WidgetOfflineLeadConflictError(),
    );
    const conflict = await POST(leadRequest());
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "request_conflict",
      retryable: false,
    });

    mocks.recordWidgetOfflineLead.mockRejectedValueOnce(
      new Error("private database state"),
    );
    const unavailable = await POST(leadRequest());
    expect(unavailable.status).toBe(503);
    const body = await unavailable.json();
    expect(body).toEqual({ error: "service_unavailable", retryable: true });
    expect(JSON.stringify(body)).not.toContain("private database state");
  });
});
