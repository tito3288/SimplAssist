import { describe, expect, it } from "vitest";
import {
  buildProviderResourceName,
  TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES,
} from "./providerResourceName";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000381";
const SUFFIX = `(${BUSINESS_ID})`;
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

describe("buildProviderResourceName", () => {
  it("preserves a short ASCII name byte-for-byte", () => {
    expect(buildProviderResourceName("Test Business LLC", BUSINESS_ID)).toBe(
      `Test Business LLC ${SUFFIX}`
    );
  });

  it("preserves a name at the exact 64-byte boundary", () => {
    const leadingName = "1234567890123456789012345";
    const expected = `${leadingName} ${SUFFIX}`;

    expect(utf8ByteLength(expected)).toBe(
      TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES
    );
    expect(buildProviderResourceName(leadingName, BUSINESS_ID)).toBe(expected);
  });

  it("clamps only the leading ASCII name and budgets for the marker", () => {
    const result = buildProviderResourceName(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      BUSINESS_ID
    );

    expect(result).toBe(`ABCDEFGHIJKLMNOPQRSTUV... ${SUFFIX}`);
    expect(utf8ByteLength(result)).toBe(
      TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES
    );
    expect(result.endsWith(SUFFIX)).toBe(true);
  });

  it("preserves a short accented name byte-for-byte", () => {
    const leadingName = "Café Crème";

    expect(buildProviderResourceName(leadingName, BUSINESS_ID)).toBe(
      `${leadingName} ${SUFFIX}`
    );
  });

  it("clamps accented characters without splitting their UTF-8 encoding", () => {
    const result = buildProviderResourceName("É".repeat(13), BUSINESS_ID);

    expect(result).toBe(`${"É".repeat(11)}... ${SUFFIX}`);
    expect(utf8ByteLength(result)).toBe(
      TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES
    );
    expect(result).not.toContain("�");
  });

  it("clamps CJK characters at complete code-point boundaries", () => {
    const result = buildProviderResourceName("界".repeat(9), BUSINESS_ID);

    expect(result).toBe(`${"界".repeat(7)}... ${SUFFIX}`);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(
      TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES
    );
    expect(result).not.toContain("�");
  });

  it("clamps emoji without splitting surrogate pairs", () => {
    const result = buildProviderResourceName("🏠".repeat(7), BUSINESS_ID);

    expect(result).toBe(`${"🏠".repeat(5)}... ${SUFFIX}`);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(
      TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES
    );
    expect(result).not.toContain("�");
  });

  it("removes whitespace only from the truncation edge", () => {
    const result = buildProviderResourceName(
      "12345678901234567890  Overflow",
      BUSINESS_ID
    );

    expect(result).toBe(`12345678901234567890... ${SUFFIX}`);
  });

  it("throws rather than altering a suffix that cannot fit", () => {
    expect(() => buildProviderResourceName("A", "x".repeat(61))).toThrow(
      "Business id suffix cannot fit within 64 UTF-8 bytes"
    );
  });
});
