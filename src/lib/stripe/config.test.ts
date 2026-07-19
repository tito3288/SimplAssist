import { afterEach, describe, expect, it, vi } from "vitest";
import { planFromStripePriceId, SUBSCRIPTION_PLANS } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("launch pricing packages", () => {
  it("keeps the approved founding prices and included SMS pools", () => {
    expect(
      Object.fromEntries(
        Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => [
          key,
          { price: plan.price, includedSmsParts: plan.includedSmsParts },
        ])
      )
    ).toEqual({
      sms_only: { price: 25, includedSmsParts: 500 },
      sms_and_chat: { price: 45, includedSmsParts: 1500 },
      full: { price: 65, includedSmsParts: 2500 },
    });
  });

  it("describes Starter as automatic template texting and manual SMS, not AI", () => {
    const starterCopy = SUBSCRIPTION_PLANS.sms_only.features.join(" ");

    expect(starterCopy).toContain("Automatic missed-call text");
    expect(starterCopy).toContain("Manual SMS inbox and replies");
    expect(starterCopy).toContain("One local SimplAssist number");
    expect(starterCopy).not.toMatch(/\bAI\b/i);
  });

  it("starts full AI conversations and Calendar in Growth", () => {
    expect(SUBSCRIPTION_PLANS.sms_and_chat.features).toEqual(
      expect.arrayContaining([
        "Full AI SMS conversations",
        "Website chat widget",
        "Google Calendar connection",
        "AI appointment scheduling",
      ])
    );
  });

  it("maps every configured Stripe base-plan Price ID to the correct plan", () => {
    vi.stubEnv("STRIPE_PRICE_SMS_ONLY", "price_test_starter");
    vi.stubEnv("STRIPE_PRICE_SMS_AND_CHAT", "price_test_growth");
    vi.stubEnv("STRIPE_PRICE_FULL", "price_test_full");

    expect(planFromStripePriceId("price_test_starter")).toBe("sms_only");
    expect(planFromStripePriceId("price_test_growth")).toBe("sms_and_chat");
    expect(planFromStripePriceId("price_test_full")).toBe("full");
  });
});
