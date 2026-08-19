import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CHAT_ONLY_ROLLOUT_ENV,
  getChatOnlyRolloutSnapshot,
  isChatOnlyDirectAcquisitionEnabledForBusiness,
  isChatOnlyDirectSalesEnabled,
  isChatOnlyPartnerAssignmentEnabled,
} from "./chatOnlyRollout.server";

const CANARY_BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OTHER_BUSINESS_ID = "20000000-0000-4000-a000-000000000002";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chat-only acquisition rollout", () => {
  it("defaults both acquisition channels off", () => {
    expect(getChatOnlyRolloutSnapshot({})).toEqual({
      directSalesEnabled: false,
      partnerAssignmentEnabled: false,
    });
  });

  it.each(["", "0", "true", "yes", "01", " 1", "1 "])(
    "keeps truthy-looking value %j fail-closed",
    (value) => {
      const environment = {
        [CHAT_ONLY_ROLLOUT_ENV.directSales]: value,
        [CHAT_ONLY_ROLLOUT_ENV.partnerAssignment]: value,
      };

      expect(getChatOnlyRolloutSnapshot(environment)).toEqual({
        directSalesEnabled: false,
        partnerAssignmentEnabled: false,
      });
    }
  );

  it("enables only the direct channel when only its exact flag is set", () => {
    const environment = {
      [CHAT_ONLY_ROLLOUT_ENV.directSales]: "1",
      [CHAT_ONLY_ROLLOUT_ENV.partnerAssignment]: "0",
    };

    expect(isChatOnlyDirectSalesEnabled(environment)).toBe(true);
    expect(isChatOnlyPartnerAssignmentEnabled(environment)).toBe(false);
  });

  it("enables only the partner channel when only its exact flag is set", () => {
    const environment = {
      [CHAT_ONLY_ROLLOUT_ENV.directSales]: "0",
      [CHAT_ONLY_ROLLOUT_ENV.partnerAssignment]: "1",
    };

    expect(isChatOnlyDirectSalesEnabled(environment)).toBe(false);
    expect(isChatOnlyPartnerAssignmentEnabled(environment)).toBe(true);
  });

  it("reads process environment at call time instead of caching rollout state", () => {
    vi.stubEnv(CHAT_ONLY_ROLLOUT_ENV.directSales, "0");
    expect(isChatOnlyDirectSalesEnabled()).toBe(false);

    vi.stubEnv(CHAT_ONLY_ROLLOUT_ENV.directSales, "1");
    expect(isChatOnlyDirectSalesEnabled()).toBe(true);
  });

  it("admits only the exact canary business while broad direct sales stay off", () => {
    const environment = {
      [CHAT_ONLY_ROLLOUT_ENV.directSales]: "0",
      [CHAT_ONLY_ROLLOUT_ENV.directCanaryBusinessId]: CANARY_BUSINESS_ID,
    };

    expect(
      isChatOnlyDirectAcquisitionEnabledForBusiness(
        CANARY_BUSINESS_ID,
        environment,
      ),
    ).toBe(true);
    expect(
      isChatOnlyDirectAcquisitionEnabledForBusiness(
        OTHER_BUSINESS_ID,
        environment,
      ),
    ).toBe(false);
    expect(isChatOnlyDirectSalesEnabled(environment)).toBe(false);
  });

  it("compares canonical UUIDs case-insensitively", () => {
    expect(
      isChatOnlyDirectAcquisitionEnabledForBusiness(CANARY_BUSINESS_ID, {
        [CHAT_ONLY_ROLLOUT_ENV.directCanaryBusinessId]:
          CANARY_BUSINESS_ID.toUpperCase(),
      }),
    ).toBe(true);
  });

  it.each([
    "",
    "business-1",
    "10000000-0000-0000-a000-000000000001",
    "10000000-0000-4000-7000-000000000001",
    ` ${CANARY_BUSINESS_ID}`,
    `${CANARY_BUSINESS_ID} `,
    `${CANARY_BUSINESS_ID},${OTHER_BUSINESS_ID}`,
    `{${CANARY_BUSINESS_ID}}`,
  ])("fails closed for malformed canary value %j", (value) => {
    expect(
      isChatOnlyDirectAcquisitionEnabledForBusiness(CANARY_BUSINESS_ID, {
        [CHAT_ONLY_ROLLOUT_ENV.directCanaryBusinessId]: value,
      }),
    ).toBe(false);
  });

  it("preserves broad direct-sales authority independently of canary syntax", () => {
    expect(
      isChatOnlyDirectAcquisitionEnabledForBusiness(OTHER_BUSINESS_ID, {
        [CHAT_ONLY_ROLLOUT_ENV.directSales]: "1",
        [CHAT_ONLY_ROLLOUT_ENV.directCanaryBusinessId]: "malformed",
      }),
    ).toBe(true);
  });

  it("rejects a malformed server-resolved business ID even under the broad flag", () => {
    expect(
      isChatOnlyDirectAcquisitionEnabledForBusiness("business-1", {
        [CHAT_ONLY_ROLLOUT_ENV.directSales]: "1",
      }),
    ).toBe(false);
  });
});
