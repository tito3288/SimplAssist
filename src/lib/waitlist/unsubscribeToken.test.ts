import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createWaitlistUnsubscribeToken,
  verifyWaitlistUnsubscribeToken,
} from "./unsubscribeToken";

const SIGNUP_ID = "4f3e6823-e07c-4b7f-a643-ff0c2625850d";
const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

describe("waitlist unsubscribe tokens", () => {
  it("creates and verifies the documented token shape", () => {
    const token = createWaitlistUnsubscribeToken(SIGNUP_ID, SECRET_A);

    expect(token).toMatch(
      /^v1\.4f3e6823-e07c-4b7f-a643-ff0c2625850d\.[A-Za-z0-9_-]{43}$/
    );
    expect(verifyWaitlistUnsubscribeToken(token, SECRET_A)).toBe(SIGNUP_ID);
  });

  it("rejects a tampered signature", () => {
    const token = createWaitlistUnsubscribeToken(SIGNUP_ID, SECRET_A);
    const signature = token.split(".")[2];
    const replacement = signature[0] === "A" ? "B" : "A";
    const tampered = token.replace(
      signature,
      `${replacement}${signature.slice(1)}`
    );

    expect(verifyWaitlistUnsubscribeToken(tampered, SECRET_A)).toBeNull();
  });

  it("rejects a non-canonical base64url spelling of the same signature", () => {
    const token = createWaitlistUnsubscribeToken(SIGNUP_ID, SECRET_A);
    const [version, signupId, signature] = token.split(".");
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const canonicalLastIndex = alphabet.indexOf(signature.at(-1) ?? "");
    const alternateLastIndex =
      Math.floor(canonicalLastIndex / 16) * 16 +
      ((canonicalLastIndex % 16) + 1) % 16;
    const alternateSignature =
      signature.slice(0, -1) + alphabet[alternateLastIndex];

    expect(
      Buffer.from(alternateSignature, "base64url").equals(
        Buffer.from(signature, "base64url")
      )
    ).toBe(true);
    expect(
      verifyWaitlistUnsubscribeToken(
        `${version}.${signupId}.${alternateSignature}`,
        SECRET_A
      )
    ).toBeNull();
  });

  it.each([
    "",
    "v1",
    `v2.${SIGNUP_ID}.signature`,
    `v1.not-a-uuid.${"a".repeat(43)}`,
    `v1.${SIGNUP_ID}.not+base64url`,
    `v1.${SIGNUP_ID}.${"a".repeat(42)}`,
    `v1.${SIGNUP_ID.toUpperCase()}.${"a".repeat(43)}`,
    `v1.${SIGNUP_ID}.${"a".repeat(43)}.extra`,
  ])("rejects malformed token %j", (token) => {
    expect(verifyWaitlistUnsubscribeToken(token, SECRET_A)).toBeNull();
  });

  it("rejects a valid token under the wrong secret", () => {
    const token = createWaitlistUnsubscribeToken(SIGNUP_ID, SECRET_A);

    expect(verifyWaitlistUnsubscribeToken(token, SECRET_B)).toBeNull();
  });

  it("requires at least 32 bytes of secret material", () => {
    expect(() =>
      createWaitlistUnsubscribeToken(SIGNUP_ID, "too-short")
    ).toThrow(/at least 32 bytes/);
    expect(() =>
      verifyWaitlistUnsubscribeToken("anything", "too-short")
    ).toThrow(/at least 32 bytes/);
  });

  it("rejects a non-UUID signup id when signing", () => {
    expect(() =>
      createWaitlistUnsubscribeToken("not-a-uuid", SECRET_A)
    ).toThrow(/valid waitlist signup UUID/);
  });
});
