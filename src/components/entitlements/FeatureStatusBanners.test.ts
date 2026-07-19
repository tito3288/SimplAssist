import { describe, expect, it } from "vitest";
import {
  pausedFeaturesStorageKey,
  shouldShowPaymentWarning,
} from "./statusBannerState";

describe("feature status banner state", () => {
  it("keeps dismissal stable across feature ordering", () => {
    const base = {
      businessId: "business-1",
      plan: "sms_only",
      status: "active",
    };

    expect(
      pausedFeaturesStorageKey({
        ...base,
        pausedFeatures: ["Website chat widget", "AI SMS conversations"],
      })
    ).toBe(
      pausedFeaturesStorageKey({
        ...base,
        pausedFeatures: ["AI SMS conversations", "Website chat widget"],
      })
    );
  });

  it("reappears after the plan, status, or paused feature signature changes", () => {
    const original = pausedFeaturesStorageKey({
      businessId: "business-1",
      plan: "sms_only",
      status: "active",
      pausedFeatures: ["AI SMS conversations"],
    });

    expect(
      pausedFeaturesStorageKey({
        businessId: "business-1",
        plan: "sms_only",
        status: "past_due",
        pausedFeatures: ["AI SMS conversations"],
      })
    ).not.toBe(original);
    expect(
      pausedFeaturesStorageKey({
        businessId: "business-1",
        plan: "sms_only",
        status: "active",
        pausedFeatures: ["AI SMS conversations", "Website chat widget"],
      })
    ).not.toBe(original);
  });

  it("shows the payment warning only during Stripe recovery", () => {
    expect(shouldShowPaymentWarning("past_due")).toBe(true);
    expect(shouldShowPaymentWarning("active")).toBe(false);
    expect(shouldShowPaymentWarning("trialing")).toBe(false);
    expect(shouldShowPaymentWarning("canceled")).toBe(false);
  });
});
