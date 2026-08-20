import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePublicWidgetAccess: vi.fn(),
  recordWidgetEngagementEvent: vi.fn(),
  readWidgetBearerToken: vi.fn(),
  verifyWidgetToken: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  resolveBusinessOperationalControls: vi.fn(),
  resolveOperationalBlockReason: vi.fn(),
  arePublicWidgetProactiveInvitationsEnabledForBusiness: vi.fn(),
  acquireWidgetIngressTraffic: vi.fn(),
  acquireWidgetTraffic: vi.fn(),
  deriveWidgetNetworkKey: vi.fn(),
  deriveWidgetRequestKey: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/widget/access.server", () => ({
  resolvePublicWidgetAccess: mocks.resolvePublicWidgetAccess,
}));
vi.mock("@/lib/widget/telemetry.server", () => ({
  recordWidgetEngagementEvent: mocks.recordWidgetEngagementEvent,
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
vi.mock("@/lib/widget/proactiveInvitations.server", () => ({
  arePublicWidgetProactiveInvitationsEnabledForBusiness:
    mocks.arePublicWidgetProactiveInvitationsEnabledForBusiness,
}));

import { OPTIONS, POST } from "./route";
import { WIDGET_EDGE_ORIGIN_HEADER } from "@/lib/widget/edgeOrigin.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_BUSINESS_ID = "00000000-0000-4000-8000-000000000099";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const SESSION_NONCE = "abcdefghijklmnopqrstuvwx";
const ORIGIN = "https://allowed.example";
const EDGE_SECRET = "e".repeat(64);

const VALID_BODY = {
  businessId: BUSINESS_ID,
  sessionId: SESSION_ID,
  sessionNonce: SESSION_NONCE,
  eventType: "invitation_shown",
  source: "proactive_timer",
  deviceBucket: "mobile",
  promptVersion: 1,
} as const;

function telemetryRequest(
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
    [WIDGET_EDGE_ORIGIN_HEADER]: EDGE_SECRET,
  });
  if (options.authorization !== null) {
    headers.set("Authorization", options.authorization ?? "Bearer test-token");
  }
  return new NextRequest(
    `https://app.simplassist.test/api/widget/telemetry?businessId=${encodeURIComponent(options.businessId ?? BUSINESS_ID)}&sessionId=${encodeURIComponent(options.sessionId ?? SESSION_ID)}`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

function preflightRequest(origin = ORIGIN) {
  return new NextRequest(
    `https://app.simplassist.test/api/widget/telemetry?businessId=${BUSINESS_ID}&sessionId=${SESSION_ID}`,
    {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        [WIDGET_EDGE_ORIGIN_HEADER]: EDGE_SECRET,
      },
    },
  );
}

function withEdgeMarker(request: NextRequest, marker: string | null) {
  if (marker === null) request.headers.delete(WIDGET_EDGE_ORIGIN_HEADER);
  else request.headers.set(WIDGET_EDGE_ORIGIN_HEADER, marker);
  return request;
}

beforeEach(() => {
  vi.stubEnv("WIDGET_EDGE_ORIGIN_SECRET", EDGE_SECRET);
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.readWidgetBearerToken.mockReturnValue("test-token");
  mocks.verifyWidgetToken.mockReturnValue(true);
  mocks.resolvePublicWidgetAccess.mockResolvedValue({
    status: "allowed",
    config: { is_active: true, proactive_invitation_enabled: true },
  });
  mocks.resolveBusinessEntitlements.mockResolvedValue({ plan: "chat_only" });
  mocks.canUseFeature.mockReturnValue(true);
  mocks.resolveBusinessOperationalControls.mockResolvedValue({});
  mocks.resolveOperationalBlockReason.mockReturnValue(null);
  mocks.arePublicWidgetProactiveInvitationsEnabledForBusiness.mockReturnValue(
    true,
  );
  mocks.deriveWidgetNetworkKey.mockReturnValue("network-key");
  mocks.deriveWidgetRequestKey.mockReturnValue("request-key");
  mocks.acquireWidgetIngressTraffic.mockResolvedValue({ status: "allowed" });
  mocks.acquireWidgetTraffic.mockResolvedValue({
    status: "allowed",
    lease: { sharedLeaseToken: null, localConcurrencyKeys: [] },
  });
  mocks.recordWidgetEngagementEvent.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("widget engagement telemetry route", () => {
  it.each([
    [
      "POST",
      (marker: string | null) =>
        POST(withEdgeMarker(telemetryRequest(), marker)),
    ],
    [
      "OPTIONS",
      (marker: string | null) =>
        OPTIONS(withEdgeMarker(preflightRequest(), marker)),
    ],
  ] as const)(
    "rejects a missing or wrong edge marker on %s before downstream work",
    async (_label, invoke) => {
      for (const marker of [null, "x".repeat(64)] as const) {
        vi.clearAllMocks();
        const response = await invoke(marker);

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "origin_not_allowed" });
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
        expect(mocks.readWidgetBearerToken).not.toHaveBeenCalled();
        expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
        expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
      }
    },
  );

  it("answers an exact preflight without durable work", async () => {
    const response = await OPTIONS(preflightRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization",
    );
    expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["widget_loaded", "widget_load"],
    ["invitation_shown", "proactive_timer"],
    ["invitation_dismissed", "proactive_scroll"],
    ["widget_engaged", "manual"],
    ["first_message_submitted", "proactive_timer"],
  ] as const)("records the constrained %s event", async (eventType, source) => {
    const response = await POST(
      telemetryRequest({ ...VALID_BODY, eventType, source }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.acquireWidgetIngressTraffic).toHaveBeenCalledWith({
      endpoint: "telemetry",
      networkKey: "network-key",
    });
    expect(mocks.verifyWidgetToken).toHaveBeenCalledWith("test-token", {
      businessId: BUSINESS_ID,
      origin: ORIGIN,
      sessionId: SESSION_ID,
      sessionNonce: SESSION_NONCE,
    });
    expect(mocks.acquireWidgetTraffic).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      originHostname: "allowed.example",
      sessionId: SESSION_ID,
      endpoint: "telemetry",
      networkKey: "network-key",
      requestKey: "request-key",
    });
    expect(mocks.recordWidgetEngagementEvent).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
      eventType,
      source,
      deviceBucket: "mobile",
      promptVersion: 1,
    });
    expect(
      mocks.acquireWidgetIngressTraffic.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.verifyWidgetToken.mock.invocationCallOrder[0]);
    expect(mocks.verifyWidgetToken.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acquireWidgetTraffic.mock.invocationCallOrder[0],
    );
    expect(mocks.acquireWidgetTraffic.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordWidgetEngagementEvent.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["manual invitation", { ...VALID_BODY, source: "manual" }],
    [
      "manual widget load",
      { ...VALID_BODY, eventType: "widget_loaded", source: "manual" },
    ],
    [
      "load source on engagement",
      { ...VALID_BODY, eventType: "widget_engaged", source: "widget_load" },
    ],
    ["unknown event", { ...VALID_BODY, eventType: "widget_rendered" }],
    ["unknown device", { ...VALID_BODY, deviceBucket: "tablet" }],
    ["zero prompt version", { ...VALID_BODY, promptVersion: 0 }],
    ["fractional prompt version", { ...VALID_BODY, promptVersion: 1.5 }],
    ["unknown field", { ...VALID_BODY, pageUrl: "https://private.example" }],
  ])(
    "strictly rejects %s before ingress or authority work",
    async (_label, body) => {
      const response = await POST(telemetryRequest(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
      expect(mocks.readWidgetBearerToken).not.toHaveBeenCalled();
      expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
      expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
    },
  );

  it("rejects query/body binding mismatch before ingress or token work", async () => {
    const response = await POST(
      telemetryRequest({ ...VALID_BODY, businessId: OTHER_BUSINESS_ID }),
    );

    expect(response.status).toBe(400);
    expect(mocks.acquireWidgetIngressTraffic).not.toHaveBeenCalled();
    expect(mocks.verifyWidgetToken).not.toHaveBeenCalled();
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
  });

  it("counts untrusted attempts at ingress before reading their bearer token", async () => {
    mocks.acquireWidgetIngressTraffic.mockResolvedValueOnce({
      status: "rate_limited",
      retryAfterSeconds: 17,
    });
    const response = await POST(
      telemetryRequest(VALID_BODY, { authorization: null }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mocks.readWidgetBearerToken).not.toHaveBeenCalled();
    expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
  });

  it("requires and verifies the full token binding before shared traffic", async () => {
    mocks.readWidgetBearerToken.mockReturnValueOnce(null);
    const missing = await POST(
      telemetryRequest(VALID_BODY, { authorization: null }),
    );
    expect(missing.status).toBe(401);
    expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();

    mocks.readWidgetBearerToken.mockReturnValueOnce("test-token");
    mocks.verifyWidgetToken.mockReturnValueOnce(false);
    const replayed = await POST(telemetryRequest());
    expect(replayed.status).toBe(401);
    expect(mocks.acquireWidgetTraffic).not.toHaveBeenCalled();
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["origin_not_allowed", 403],
    ["widget_inactive", 403],
    ["unavailable", 503],
    ["rate_limited", 429],
  ] as const)("fails closed for shared %s traffic", async (status, code) => {
    mocks.acquireWidgetTraffic.mockResolvedValueOnce(
      status === "rate_limited"
        ? { status, retryAfterSeconds: 11 }
        : { status },
    );

    const response = await POST(telemetryRequest());

    expect(response.status).toBe(code);
    expect(mocks.resolvePublicWidgetAccess).not.toHaveBeenCalled();
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", { status: "forbidden" }, 403],
    ["unavailable", { status: "unavailable" }, 503],
    ["inactive", { status: "allowed", config: { is_active: false } }, 403],
  ])(
    "does not persist for %s widget access",
    async (_label, access, status) => {
      mocks.resolvePublicWidgetAccess.mockResolvedValueOnce(access);
      const response = await POST(telemetryRequest());

      expect(response.status).toBe(status);
      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
    },
  );

  it("requires both owner preference and rollout authority for proactive provenance", async () => {
    mocks.resolvePublicWidgetAccess.mockResolvedValueOnce({
      status: "allowed",
      config: { is_active: true, proactive_invitation_enabled: false },
    });
    const optedOut = await POST(telemetryRequest());
    expect(optedOut.status).toBe(403);
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();

    mocks.resolvePublicWidgetAccess.mockResolvedValueOnce({
      status: "allowed",
      config: { is_active: true, proactive_invitation_enabled: true },
    });
    mocks.arePublicWidgetProactiveInvitationsEnabledForBusiness.mockReturnValueOnce(
      false,
    );
    const rolloutOff = await POST(telemetryRequest());
    expect(rolloutOff.status).toBe(403);
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();

    mocks.resolvePublicWidgetAccess.mockResolvedValueOnce({
      status: "allowed",
      config: { is_active: true, proactive_invitation_enabled: false },
    });
    const loaded = await POST(
      telemetryRequest({
        ...VALID_BODY,
        eventType: "widget_loaded",
        source: "widget_load",
      }),
    );
    expect(loaded.status).toBe(200);

    mocks.resolvePublicWidgetAccess.mockResolvedValueOnce({
      status: "allowed",
      config: { is_active: true, proactive_invitation_enabled: false },
    });
    const manual = await POST(
      telemetryRequest({
        ...VALID_BODY,
        eventType: "widget_engaged",
        source: "manual",
      }),
    );
    expect(manual.status).toBe(200);
    expect(
      mocks.arePublicWidgetProactiveInvitationsEnabledForBusiness,
    ).toHaveBeenCalledTimes(1);
  });

  it("keeps entitlement and operational denials generic", async () => {
    mocks.canUseFeature.mockReturnValueOnce(false);
    const notEntitled = await POST(telemetryRequest());
    expect(notEntitled.status).toBe(403);
    expect(await notEntitled.json()).toEqual({ error: "origin_not_allowed" });

    mocks.canUseFeature.mockReturnValueOnce(true);
    mocks.resolveOperationalBlockReason.mockReturnValueOnce(
      "ai_replies_paused",
    );
    const paused = await POST(telemetryRequest());
    expect(paused.status).toBe(403);
    expect(mocks.recordWidgetEngagementEvent).not.toHaveBeenCalled();
  });

  it("returns a generic retryable error when persistence fails", async () => {
    mocks.recordWidgetEngagementEvent.mockRejectedValueOnce(
      new Error("private telemetry database state"),
    );
    const response = await POST(telemetryRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "service_unavailable", retryable: true });
    expect(JSON.stringify(body)).not.toContain("private telemetry");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
});
