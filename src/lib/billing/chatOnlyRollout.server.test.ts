import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CHAT_ONLY_ROLLOUT_ENV,
  getChatOnlyRolloutSnapshot,
  isChatOnlyDirectSalesEnabled,
  isChatOnlyPartnerAssignmentEnabled,
} from "./chatOnlyRollout.server";

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
});
