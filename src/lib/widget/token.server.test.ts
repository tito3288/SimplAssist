import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mintWidgetToken,
  readWidgetBearerToken,
  verifyWidgetToken,
} from "./token.server";

const SECRET = "s".repeat(32);
const NOW = new Date("2026-08-18T12:00:00.000Z");
const BINDING = {
  businessId: "00000000-0000-4000-8000-000000000001",
  origin: "https://example.com",
  sessionId: "00000000-0000-4000-8000-000000000002",
};
const NONCE = "abcdefghijklmnopqrstuvwx";

describe("widget session tokens", () => {
  it("mints a five-minute token and verifies its complete binding", () => {
    const minted = mintWidgetToken(BINDING, {
      secret: SECRET,
      now: NOW,
      nonce: NONCE,
    });

    expect(minted).toMatchObject({
      sessionNonce: NONCE,
      expiresAt: "2026-08-18T12:05:00.000Z",
    });
    expect(
      verifyWidgetToken(
        minted.token,
        { ...BINDING, sessionNonce: NONCE },
        { secret: SECRET, now: NOW },
      ),
    ).toBe(true);
  });

  it.each([
    ["business", { businessId: "00000000-0000-4000-8000-000000000099" }],
    ["origin", { origin: "https://evil.test" }],
    ["session", { sessionId: "00000000-0000-4000-8000-000000000099" }],
    ["nonce", { sessionNonce: "zyxwvutsrqponmlkjihgfedc" }],
  ])("rejects replay across %s", (_label, override) => {
    const minted = mintWidgetToken(BINDING, {
      secret: SECRET,
      now: NOW,
      nonce: NONCE,
    });
    expect(
      verifyWidgetToken(
        minted.token,
        { ...BINDING, sessionNonce: NONCE, ...override },
        { secret: SECRET, now: NOW },
      ),
    ).toBe(false);
  });

  it("rejects expiration and a tampered signature", () => {
    const minted = mintWidgetToken(BINDING, {
      secret: SECRET,
      now: NOW,
      nonce: NONCE,
    });
    expect(
      verifyWidgetToken(
        minted.token,
        { ...BINDING, sessionNonce: NONCE },
        { secret: SECRET, now: new Date("2026-08-18T12:05:00.000Z") },
      ),
    ).toBe(false);

    const last = minted.token.at(-1)!;
    const tampered = `${minted.token.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    expect(
      verifyWidgetToken(
        tampered,
        { ...BINDING, sessionNonce: NONCE },
        { secret: SECRET, now: NOW },
      ),
    ).toBe(false);
  });

  it("requires a strong dedicated secret", () => {
    expect(() => mintWidgetToken(BINDING, { secret: "short", now: NOW }))
      .toThrow(/at least 32 bytes/);
  });

  it("extracts only one canonical Bearer credential", () => {
    expect(
      readWidgetBearerToken(
        new Request("https://app.test", {
          headers: { Authorization: "Bearer v1.payload.signature" },
        }),
      ),
    ).toBe("v1.payload.signature");
    expect(
      readWidgetBearerToken(
        new Request("https://app.test", {
          headers: { Authorization: "bearer v1.payload.signature" },
        }),
      ),
    ).toBeNull();
    expect(
      readWidgetBearerToken(
        new Request("https://app.test", {
          headers: { Authorization: "Bearer one, Bearer two" },
        }),
      ),
    ).toBeNull();
  });
});
