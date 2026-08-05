import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class AIProcessingBlockedError extends Error {
    constructor(
      readonly reason:
        | "feature_not_entitled"
        | "conversation_in_manual_mode"
        | "account_suspended"
        | "ai_replies_paused"
        | "texting_paused"
    ) {
      super(reason);
    }
  }
  class AIProcessingStateError extends Error {}
  class BusinessPartnerResolutionError extends Error {}
  return {
    from: vi.fn(),
    serverFrom: vi.fn(),
    getUser: vi.fn(),
    resolveBusinessEntitlements: vi.fn(),
    canUseFeature: vi.fn(),
    processIncomingMessageDetailed: vi.fn(),
    recordKnowledgeGap: vi.fn(),
    resolveWidgetAttribution: vi.fn(),
    resolveBusinessOperationalControls: vi.fn(),
    AIProcessingBlockedError,
    AIProcessingStateError,
    BusinessPartnerResolutionError,
    requireWorkspaceRouteAccess: vi.fn(),
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
  processIncomingMessageDetailed: mocks.processIncomingMessageDetailed,
  AIProcessingBlockedError: mocks.AIProcessingBlockedError,
  AIProcessingStateError: mocks.AIProcessingStateError,
}));
vi.mock("@/lib/ai/knowledgeGaps", () => ({
  recordKnowledgeGap: mocks.recordKnowledgeGap,
}));
vi.mock("@/lib/branding/businessPartner.server", () => ({
  resolveWidgetAttribution: mocks.resolveWidgetAttribution,
  BusinessPartnerResolutionError: mocks.BusinessPartnerResolutionError,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock(
  "@/lib/account/operationalControls.server",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/account/operationalControls.server")
      >();
    return {
      ...actual,
      resolveBusinessOperationalControls:
        mocks.resolveBusinessOperationalControls,
    };
  }
);

import { EntitlementResolutionError } from "@/lib/billing/entitlements";
import { OperationalControlsResolutionError } from "@/lib/account/operationalControls.server";
import { POST as postChat } from "./chat/route";
import { GET as getConfig, PATCH as patchConfig } from "./config/route";
import { POST as postEnd } from "./end/route";
import { GET as getPreviewConfig } from "./preview-config/route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const PAUSED_AT = "2026-08-04T12:00:00.000Z";
const ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;
const ACTIVE_OPERATIONAL_CONTROLS = {
  businessId: BUSINESS_ID,
  operationsSuspendedAt: null,
  aiRepliesPausedAt: null,
  textingPausedAt: null,
  bookingsPausedAt: null,
} as const;

type QueryResult = { data?: unknown; error?: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

function configRequest(headers?: HeadersInit) {
  return new NextRequest(
    `http://localhost/api/widget/config?businessId=${BUSINESS_ID}`,
    { headers },
  );
}

function previewConfigRequest(headers?: HeadersInit) {
  return new NextRequest(
    `http://localhost/api/widget/preview-config?businessId=${BUSINESS_ID}`,
    { headers },
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
  mocks.resolveBusinessOperationalControls.mockResolvedValue(
    ACTIVE_OPERATIONAL_CONTROLS
  );
  mocks.processIncomingMessageDetailed.mockResolvedValue({
    text: "How can I help?",
    knowledgeGapDetected: false,
    conversationId: "conversation-1",
    sourceMessageId: "customer-message-1",
  });
  mocks.recordKnowledgeGap.mockResolvedValue(undefined);
  mocks.resolveWidgetAttribution.mockResolvedValue({
    poweredByName: "SimplAssist",
    poweredByUrl: "https://simplassist.com",
  });
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "user-1" },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    },
  });
  queueDatabaseResults();
});

describe("authenticated widget configuration mutations", () => {
  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i before parsing, entitlements, or updates", async (status, body) => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(body, { status }),
    });
    const guardedRequest = configPatchRequest();
    const json = vi.spyOn(guardedRequest, "json");

    const response = await patchConfig(guardedRequest);

    expect(response.status).toBe(status);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

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
    expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
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
    expect(mocks.requireWorkspaceRouteAccess).not.toHaveBeenCalled();
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

  it.each([
    ["account suspension", { operationsSuspendedAt: PAUSED_AT }],
    ["AI pause", { aiRepliesPausedAt: PAUSED_AT }],
  ])(
    "returns the privacy-safe unavailable config for %s",
    async (_label, pausedState) => {
      queueDatabaseResults(
        { data: { id: "widget-1" }, error: null },
        { data: { name: "Acme" }, error: null }
      );
      mocks.resolveBusinessOperationalControls.mockResolvedValue({
        ...ACTIVE_OPERATIONAL_CONTROLS,
        ...pausedState,
      });

      const response = await getConfig(configRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ available: false });
      expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledWith(
        BUSINESS_ID
      );
      expect(mocks.from).toHaveBeenCalledTimes(1);
      expect(mocks.resolveWidgetAttribution).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["texting pause", { textingPausedAt: PAUSED_AT }],
    ["bookings pause", { bookingsPausedAt: PAUSED_AT }],
  ])("keeps public config available during a %s", async (_label, pausedState) => {
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
          quick_replies: [],
        },
        error: null,
      },
      { data: { name: "Acme" }, error: null }
    );
    mocks.resolveBusinessOperationalControls.mockResolvedValue({
      ...ACTIVE_OPERATIONAL_CONTROLS,
      ...pausedState,
    });

    const response = await getConfig(configRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: true });
  });

  it("returns a generic retryable response when config operational state is indeterminate", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessOperationalControls.mockRejectedValue(
      new OperationalControlsResolutionError({
        code: "business_lookup_failed",
        businessId: BUSINESS_ID,
        message: "private database detail",
      })
    );

    const response = await getConfig(configRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(mocks.resolveWidgetAttribution).not.toHaveBeenCalled();
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
      poweredByName: "SimplAssist",
      poweredByUrl: "https://simplassist.com",
    });
    const configChain = mocks.from.mock.results[0]?.value as {
      eq: ReturnType<typeof vi.fn>;
    };
    expect(configChain.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("returns unavailable when AI pauses while config attribution is pending", async () => {
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
    const attribution = deferred<{
      poweredByName: string;
      poweredByUrl: string;
    }>();
    mocks.resolveWidgetAttribution.mockReturnValue(attribution.promise);
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_OPERATIONAL_CONTROLS)
      .mockResolvedValueOnce({
        ...ACTIVE_OPERATIONAL_CONTROLS,
        aiRepliesPausedAt: PAUSED_AT,
      });

    const responsePromise = getConfig(configRequest());
    await vi.waitFor(() =>
      expect(mocks.resolveWidgetAttribution).toHaveBeenCalledOnce()
    );
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(1);

    attribution.resolve({
      poweredByName: "Private attribution",
      poweredByUrl: "https://private.example",
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false });
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the final config operational read is indeterminate", async () => {
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
          quick_replies: [],
        },
        error: null,
      },
      { data: { name: "Acme" }, error: null }
    );
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_OPERATIONAL_CONTROLS)
      .mockRejectedValueOnce(
        new OperationalControlsResolutionError({
          code: "business_lookup_failed",
          businessId: BUSINESS_ID,
          message: "private database detail",
        })
      );

    const response = await getConfig(configRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(2);
  });

  it("returns the cleaned chat response while launching gap capture in the background", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: "conversation-1",
      sourceMessageId: "customer-message-1",
    });
    mocks.recordKnowledgeGap.mockReturnValue(new Promise(() => undefined));

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Do you offer free trials?",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      response: "I don't see free trials mentioned. Please call us.",
      sessionId: "session-1",
    });
    expect(mocks.recordKnowledgeGap).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      sourceMessageId: "customer-message-1",
      aiResponseText: "I don't see free trials mentioned. Please call us.",
    });
    expect(
      mocks.processIncomingMessageDetailed.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.recordKnowledgeGap.mock.invocationCallOrder[0]);
  });

  it("does not capture a widget response without a gap signal", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Hello",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      response: "How can I help?",
    });
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("returns the widget response when background gap capture unexpectedly rejects", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: "conversation-1",
      sourceMessageId: "customer-message-1",
    });
    const captureError = new Error("capture failed");
    mocks.recordKnowledgeGap.mockRejectedValue(captureError);

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Do you offer free trials?",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      response: "I don't see free trials mentioned. Please call us.",
    });
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[widget:chat] Knowledge gap capture failed:",
        {
          businessId: BUSINESS_ID,
          sourceMessageId: "customer-message-1",
        },
        captureError
      )
    );
  });

  it.each([
    ["account suspension", { operationsSuspendedAt: PAUSED_AT }],
    ["AI pause", { aiRepliesPausedAt: PAUSED_AT }],
  ])(
    "skips AI and returns privacy-safe unavailable chat for %s",
    async (_label, pausedState) => {
      queueDatabaseResults({ data: { id: "widget-1" }, error: null });
      mocks.resolveBusinessOperationalControls.mockResolvedValue({
        ...ACTIVE_OPERATIONAL_CONTROLS,
        ...pausedState,
      });

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
      expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["texting pause", { textingPausedAt: PAUSED_AT }],
    ["bookings pause", { bookingsPausedAt: PAUSED_AT }],
  ])("keeps web chat available during a %s", async (_label, pausedState) => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessOperationalControls.mockResolvedValue({
      ...ACTIVE_OPERATIONAL_CONTROLS,
      ...pausedState,
    });

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Hello",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      response: "How can I help?",
    });
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(2);
  });

  it("suppresses the response and gap dispatch when AI pauses after generation", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_OPERATIONAL_CONTROLS)
      .mockResolvedValueOnce({
        ...ACTIVE_OPERATIONAL_CONTROLS,
        aiRepliesPausedAt: PAUSED_AT,
      });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "Private generated response",
      knowledgeGapDetected: true,
      conversationId: "conversation-1",
      sourceMessageId: "customer-message-1",
    });

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Do you offer free trials?",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      response: null,
    });
    expect(mocks.processIncomingMessageDetailed).toHaveBeenCalledTimes(1);
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(2);
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("fails closed when the post-generation operational read is indeterminate", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_OPERATIONAL_CONTROLS)
      .mockRejectedValueOnce(
        new OperationalControlsResolutionError({
          code: "business_lookup_failed",
          businessId: BUSINESS_ID,
          message: "private database detail",
        })
      );
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "Private generated response",
      knowledgeGapDetected: true,
      conversationId: "conversation-1",
      sourceMessageId: "customer-message-1",
    });

    const response = await postChat(
      postRequest("chat", {
        businessId: BUSINESS_ID,
        message: "Do you offer free trials?",
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(mocks.processIncomingMessageDetailed).toHaveBeenCalledTimes(1);
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(2);
    expect(
      mocks.processIncomingMessageDetailed.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.resolveBusinessOperationalControls.mock.invocationCallOrder[1]
    );
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("fails closed before AI when the initial operational read is indeterminate", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.resolveBusinessOperationalControls.mockRejectedValue(
      new OperationalControlsResolutionError({
        code: "business_lookup_failed",
        businessId: BUSINESS_ID,
        message: "private database detail",
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
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
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
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
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
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    // The sole database call is the required read-only widget availability lookup.
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("returns unavailable when the AI engine catches a downgrade race", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessageDetailed.mockRejectedValue(
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

  it.each(["account_suspended", "ai_replies_paused"] as const)(
    "does not expose the engine's %s block",
    async (reason) => {
      queueDatabaseResults({ data: { id: "widget-1" }, error: null });
      mocks.processIncomingMessageDetailed.mockRejectedValue(
        new mocks.AIProcessingBlockedError(reason)
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
    }
  );

  it("returns retryable 503 for an indeterminate engine operational read", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessageDetailed.mockRejectedValue(
      new OperationalControlsResolutionError({
        code: "business_lookup_failed",
        businessId: BUSINESS_ID,
        message: "private database detail",
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
  });

  it("returns retryable 503 when AI context persistence or lookup is uncertain", async () => {
    queueDatabaseResults({ data: { id: "widget-1" }, error: null });
    mocks.processIncomingMessageDetailed.mockRejectedValue(
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

  it("keeps end-session cleanup available without operational checks", async () => {
    queueDatabaseResults(
      { data: { id: "widget-1" }, error: null },
      { data: { id: "contact-1" }, error: null },
      { data: { id: "conversation-1" }, error: null },
      { data: null, error: null }
    );
    mocks.resolveBusinessOperationalControls.mockRejectedValue(
      new Error("operational controls must not gate cleanup")
    );

    const response = await postEnd(
      postRequest("end", {
        businessId: BUSINESS_ID,
        sessionId: "session-1",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      available: true,
    });
    expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
  });
});

describe("widget attribution responses", () => {
  const widgetConfig = {
    id: "widget-1",
    brand_color: "#123456",
    position: "bottom_right",
    welcome_message: "Welcome",
    show_logo: false,
    logo_url: null,
    lead_capture_enabled: true,
    lead_capture_timing: "start",
    quick_replies: ["Pricing"],
  };

  it("returns assigned-partner attribution without passing forwarded Host headers", async () => {
    queueDatabaseResults(
      { data: widgetConfig, error: null },
      { data: { name: "Acme" }, error: null },
    );
    mocks.resolveWidgetAttribution.mockResolvedValue({
      poweredByName: "Alpha Dog Agency",
      poweredByUrl: "https://app.alphadogagency.ai",
    });

    const response = await getConfig(
      configRequest({
        Host: "simplassist.com",
        "X-Forwarded-Host": "app.alphadogagency.ai",
        Forwarded: "host=app.alphadogagency.ai",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      poweredByName: "Alpha Dog Agency",
      poweredByUrl: "https://app.alphadogagency.ai",
    });
    expect(JSON.stringify(payload)).not.toContain("SimplAssist");
    expect(mocks.resolveWidgetAttribution).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      hostHeader: "simplassist.com",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns retryable 503 with CORS when public attribution lookup fails", async () => {
    queueDatabaseResults(
      { data: widgetConfig, error: null },
      { data: { name: "Acme" }, error: null },
    );
    mocks.resolveWidgetAttribution.mockRejectedValue(
      new mocks.BusinessPartnerResolutionError("database unavailable"),
    );

    const response = await getConfig(configRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns retryable 503 with private cache headers when preview attribution fails", async () => {
    setServerBusinessResult({
      data: { id: BUSINESS_ID, name: "Acme" },
      error: null,
    });
    queueDatabaseResults({ data: widgetConfig, error: null });
    mocks.resolveWidgetAttribution.mockRejectedValue(
      new mocks.BusinessPartnerResolutionError("database unavailable"),
    );

    const response = await getPreviewConfig(
      previewConfigRequest({
        Host: "simplassist.com",
        "X-Forwarded-Host": "app.alphadogagency.ai",
        Forwarded: "host=app.alphadogagency.ai",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});

describe("owner-only widget preview", () => {
  it("requires an authenticated owner", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await getPreviewConfig(previewConfigRequest());

    expect(response.status).toBe(401);
    expect(mocks.serverFrom).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i with private headers before preview reads", async (status, body) => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(body, { status }),
    });

    const response = await getPreviewConfig(previewConfigRequest());

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.serverFrom).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
  });


  it("returns 404 without revealing a widget owned by another user", async () => {
    setServerBusinessResult({ data: null, error: null });

    const response = await getPreviewConfig(previewConfigRequest());

    expect(response.status).toBe(404);
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("enforces the web-chat entitlement", async () => {
    setServerBusinessResult({
      data: { id: BUSINESS_ID, name: "Acme" },
      error: null,
    });
    mocks.canUseFeature.mockReturnValue(false);

    const response = await getPreviewConfig(previewConfigRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "feature_unavailable",
      feature: "web_chat",
      requiredPlan: "sms_and_chat",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns the saved config even when the widget is inactive", async () => {
    setServerBusinessResult({
      data: { id: BUSINESS_ID, name: "Acme" },
      error: null,
    });
    queueDatabaseResults({
      data: {
        id: "widget-1",
        business_id: BUSINESS_ID,
        is_active: false,
        brand_color: "#123456",
        position: "bottom_left",
        welcome_message: "Preview welcome",
        show_logo: false,
        logo_url: null,
        lead_capture_enabled: true,
        lead_capture_timing: "after_3_messages",
        quick_replies: ["Pricing"],
      },
      error: null,
    });

    const response = await getPreviewConfig(
      previewConfigRequest({
        Host: "simplassist.com",
        "X-Forwarded-Host": "app.alphadogagency.ai",
        Forwarded: "host=app.alphadogagency.ai",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      available: true,
      businessName: "Acme",
      position: "bottom_left",
      welcomeMessage: "Preview welcome",
      poweredByName: "SimplAssist",
      poweredByUrl: "https://simplassist.com",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolveWidgetAttribution).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      hostHeader: "simplassist.com",
    });
    const previewChain = mocks.from.mock.results[0]?.value as {
      eq: ReturnType<typeof vi.fn>;
    };
    expect(previewChain.eq).not.toHaveBeenCalledWith("is_active", true);
    expect(mocks.resolveBusinessOperationalControls).not.toHaveBeenCalled();
  });
});
