import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BusinessOperationalControls,
  OperationalService,
} from "@/types/database";

const mocks = vi.hoisted(() => ({
  resolveControls: vi.fn(),
  resolveBlock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/account/operationalControls.server", () => ({
  resolveBusinessOperationalControls: mocks.resolveControls,
  resolveOperationalBlockReason: mocks.resolveBlock,
}));

import {
  decideOutboundSmsOperationalAccess,
  outboundSmsOperationalBlockMessage,
  resolveOutboundSmsOperationalAccess,
  type OutboundSmsPurpose,
} from "./outboundSmsOperational.server";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000048";
const PAUSED_AT = "2026-08-04T12:00:00.000Z";

const activeControls: BusinessOperationalControls = {
  businessId: BUSINESS_ID,
  operationsSuspendedAt: null,
  aiRepliesPausedAt: null,
  textingPausedAt: null,
  bookingsPausedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveControls.mockResolvedValue(activeControls);
  mocks.resolveBlock.mockImplementation(
    (
      controls: BusinessOperationalControls,
      services: readonly OperationalService[],
    ) => {
      if (controls.operationsSuspendedAt) return "account_suspended";
      for (const service of services) {
        if (service === "texting" && controls.textingPausedAt) {
          return "texting_paused";
        }
        if (service === "ai_replies" && controls.aiRepliesPausedAt) {
          return "ai_replies_paused";
        }
      }
      return null;
    },
  );
});

describe("outbound SMS operational access", () => {
  it.each([
    ["manual_dashboard_send", ["texting"]],
    ["missed_call", ["texting"]],
    ["ai_reply", ["texting", "ai_replies"]],
    ["mms_fallback", ["texting", "ai_replies"]],
  ] satisfies Array<[OutboundSmsPurpose, OperationalService[]]>)(
    "uses the exact service precedence for %s",
    (purpose, services) => {
      expect(decideOutboundSmsOperationalAccess(activeControls, purpose)).toEqual(
        { allowed: true },
      );
      expect(mocks.resolveBlock).toHaveBeenCalledWith(activeControls, services);
    },
  );

  it("gives suspension precedence over independent service pauses", () => {
    const controls = {
      ...activeControls,
      operationsSuspendedAt: PAUSED_AT,
      textingPausedAt: PAUSED_AT,
      aiRepliesPausedAt: PAUSED_AT,
    };

    expect(decideOutboundSmsOperationalAccess(controls, "ai_reply")).toEqual({
      allowed: false,
      reason: "account_suspended",
    });
  });

  it("gives texting precedence over AI for automated SMS", () => {
    const controls = {
      ...activeControls,
      textingPausedAt: PAUSED_AT,
      aiRepliesPausedAt: PAUSED_AT,
    };

    expect(decideOutboundSmsOperationalAccess(controls, "ai_reply")).toEqual({
      allowed: false,
      reason: "texting_paused",
    });
    expect(
      decideOutboundSmsOperationalAccess(controls, "mms_fallback"),
    ).toEqual({ allowed: false, reason: "texting_paused" });
  });

  it("lets an AI pause block AI and MMS without blocking manual or missed-call SMS", () => {
    const controls = { ...activeControls, aiRepliesPausedAt: PAUSED_AT };

    expect(decideOutboundSmsOperationalAccess(controls, "ai_reply")).toEqual({
      allowed: false,
      reason: "ai_replies_paused",
    });
    expect(
      decideOutboundSmsOperationalAccess(controls, "mms_fallback"),
    ).toEqual({ allowed: false, reason: "ai_replies_paused" });
    expect(
      decideOutboundSmsOperationalAccess(controls, "manual_dashboard_send"),
    ).toEqual({ allowed: true });
    expect(
      decideOutboundSmsOperationalAccess(controls, "missed_call"),
    ).toEqual({ allowed: true });
  });

  it("ignores booking pauses for every SMS purpose", () => {
    const controls = { ...activeControls, bookingsPausedAt: PAUSED_AT };

    for (const purpose of [
      "manual_dashboard_send",
      "ai_reply",
      "mms_fallback",
      "missed_call",
    ] satisfies OutboundSmsPurpose[]) {
      expect(decideOutboundSmsOperationalAccess(controls, purpose)).toEqual({
        allowed: true,
      });
    }
  });

  it("fails closed if a future SMS purpose unexpectedly requests bookings", () => {
    mocks.resolveBlock.mockReturnValueOnce("bookings_paused");

    expect(() =>
      decideOutboundSmsOperationalAccess(activeControls, "ai_reply"),
    ).toThrow("Unexpected booking block");
  });

  it("performs a fresh resolver call and propagates indeterminate state", async () => {
    const failure = new Error("temporary operational lookup failure");
    mocks.resolveControls.mockRejectedValueOnce(failure);

    await expect(
      resolveOutboundSmsOperationalAccess(BUSINESS_ID, "missed_call"),
    ).rejects.toBe(failure);
    expect(mocks.resolveControls).toHaveBeenCalledOnce();
    expect(mocks.resolveControls).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("returns fixed customer-safe block messages with no administrative reason", () => {
    expect(outboundSmsOperationalBlockMessage("account_suspended")).toBe(
      "Account operations are suspended. SMS sending will remain unavailable until the account is reactivated.",
    );
    expect(outboundSmsOperationalBlockMessage("texting_paused")).toContain(
      "Texting is paused",
    );
    expect(outboundSmsOperationalBlockMessage("ai_replies_paused")).toContain(
      "AI replies are paused",
    );
  });
});
