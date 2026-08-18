import { describe, expect, it } from "vitest";
import { parseAdminAccountFilters } from "./accountFilters";

const PARTNER_ID = "9C3C5B98-BDA7-48EA-A972-22C1AB4D2F71";

describe("parseAdminAccountFilters", () => {
  it("normalizes missing parameters to all filters", () => {
    expect(parseAdminAccountFilters(undefined)).toEqual({
      lifecycle: null,
      ownership: null,
      partnerId: null,
      plan: null,
      query: null,
    });
    expect(parseAdminAccountFilters({})).toEqual({
      lifecycle: null,
      ownership: null,
      partnerId: null,
      plan: null,
      query: null,
    });
  });

  it.each([
    "live",
    "onboarding",
    "past_due",
    "suspended",
    "pending_deletion",
    "failed_setup",
  ] as const)("accepts the %s lifecycle predicate", (lifecycle) => {
    expect(parseAdminAccountFilters({ lifecycle }).lifecycle).toBe(lifecycle);
  });

  it.each(["direct", "partner"] as const)(
    "accepts the %s ownership filter",
    (ownership) => {
      expect(parseAdminAccountFilters({ ownership }).ownership).toBe(
        ownership,
      );
    },
  );

  it.each(["chat_only", "sms_only", "sms_and_chat", "full"] as const)(
    "accepts the %s plan",
    (plan) => {
      expect(parseAdminAccountFilters({ plan }).plan).toBe(plan);
    },
  );

  it("combines valid filters, trims search, and canonicalizes a partner UUID", () => {
    expect(
      parseAdminAccountFilters({
        lifecycle: "failed_setup",
        ownership: "partner",
        partner: PARTNER_ID,
        plan: "full",
        q: "  River City Dental  ",
      }),
    ).toEqual({
      lifecycle: "failed_setup",
      ownership: "partner",
      partnerId: PARTNER_ID.toLowerCase(),
      plan: "full",
      query: "River City Dental",
    });
  });

  it("ignores a partner unless partner ownership is valid", () => {
    expect(
      parseAdminAccountFilters({ ownership: "direct", partner: PARTNER_ID })
        .partnerId,
    ).toBeNull();
    expect(parseAdminAccountFilters({ partner: PARTNER_ID }).partnerId).toBeNull();
    expect(
      parseAdminAccountFilters({
        ownership: ["partner", "direct"],
        partner: PARTNER_ID,
      }).partnerId,
    ).toBeNull();
  });

  it("normalizes invalid values independently without discarding valid filters", () => {
    expect(
      parseAdminAccountFilters({
        lifecycle: "active",
        ownership: "customer",
        partner: "not-a-uuid",
        plan: "enterprise",
        q: "  Acme  ",
      }),
    ).toEqual({
      lifecycle: null,
      ownership: null,
      partnerId: null,
      plan: null,
      query: "Acme",
    });
  });

  it("treats every repeated filter as all instead of choosing a value", () => {
    expect(
      parseAdminAccountFilters({
        lifecycle: ["live"],
        ownership: ["partner"],
        partner: [PARTNER_ID],
        plan: ["full"],
        q: ["Acme"],
      }),
    ).toEqual({
      lifecycle: null,
      ownership: null,
      partnerId: null,
      plan: null,
      query: null,
    });
  });

  it("accepts a trimmed 100-character search and rejects longer or empty searches", () => {
    const oneHundredCharacters = `${"a".repeat(99)}🚀`;

    expect(
      parseAdminAccountFilters({ q: `  ${oneHundredCharacters}  ` }).query,
    ).toBe(oneHundredCharacters);
    expect(
      parseAdminAccountFilters({ q: `${oneHundredCharacters}x` }).query,
    ).toBeNull();
    expect(parseAdminAccountFilters({ q: "  \n\t " }).query).toBeNull();
  });

  it("does not trim or partially match enum and UUID filters", () => {
    expect(
      parseAdminAccountFilters({
        lifecycle: " live ",
        ownership: "Partner",
        partner: ` ${PARTNER_ID}`,
        plan: "fuller",
      }),
    ).toEqual({
      lifecycle: null,
      ownership: null,
      partnerId: null,
      plan: null,
      query: null,
    });
    expect(
      parseAdminAccountFilters({ lifecycle: "Suspended" }).lifecycle,
    ).toBeNull();
  });
});
