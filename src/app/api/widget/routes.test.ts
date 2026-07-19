import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class AIProcessingBlockedError extends Error {
    constructor(
      readonly reason: "feature_not_entitled" | "conversation_in_manual_mode"
    ) {
      super(reason);
    }
  }
  class AIProcessingStateError extends Error {}
  return {
    from: vi.fn(),
    serverFrom: vi.fn(),
    getUser: vi.fn(),
    resolveBusinessEntitlements: vi.fn(),
    canUseFeature: vi.fn(),
    processIncomingMessage: vi.fn(),
    AIProcessingBlockedError,
    AIProcessingStateError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.serverFrom,
  })),
}));
vi.mock("@/lib/billing/entitlements", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/entitlements")>();
  return {
    ...actual,
    resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
    canUseFeature: mocks.canUseFeature,
  };
});
vi.mock("@/lib/ai/engine", () => ({
  processIncomingMessage: mocks.processIncomingMessage,
  AIProcessingBlockedError: mocks.AIProcessingBlockedError,
  AIProcessingStateError: mocks.AIProcessingStateError,
}));

import { EntitlementResolutionError } from "@/lib/billing/entitlements";
import { POST as postChat } from "./chat/route";
import { GET as getConfig, PATCH as patchConfig } from "./config/route";
import { POST as postEnd } from "./end/route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

type QueryResult = { data?: unknown; error?: unknown };

function queueDatabaseResults(...results: QueryResult[]) {
  const queue = [...results];
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "maybeSingle", "update"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve({ data: null, error: null, ...result });
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });
}

function configRequest() {
  return new NextRequest(
    `http://localhost/api/widget/config?businessId=${BUSINESS_ID}`
  );
}

const WIDGET_CONFIG_PATCH = {
  brand_color: "#123456",
  position: "bottom_right",
  show_logo: false,
  logo_url: null,
  welcome_message: "Welcome",
  lead_capture_enabled: true,
  lead_capture_timing: "start",
  quick_replies: ["Pricing"],
  is_active: true,
} as const;

function configPatchRequest(body: unknown = WIDGET_CONFIG_PATCH) {
  return new NextRequest("http://localhost/api/widget/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setServerBusinessResult(result: QueryResult) {
  mocks.serverFrom.mockImplementation(() => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.maybeSingle.mockResolvedValue({ data: null, error: null, ...result });
    return chain;
  });
}

function postRequest(path: "chat" | "end", body: unknown) {
  return new NextRequest(`http://localhost/api/widget/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  setServerBusinessResult({ data: { id: BUSINESS_ID }, error: null });
  mocks.resolveBusinessEntitlements.mockResolvedValue(ENTITLEMENTS);
  mocks.canUseFeature.mockReturnValue(true);
  mocks.processIncomingMessage.mockResolvedValue("How can I help?");
  queueDatabaseResults();
});

describe("authenticated widget configuration mutations", () => {
  it("returns 403 for a known web-chat entitlement denial", async () => {
    mocks.canUseFeature.mockReturnValue(false);

    const response = await patchConfig(configPatchRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "feature_unavailable",
      feature: "web_chat",
      requiredPlan: "sms_and_chat",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when entitlement state is indeterminate", async () => {
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new EntitlementResolutionError({
        code: "subscription_lookup_failed",
        businessId: BUSINESS_ID,
        message: "database unavailable",
      })
    );

    const response = await patchConfig(configPatchRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("updates an allow-listed configuration through the admin client", async () => {
    queueDatabaseResults({
      data: { id: "widget-1", business_id: BUSINESS_ID, ...WIDGET_CONFIG_PATCH },
      error: null,
    });

    const response = await patchConfig(configPatchRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.config).toMatchObject({
      id: "widget-1",
      business_id: BUSINESS_ID,
      welcome_message: "Welcome",
    });
    const updateChain = mocks.from.mock.results[0]?.value as {
      update: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    };
    expect(updateChain.update).toHaveBeenCalledWith(WIDGET_CONFIG_PATCH);
    expect(updateChain.eq).toHaveBeenCalledWith("business_id", BUSINESS_ID);
  });

  it("returns retryable 503 when the admin configuration update fails", async () => {
    queueDatabaseResults({ data: null, error: { message: "connection reset" } });

    const response = await patchConfig(configPatchRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
  });
});

describe("public widget entitlement boundaries", () => {
  it("returns an authoritative unavailable response for a known plan denial", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.canUseFeature.mockReturnValue(false);

    const response = await getConfig(configRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false });
  });

  it("returns retryable 503 when entitlement state cannot be determined", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new EntitlementResolutionError({
        code: "subscription_lookup_failed",
        businessId: BUSINESS_ID,
        message: "database unavailable",
      })
    );

    const response = await getConfig(configRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
  });

  it("returns configuration only after an active widget and entitlement pass", async () => {
    queueDatabaseResults(
      {
        data: {
          id: "widget-1",
          brand_color: "#123456",
          position: "bottom_right",
          welcome_message: "Welcome",
          show_logo: false,
          logo_url: null,
          lead_capture_enabled: true,
          lead_capture_timing: "start",
          quick_replies: ["Pricing"],
        },
        error: null,
      },
      { data: { name: "Acme" }, error: null }
    );

    const response = await getConfig(configRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      available: true,
      businessName: "Acme",
      welcomeMessage: "Welcome",
    });
  });

  it("skips AI and acknowledges chat when the plan is not entitled", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.canUseFeature.mockReturnValue(false);

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Hello",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      response: null,
    });
    expect(mocks.processIncomingMessage).not.toHaveBeenCalled();
  });

  it("returns retryable 503 without AI or writes when chat entitlement resolution fails", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new EntitlementResolutionError({
        code: "subscription_lookup_failed",
        businessId: BUSINESS_ID,
        message: "database unavailable",
      })
    );

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Hello",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(mocks.processIncomingMessage).not.toHaveBeenCalled();
    // The sole database call is the required read-only widget availability lookup.
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when the AI engine catches a downgrade race", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessage.mockRejectedValue(
      new mocks.AIProcessingBlockedError("feature_not_entitled")
    );

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Hello",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      response: null,
    });
  });

  it("returns retryable 503 when AI context persistence or lookup is uncertain", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessage.mockRejectedValue(
      new mocks.AIProcessingStateError("database unavailable")
    );

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Hello",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
  });

  it("skips conversation writes when end-session is not entitled", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.canUseFeature.mockReturnValue(false);

    const response = await postEnd(
      postRequest("end", {
        businessId: BUSINESS_ID,
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      available: false,
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns retryable 503 without conversation writes when end-session entitlement resolution fails", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new EntitlementResolutionError({
        code: "subscription_lookup_failed",
        businessId: BUSINESS_ID,
        message: "database unavailable",
      })
    );

    const response = await postEnd(
      postRequest("end", {
        businessId: BUSINESS_ID,
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    // The sole database call is the required read-only widget availability lookup.
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
