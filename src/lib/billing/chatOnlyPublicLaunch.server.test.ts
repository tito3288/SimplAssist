import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isChatOnlyPublicLaunchEnabled } from "./chatOnlyPublicLaunch.server";

const VALID_CHAT_PRICE = "price_live_chat_only";
const CANARY_BUSINESS_ID = "11111111-1111-4111-8111-111111111111";

describe("Chat Only public launch policy", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["zero", "0"],
    ["truthy-looking", "true"],
    ["padded", " 1"],
  ])("fails closed when the broad direct flag is %s", (_label, flag) => {
    expect(
      isChatOnlyPublicLaunchEnabled({
        CHAT_ONLY_DIRECT_SALES_ENABLED: flag,
        STRIPE_PRICE_CHAT_ONLY: VALID_CHAT_PRICE,
      }),
    ).toBe(false);
  });

  it("never treats the exact-business canary as public launch authority", () => {
    expect(
      isChatOnlyPublicLaunchEnabled({
        CHAT_ONLY_DIRECT_SALES_ENABLED: "0",
        CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: CANARY_BUSINESS_ID,
        STRIPE_PRICE_CHAT_ONLY: VALID_CHAT_PRICE,
      }),
    ).toBe(false);
  });

  it("never treats partner assignment as public launch authority", () => {
    expect(
      isChatOnlyPublicLaunchEnabled({
        CHAT_ONLY_DIRECT_SALES_ENABLED: "0",
        CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: "1",
        STRIPE_PRICE_CHAT_ONLY: VALID_CHAT_PRICE,
      }),
    ).toBe(false);
  });

  it.each([undefined, "", "not_a_price", "price_"])(
    "fails closed with broad authority but invalid Price %j",
    (price) => {
      expect(
        isChatOnlyPublicLaunchEnabled({
          CHAT_ONLY_DIRECT_SALES_ENABLED: "1",
          STRIPE_PRICE_CHAT_ONLY: price,
        }),
      ).toBe(false);
    },
  );

  it.each([
    "STRIPE_PRICE_SMS_ONLY",
    "STRIPE_PRICE_SMS_AND_CHAT",
    "STRIPE_PRICE_FULL",
    "STRIPE_PRICE_SETUP_FEE",
    "STRIPE_PRICE_SMS_OVERAGE_PART",
  ])("fails closed when the Chat Price collides with %s", (envName) => {
    expect(
      isChatOnlyPublicLaunchEnabled({
        CHAT_ONLY_DIRECT_SALES_ENABLED: "1",
        STRIPE_PRICE_CHAT_ONLY: VALID_CHAT_PRICE,
        [envName]: VALID_CHAT_PRICE,
      }),
    ).toBe(false);
  });

  it("opens only for exact broad authority plus a valid distinct Price", () => {
    expect(
      isChatOnlyPublicLaunchEnabled({
        CHAT_ONLY_DIRECT_SALES_ENABLED: "1",
        CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: CANARY_BUSINESS_ID,
        CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: "1",
        STRIPE_PRICE_CHAT_ONLY: VALID_CHAT_PRICE,
        STRIPE_PRICE_SMS_ONLY: "price_live_starter",
        STRIPE_PRICE_SMS_AND_CHAT: "price_live_growth",
        STRIPE_PRICE_FULL: "price_live_full",
        STRIPE_PRICE_SETUP_FEE: "price_live_setup",
        STRIPE_PRICE_SMS_OVERAGE_PART: "price_live_overage",
      }),
    ).toBe(true);
  });
});
