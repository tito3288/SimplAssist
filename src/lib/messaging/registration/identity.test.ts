import { describe, expect, it } from "vitest";
import {
  compareExistingBrandIdentity,
  normalizeEinDigits,
  normalizeFiveDigitZip,
  normalizeLegalBusinessName,
  normalizeTelnyxEntityType,
  toTelnyxEntityType,
} from "./identity";

const localIdentity = {
  ein: "12-3456789",
  legal_business_name: "Simpl Assist, LLC",
  business_entity_type: "llc" as const,
  state: "Indiana",
  zip: "46204",
};

const providerIdentity = {
  ein: "123456789",
  companyName: "  simpl   assist, llc ",
  entityType: "PRIVATE_PROFIT",
  state: "IN",
  postalCode: "46204-1234",
};

describe("existing-brand identity normalization", () => {
  it.each([
    ["llc", "PRIVATE_PROFIT"],
    ["c_corp", "PRIVATE_PROFIT"],
    ["s_corp", "PRIVATE_PROFIT"],
    ["partnership", "PRIVATE_PROFIT"],
    ["nonprofit", "NON_PROFIT"],
    ["sole_proprietor", "SOLE_PROPRIETOR"],
  ] as const)("maps local %s to Telnyx %s", (local, provider) => {
    expect(toTelnyxEntityType(local)).toBe(provider);
  });

  it("normalizes the fields used for provider comparison", () => {
    expect(normalizeEinDigits("12-3456789")).toBe("123456789");
    expect(normalizeEinDigits("1234")).toBeNull();
    expect(normalizeLegalBusinessName("  Acme\tServices  LLC ")).toBe(
      "ACME SERVICES LLC"
    );
    expect(normalizeFiveDigitZip("46204-1234")).toBe("46204");
    expect(normalizeFiveDigitZip("4620")).toBeNull();
    expect(normalizeTelnyxEntityType(" private_profit ")).toBe(
      "PRIVATE_PROFIT"
    );
    expect(normalizeTelnyxEntityType("future_value")).toBeNull();
  });

  it("accepts normalized EIN, legal name, broad entity, address state, and ZIP", () => {
    expect(compareExistingBrandIdentity(providerIdentity, localIdentity)).toEqual({
      matches: true,
      mismatchedFields: [],
    });
  });

  it("uses universalEin when it agrees with the submitted EIN", () => {
    expect(
      compareExistingBrandIdentity(
        { ...providerIdentity, universalEin: "12-3456789" },
        localIdentity
      )
    ).toEqual({ matches: true, mismatchedFields: [] });
  });

  it("fails closed when provider EIN fields conflict without exposing either value", () => {
    const result = compareExistingBrandIdentity(
      {
        ...providerIdentity,
        ein: "123456789",
        universalEin: "987654321",
      },
      localIdentity
    );

    expect(result).toEqual({ matches: false, mismatchedFields: ["ein"] });
    expect(JSON.stringify(result)).not.toContain("123456789");
    expect(JSON.stringify(result)).not.toContain("987654321");
  });

  it("fails closed when one of two populated provider EIN fields is malformed", () => {
    const result = compareExistingBrandIdentity(
      {
        ...providerIdentity,
        ein: "123456789",
        universalEin: "malformed",
      },
      localIdentity
    );

    expect(result).toEqual({ matches: false, mismatchedFields: ["ein"] });
  });

  it.each([
    ["ein", { ein: "98-7654321" }],
    ["legal_name", { companyName: "Different Company LLC" }],
    ["entity_type", { entityType: "NON_PROFIT" }],
    ["state", { state: "OH" }],
    ["zip", { postalCode: "44114" }],
  ] as const)("reports only the safe %s field name on mismatch", (field, patch) => {
    const result = compareExistingBrandIdentity(
      { ...providerIdentity, ...patch },
      localIdentity
    );

    expect(result).toEqual({ matches: false, mismatchedFields: [field] });
  });
});
