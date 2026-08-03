import { describe, expect, it } from "vitest";
import { isValidPartnerSlug, normalizeHostHeader } from "./hostname";

describe("normalizeHostHeader", () => {
  it.each([
    ["app.partner.example", "app.partner.example"],
    ["APP.PARTNER.EXAMPLE", "app.partner.example"],
    ["app.partner.example:443", "app.partner.example"],
    ["APP.PARTNER.EXAMPLE.:8443", "app.partner.example"],
    ["app.partner.example.", "app.partner.example"],
    ["localhost", "localhost"],
    ["localhost:3000", "localhost"],
    ["203.0.113.10:8080", "203.0.113.10"],
    [`${"a".repeat(63)}.example`, `${"a".repeat(63)}.example`],
    [
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
    ],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeHostHeader(raw)).toBe(expected);
  });

  it("keeps www and suffix lookalikes distinct for exact matching", () => {
    expect(normalizeHostHeader("www.partner.example")).toBe(
      "www.partner.example",
    );
    expect(normalizeHostHeader("partner.example.evil.test")).toBe(
      "partner.example.evil.test",
    );
  });

  it.each([
    null,
    undefined,
    "",
    " ",
    "app.partner.example ",
    "app. partner.example",
    "app.partner.example\t",
    "app.partner.example\n",
    "app.partner.example,evil.test",
    "https://app.partner.example",
    "//app.partner.example",
    "app.partner.example/path",
    "user@app.partner.example",
    "app.partner.example?query",
    "app.partner.example#fragment",
    "[::1]",
    "::1",
    "app_partner.example",
    "-app.partner.example",
    "app-.partner.example",
    ".app.partner.example",
    "app..partner.example",
    "app.partner.example..",
    "app.partner.example:",
    "app.partner.example:http",
    "app.partner.example:0",
    "app.partner.example:65536",
    "app.partner.example:80:90",
    `${"a".repeat(64)}.example`,
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
  ])("rejects malformed Host input %j", (raw) => {
    expect(normalizeHostHeader(raw)).toBeNull();
  });
});

describe("isValidPartnerSlug", () => {
  it.each(["a", "alpha-dog", "partner2", "a2p-partner", "a".repeat(63)])(
    "accepts the canonical slug %s",
    (slug) => {
      expect(isValidPartnerSlug(slug)).toBe(true);
    },
  );

  it.each([
    "",
    "Alpha-Dog",
    "alpha_dog",
    "-alpha",
    "alpha-",
    "alpha--dog",
    "alpha dog",
    "a".repeat(64),
  ])("rejects the non-canonical slug %s", (slug) => {
    expect(isValidPartnerSlug(slug)).toBe(false);
  });
});
