import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isRicherWebsiteScanEnabledForBusiness,
  RICHER_WEBSITE_SCAN_ENV,
} from "./rollout.server";

const CANARY_BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OTHER_BUSINESS_ID = "20000000-0000-4000-a000-000000000002";

describe("richer website scan rollout", () => {
  it.each(["development", "test", undefined])(
    "is available in %s builds without production flags",
    (nodeEnv) => {
      expect(
        isRicherWebsiteScanEnabledForBusiness(CANARY_BUSINESS_ID, {
          NODE_ENV: nodeEnv,
        }),
      ).toBe(true);
    },
  );

  it("fails closed in production unless explicitly enabled", () => {
    for (const value of [undefined, "", "0", "true", " 1", "1 "]) {
      expect(
        isRicherWebsiteScanEnabledForBusiness(CANARY_BUSINESS_ID, {
          NODE_ENV: "production",
          [RICHER_WEBSITE_SCAN_ENV.broad]: value,
        }),
      ).toBe(false);
    }

    expect(
      isRicherWebsiteScanEnabledForBusiness(CANARY_BUSINESS_ID, {
        NODE_ENV: "production",
        [RICHER_WEBSITE_SCAN_ENV.broad]: "1",
      }),
    ).toBe(true);
  });

  it("admits only the exact production canary while broad rollout is off", () => {
    const environment = {
      NODE_ENV: "production",
      [RICHER_WEBSITE_SCAN_ENV.broad]: "0",
      [RICHER_WEBSITE_SCAN_ENV.canaryBusinessId]: CANARY_BUSINESS_ID,
    };

    expect(
      isRicherWebsiteScanEnabledForBusiness(CANARY_BUSINESS_ID, environment),
    ).toBe(true);
    expect(
      isRicherWebsiteScanEnabledForBusiness(OTHER_BUSINESS_ID, environment),
    ).toBe(false);
  });

  it.each([
    "",
    "*",
    "business-1",
    ` ${CANARY_BUSINESS_ID}`,
    `${CANARY_BUSINESS_ID} `,
  ])("rejects malformed production canary value %j", (value) => {
    expect(
      isRicherWebsiteScanEnabledForBusiness(CANARY_BUSINESS_ID, {
        NODE_ENV: "production",
        [RICHER_WEBSITE_SCAN_ENV.canaryBusinessId]: value,
      }),
    ).toBe(false);
  });

  it("rejects a malformed server-resolved business in every environment", () => {
    expect(
      isRicherWebsiteScanEnabledForBusiness("business-1", {
        NODE_ENV: "development",
        [RICHER_WEBSITE_SCAN_ENV.broad]: "1",
      }),
    ).toBe(false);
  });
});
