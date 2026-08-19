import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseExactWidgetQuery,
  parseWidgetJson,
  widgetChatRequestSchema,
  widgetErrorResponse,
} from "./request.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";

describe("widget request boundaries", () => {
  it("accepts only the exact public query shape", () => {
    expect(
      parseExactWidgetQuery(
        new Request(
          `https://app.test/api/widget/config?businessId=${BUSINESS_ID}&sessionId=${SESSION_ID}`,
        ),
      ),
    ).toEqual({ ok: true, data: { businessId: BUSINESS_ID, sessionId: SESSION_ID } });
    expect(
      parseExactWidgetQuery(
        new Request(
          `https://app.test/api/widget/config?businessId=${BUSINESS_ID}&sessionId=${SESSION_ID}&extra=1`,
        ),
      ),
    ).toEqual({ ok: false });
  });

  it("parses a strict, normalized chat body", async () => {
    const request = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
        clientMessageId: "00000000-0000-4000-8000-000000000003",
        message: "  Hello  ",
        visitorEmail: "  USER@Example.COM ",
      }),
    });
    expect(await parseWidgetJson(request, widgetChatRequestSchema)).toMatchObject({
      ok: true,
      data: { message: "Hello", visitorEmail: "user@example.com" },
    });
  });

  it("rejects unknown fields, non-JSON, and oversized bodies", async () => {
    const unknown = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
        clientMessageId: "00000000-0000-4000-8000-000000000003",
        message: "Hello",
        admin: true,
      }),
    });
    expect(await parseWidgetJson(unknown, widgetChatRequestSchema)).toEqual({ ok: false });

    const wrongType = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(await parseWidgetJson(wrongType, widgetChatRequestSchema)).toEqual({ ok: false });

    const oversized = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "12289" },
      body: "{}",
    });
    expect(await parseWidgetJson(oversized, widgetChatRequestSchema)).toEqual({ ok: false });

    const streamedOversized = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(13_000) }),
    });
    expect(await parseWidgetJson(streamedOversized, widgetChatRequestSchema))
      .toEqual({ ok: false });

    const encoded = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: "{}",
    });
    expect(await parseWidgetJson(encoded, widgetChatRequestSchema)).toEqual({
      ok: false,
    });
  });

  it("rejects control characters in visitor text fields", async () => {
    const request = new Request("https://app.test/api/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: BUSINESS_ID,
        sessionId: SESSION_ID,
        clientMessageId: "00000000-0000-4000-8000-000000000003",
        message: "Hello\u0000",
        visitorName: "Visitor\nInjected",
      }),
    });
    expect(await parseWidgetJson(request, widgetChatRequestSchema)).toEqual({
      ok: false,
    });
  });

  it("never uses wildcard CORS and always varies on Origin", async () => {
    const response = widgetErrorResponse("rate_limited", 429, {
      origin: "https://example.com",
      retryAfterSeconds: 12,
    });
    expect(response.headers.get("access-control-allow-origin"))
      .toBe("https://example.com");
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("retry-after")).toBe("12");
    expect(await response.json()).toEqual({
      error: "rate_limited",
      retryable: true,
    });
  });
});
