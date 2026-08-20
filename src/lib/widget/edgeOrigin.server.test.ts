import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  WIDGET_EDGE_ORIGIN_HEADER,
  requireWidgetEdgeOrigin,
  verifyWidgetEdgeOrigin,
} from "./edgeOrigin.server";

const SECRET = "a".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function request(marker?: string) {
  const headers = new Headers();
  if (marker !== undefined) headers.set(WIDGET_EDGE_ORIGIN_HEADER, marker);
  return new Request("https://simplassist.com/api/widget/config", { headers });
}

describe("widget edge-origin attestation", () => {
  it("accepts the exact configured server-only marker", () => {
    expect(verifyWidgetEdgeOrigin(request(SECRET), SECRET)).toBe("verified");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(129)],
    ["whitespace", `${"a".repeat(63)} a`],
    ["list-valued", `${SECRET},${SECRET}`],
    ["non-base64url characters", `${"a".repeat(63)}=`],
  ])("treats a %s request marker as forbidden", (_label, marker) => {
    expect(verifyWidgetEdgeOrigin(request(marker), SECRET)).toBe("forbidden");
  });

  it("rejects a different same-shape marker", () => {
    expect(verifyWidgetEdgeOrigin(request("b".repeat(64)), SECRET)).toBe(
      "forbidden",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(129)],
    ["whitespace", ` ${"a".repeat(64)}`],
    ["invalid characters", `${"a".repeat(63)}=`],
  ])("fails closed when the %s server secret is configured", (_label, secret) => {
    expect(verifyWidgetEdgeOrigin(request(SECRET), secret)).toBe(
      "unavailable",
    );
  });

  it("maps unavailable configuration to a private retryable 503", async () => {
    vi.stubEnv("WIDGET_EDGE_ORIGIN_SECRET", "");

    const response = requireWidgetEdgeOrigin(request(SECRET));

    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: "service_unavailable",
      retryable: true,
    });
    expect(response?.headers.get("access-control-allow-origin")).toBeNull();
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("vary")).toContain("Origin");
  });

  it("maps a bad request marker to a private 403 without logging secrets", async () => {
    vi.stubEnv("WIDGET_EDGE_ORIGIN_SECRET", SECRET);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = requireWidgetEdgeOrigin(request("b".repeat(64)));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "origin_not_allowed" });
    expect(response?.headers.get("access-control-allow-origin")).toBeNull();
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("vary")).toContain("Origin");
    expect(error).not.toHaveBeenCalled();
  });
});
