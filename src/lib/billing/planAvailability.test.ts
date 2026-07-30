import { describe, expect, it } from "vitest";
import type { SubscriptionPlan } from "@/types/database";
import {
  availablePlanOrFallback,
  getPlanSalesStatus,
  isPlanAvailable,
  paidPlanForOnboardingRetry,
  PLAN_SALES_STATUS,
} from "./planAvailability";

describe("plan sales availability", () => {
  it("keeps Starter and Growth available while Full Suite is coming soon", () => {
    expect(PLAN_SALES_STATUS).toEqual({
      sms_only: "available",
      sms_and_chat: "available",
      full: "coming_soon",
    });
  });

  it.each([
    ["sms_only", true],
    ["sms_and_chat", true],
    ["full", false],
  ] satisfies [SubscriptionPlan, boolean][])(
    "reports whether %s can start a new sale",
    (plan, expected) => {
      expect(isPlanAvailable(plan)).toBe(expected);
      expect(getPlanSalesStatus(plan)).toBe(
        expected ? "available" : "coming_soon"
      );
    }
  );

  it("replaces an unavailable saved Full selection with Growth", () => {
    expect(availablePlanOrFallback("full", "sms_and_chat")).toBe(
      "sms_and_chat"
    );
    expect(availablePlanOrFallback("sms_only", "sms_and_chat")).toBe(
      "sms_only"
    );
  });

  it("preserves Full only for an already-paid onboarding retry", () => {
    expect(paidPlanForOnboardingRetry("full", "active")).toBe("full");
    expect(paidPlanForOnboardingRetry("full", "trialing")).toBe("full");
    expect(paidPlanForOnboardingRetry("full", "past_due")).toBeNull();
    expect(paidPlanForOnboardingRetry("full", "canceled")).toBeNull();
    expect(paidPlanForOnboardingRetry("full", null)).toBeNull();
  });
});
