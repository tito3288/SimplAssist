import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  deriveWidgetEngagementSessionHash,
  recordWidgetEngagementEvent,
} from "./telemetry.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const SECRET = "telemetry-test-secret-that-is-long-enough";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WIDGET_TOKEN_SECRET", SECRET);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("widget engagement telemetry", () => {
  it("derives a deterministic domain-separated keyed HMAC", () => {
    const expected = createHmac("sha256", SECRET)
      .update("simplassist-widget-engagement-session:v1", "utf8")
      .update("\0", "utf8")
      .update(BUSINESS_ID, "utf8")
      .update("\0", "utf8")
      .update(SESSION_ID, "utf8")
      .digest("hex");

    const first = deriveWidgetEngagementSessionHash({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
    });
    const retry = deriveWidgetEngagementSessionHash({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
    });

    expect(first).toBe(expected);
    expect(retry).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(SESSION_ID);
  });

  it("separates businesses, sessions, and secrets", () => {
    const original = deriveWidgetEngagementSessionHash({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
    });
    expect(
      deriveWidgetEngagementSessionHash({
        businessId: "00000000-0000-4000-8000-000000000099",
        sessionId: SESSION_ID,
      }),
    ).not.toBe(original);
    expect(
      deriveWidgetEngagementSessionHash({
        businessId: BUSINESS_ID,
        sessionId: "00000000-0000-4000-8000-000000000099",
      }),
    ).not.toBe(original);
    expect(
      deriveWidgetEngagementSessionHash(
        { businessId: BUSINESS_ID, sessionId: SESSION_ID },
        "a-different-telemetry-secret-long-enough",
      ),
    ).not.toBe(original);
  });

  it("fails closed when the shared widget secret is unavailable or weak", () => {
    vi.stubEnv("WIDGET_TOKEN_SECRET", "");
    expect(() =>
      deriveWidgetEngagementSessionHash({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
      }),
    ).toThrow(/32 bytes/);

    expect(() =>
      deriveWidgetEngagementSessionHash(
        { businessId: BUSINESS_ID, sessionId: SESSION_ID },
        "short",
      ),
    ).toThrow(/32 bytes/);
  });

  it("sends only the keyed hash and constrained dimensions to the RPC", async () => {
    const inserted = await recordWidgetEngagementEvent({
      businessId: BUSINESS_ID,
      sessionId: SESSION_ID,
      eventType: "widget_engaged",
      source: "proactive_timer",
      deviceBucket: "mobile",
      promptVersion: 1,
    });

    expect(inserted).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("record_widget_engagement_event", {
      p_business_id: BUSINESS_ID,
      p_session_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_event_type: "widget_engaged",
      p_source: "proactive_timer",
      p_device_bucket: "mobile",
      p_prompt_version: 1,
    });
    const serialized = JSON.stringify(mocks.rpc.mock.calls[0]?.[1]);
    expect(serialized).not.toContain(SESSION_ID);
    expect(serialized).not.toMatch(/message|contact|email|url|ip/i);
  });

  it("accepts a duplicate no-op and fails closed on persistence errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      recordWidgetEngagementEvent({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
        eventType: "invitation_shown",
        source: "proactive_scroll",
        deviceBucket: "desktop",
        promptVersion: 1,
      }),
    ).resolves.toBe(false);

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private database state" },
    });
    await expect(
      recordWidgetEngagementEvent({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
        eventType: "invitation_shown",
        source: "proactive_timer",
        deviceBucket: "desktop",
        promptVersion: 1,
      }),
    ).rejects.toThrow("persistence failed");

    mocks.rpc.mockResolvedValueOnce({ data: "true", error: null });
    await expect(
      recordWidgetEngagementEvent({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
        eventType: "first_message_submitted",
        source: "manual",
        deviceBucket: "desktop",
        promptVersion: 1,
      }),
    ).rejects.toThrow("malformed data");
  });
});
