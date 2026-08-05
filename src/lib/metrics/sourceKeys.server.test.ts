import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAiConversationSourceKey,
  buildDashboardBookingSourceKey,
  buildMissedCallSourceKey,
  buildWebChatSessionSourceKey,
} from "./sourceKeys.server";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-a000-000000000001";

describe("metric source keys", () => {
  it("hashes missed-call identifiers with the business identity", () => {
    const callId = "v3:call-session/raw-control-token";
    const key = buildMissedCallSourceKey(BUSINESS_ID, callId);

    expect(key).toBe(
      "missed-call:83a6e419cf91bd66f7071366e5bbff6b4c550c09e9e09e0d08580a67bd926d4b",
    );
    expect(key).toMatch(/^missed-call:[0-9a-f]{64}$/);
    expect(key).not.toContain(callId);
  });

  it("uses the UTC month for an AI conversation key", () => {
    expect(
      buildAiConversationSourceKey(
        CONVERSATION_ID.toUpperCase(),
        new Date("2026-09-01T00:30:00+01:00"),
      ),
    ).toBe(`ai-conversation:${CONVERSATION_ID}:2026-08`);
    expect(
      buildAiConversationSourceKey(
        CONVERSATION_ID,
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toBe(`ai-conversation:${CONVERSATION_ID}:2026-09`);
  });

  it("hashes the complete dashboard provider identity", () => {
    const calendarId = "team-calendar@example.com";
    const providerEventId = "google/event:id-raw";
    const key = buildDashboardBookingSourceKey(
      BUSINESS_ID,
      calendarId,
      providerEventId,
    );

    expect(key).toBe(
      "dashboard-booking:9dcb1fa412ecedf685f57d9a220878d0a3cacb8047957d5361ca783725b7b032",
    );
    expect(key).toMatch(/^dashboard-booking:[0-9a-f]{64}$/);
    expect(key).not.toContain(calendarId);
    expect(key).not.toContain(providerEventId);
  });

  it("hashes widget sessions per business and is retry-stable", () => {
    const sessionId = "widget-session/raw-secret";
    const first = buildWebChatSessionSourceKey(BUSINESS_ID, sessionId);
    const retry = buildWebChatSessionSourceKey(BUSINESS_ID, sessionId);
    const otherBusiness = buildWebChatSessionSourceKey(
      "10000000-0000-4000-a000-000000000002",
      sessionId,
    );

    expect(first).toBe(retry);
    expect(first).toBe(
      "web-chat-session:01adf2c51b57e85ce0edf50545fa1a5130edfa45beeaf753f5b1bcf921b8bed0",
    );
    expect(first).toMatch(/^web-chat-session:[0-9a-f]{64}$/);
    expect(first).not.toContain(sessionId);
    expect(otherBusiness).not.toBe(first);
  });

  it("frames hash inputs so component boundaries cannot collide", () => {
    const left = buildDashboardBookingSourceKey(BUSINESS_ID, "ab", "c");
    const right = buildDashboardBookingSourceKey(BUSINESS_ID, "a", "bc");

    expect(left).not.toBe(right);
  });

  it.each([
    ["missed call business", () => buildMissedCallSourceKey("not-a-uuid", "call")],
    ["missed call identifier", () => buildMissedCallSourceKey(BUSINESS_ID, "  ")],
    [
      "conversation identifier",
      () => buildAiConversationSourceKey("not-a-uuid", new Date()),
    ],
    [
      "conversation date",
      () => buildAiConversationSourceKey(CONVERSATION_ID, new Date("invalid")),
    ],
    [
      "dashboard calendar",
      () => buildDashboardBookingSourceKey(BUSINESS_ID, "", "event"),
    ],
    [
      "dashboard event",
      () => buildDashboardBookingSourceKey(BUSINESS_ID, "primary", ""),
    ],
    [
      "widget session",
      () => buildWebChatSessionSourceKey(BUSINESS_ID, ""),
    ],
  ])("rejects an invalid %s instead of fabricating a source key", (_label, run) => {
    expect(run).toThrow(TypeError);
  });
});
