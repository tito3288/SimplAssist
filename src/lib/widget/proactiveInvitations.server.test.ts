import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  arePublicWidgetProactiveInvitationsEnabledForBusiness,
  WIDGET_PROACTIVE_INVITATIONS_ENV,
} from "./proactiveInvitations.server";

const CANARY_BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OTHER_BUSINESS_ID = "20000000-0000-4000-a000-000000000002";

describe("public widget proactive-invitation runtime gate", () => {
  it("enables public delivery only for the exact value 1", () => {
    for (const value of [undefined, "", "0", "true", "TRUE", " 1", "1 "]) {
      expect(
        arePublicWidgetProactiveInvitationsEnabledForBusiness(
          CANARY_BUSINESS_ID,
          { [WIDGET_PROACTIVE_INVITATIONS_ENV.broad]: value },
        ),
      ).toBe(false);
    }

    expect(
      arePublicWidgetProactiveInvitationsEnabledForBusiness(
        CANARY_BUSINESS_ID,
        { [WIDGET_PROACTIVE_INVITATIONS_ENV.broad]: "1" },
      ),
    ).toBe(true);
  });

  it("admits only the exact canary business while the broad switch is off", () => {
    const environment = {
      [WIDGET_PROACTIVE_INVITATIONS_ENV.broad]: "0",
      [WIDGET_PROACTIVE_INVITATIONS_ENV.canaryBusinessId]:
        CANARY_BUSINESS_ID,
    };

    expect(
      arePublicWidgetProactiveInvitationsEnabledForBusiness(
        CANARY_BUSINESS_ID,
        environment,
      ),
    ).toBe(true);
    expect(
      arePublicWidgetProactiveInvitationsEnabledForBusiness(
        OTHER_BUSINESS_ID,
        environment,
      ),
    ).toBe(false);
  });

  it("compares otherwise-canonical UUIDs case-insensitively", () => {
    expect(
      arePublicWidgetProactiveInvitationsEnabledForBusiness(
        CANARY_BUSINESS_ID,
        {
          [WIDGET_PROACTIVE_INVITATIONS_ENV.canaryBusinessId]:
            CANARY_BUSINESS_ID.toUpperCase(),
        },
      ),
    ).toBe(true);
  });

  it.each([
    "",
    "*",
    "business-1",
    ` ${CANARY_BUSINESS_ID}`,
    `${CANARY_BUSINESS_ID} `,
    `${CANARY_BUSINESS_ID},${OTHER_BUSINESS_ID}`,
    `{${CANARY_BUSINESS_ID}}`,
  ])("fails closed for malformed canary value %j", (value) => {
    expect(
      arePublicWidgetProactiveInvitationsEnabledForBusiness(
        CANARY_BUSINESS_ID,
        {
          [WIDGET_PROACTIVE_INVITATIONS_ENV.canaryBusinessId]: value,
        },
      ),
    ).toBe(false);
  });

  it("rejects a malformed server-resolved business even under the broad switch", () => {
    expect(
      arePublicWidgetProactiveInvitationsEnabledForBusiness("business-1", {
        [WIDGET_PROACTIVE_INVITATIONS_ENV.broad]: "1",
      }),
    ).toBe(false);
  });
});
