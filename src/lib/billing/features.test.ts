import { describe, expect, it } from "vitest";

import type { SubscriptionPlan } from "@/types/database";
import {
  ALL_FEATURES,
  canPlanUseFeature,
  FEATURE_MINIMUM_PLAN,
  isSubscriptionPlan,
  planIncludesPlan,
  requiredPlanForFeature,
  type FeatureKey,
} from "./features";

const EXPECTED_FEATURES: Record<SubscriptionPlan, FeatureKey[]> = {
  sms_only: ["missed_call_sms", "manual_sms", "contacts_inbox"],
  sms_and_chat: [
    "missed_call_sms",
    "manual_sms",
    "contacts_inbox",
    "ai_sms_conversations",
    "web_chat",
    "widget_branding",
    "ai_customization",
    "calendar",
    "direct_booking",
  ],
  full: [...ALL_FEATURES],
};

describe("feature plan matrix", () => {
  it.each(["sms_only", "sms_and_chat", "full"] as const)(
    "exposes the exact inherited feature set for %s",
    (plan) => {
      const enabled = ALL_FEATURES.filter((feature) =>
        canPlanUseFeature(plan, feature)
      );

      expect(enabled).toEqual(EXPECTED_FEATURES[plan]);
    }
  );

  it("keeps every future product key reserved for Full", () => {
    const reserved: FeatureKey[] = [
      "advanced_analytics",
      "conversion_reporting",
      "weekly_summary",
      "lead_alerts",
      "review_requests",
      "follow_up_automation",
      "priority_support",
    ];

    for (const feature of reserved) {
      expect(requiredPlanForFeature(feature)).toBe("full");
      expect(canPlanUseFeature("sms_and_chat", feature)).toBe(false);
      expect(canPlanUseFeature("full", feature)).toBe(true);
    }
  });

  it("exports a complete minimum-plan lookup", () => {
    expect(ALL_FEATURES).toHaveLength(Object.keys(FEATURE_MINIMUM_PLAN).length);
    for (const feature of ALL_FEATURES) {
      expect(requiredPlanForFeature(feature)).toBe(
        FEATURE_MINIMUM_PLAN[feature]
      );
    }
  });

  it("orders plans monotonically", () => {
    expect(planIncludesPlan("sms_only", "sms_only")).toBe(true);
    expect(planIncludesPlan("sms_only", "sms_and_chat")).toBe(false);
    expect(planIncludesPlan("sms_and_chat", "sms_only")).toBe(true);
    expect(planIncludesPlan("sms_and_chat", "full")).toBe(false);
    expect(planIncludesPlan("full", "sms_and_chat")).toBe(true);
  });

  it.each([
    ["sms_only", true],
    ["sms_and_chat", true],
    ["full", true],
    ["starter", false],
    [null, false],
    [undefined, false],
  ])("validates subscription plan %#", (value, expected) => {
    expect(isSubscriptionPlan(value)).toBe(expected);
  });
});
