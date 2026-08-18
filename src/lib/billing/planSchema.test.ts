import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_PLAN_IDS } from "@/types/database";
import { subscriptionPlanSchema } from "./planSchema";

describe("subscriptionPlanSchema", () => {
  it("recognizes every canonical product identifier, including chat-only", () => {
    expect(SUBSCRIPTION_PLAN_IDS).toEqual([
      "chat_only",
      "sms_only",
      "sms_and_chat",
      "full",
    ]);
    for (const plan of SUBSCRIPTION_PLAN_IDS) {
      expect(subscriptionPlanSchema.parse(plan)).toBe(plan);
    }
  });

  it.each([null, "", "starter", "chat", "chat_only "])(
    "rejects noncanonical plan value %j",
    (value) => {
      expect(subscriptionPlanSchema.safeParse(value).success).toBe(false);
    },
  );
});
