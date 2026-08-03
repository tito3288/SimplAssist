import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import { getPlanPresentation } from "./planPresentation";

describe("getPlanPresentation", () => {
  it("preserves the exact SimplAssist plan presentation for the default brand", () => {
    const presentation = getPlanPresentation("sms_only", "SimplAssist");

    expect(presentation).toEqual(SUBSCRIPTION_PLANS.sms_only);
    expect(presentation).not.toBe(SUBSCRIPTION_PLANS.sms_only);
    expect(presentation.features).not.toBe(
      SUBSCRIPTION_PLANS.sms_only.features,
    );
  });

  it("uses the current brand name only where plan copy names SimplAssist", () => {
    expect(
      getPlanPresentation("sms_only", "Alpha Dog Agency").features,
    ).toEqual([
      "One local Alpha Dog Agency number",
      "Automatic missed-call text",
      "Manual SMS inbox and replies",
      "500 included SMS parts/month",
      "Contact management",
      "Conversation inbox",
    ]);

    expect(getPlanPresentation("sms_and_chat", "Alpha Dog Agency")).toEqual(
      SUBSCRIPTION_PLANS.sms_and_chat,
    );
  });

  it("treats replacement-pattern characters in a validated brand name literally", () => {
    expect(getPlanPresentation("sms_only", "$& Partner").features[0]).toBe(
      "One local $& Partner number",
    );
  });
});
