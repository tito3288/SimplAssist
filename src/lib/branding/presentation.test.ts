import { describe, expect, it } from "vitest";
import { replaceDefaultBrandName } from "./presentation";

describe("replaceDefaultBrandName", () => {
  it("preserves exact default copy and replaces every partner presentation", () => {
    expect(
      replaceDefaultBrandName("SimplAssist support — SimplAssist", "SimplAssist"),
    ).toBe("SimplAssist support — SimplAssist");
    expect(
      replaceDefaultBrandName(
        "SimplAssist support — SimplAssist",
        "Alpha Dog Agency",
      ),
    ).toBe("Alpha Dog Agency support — Alpha Dog Agency");
  });

  it("treats replacement-pattern characters literally", () => {
    expect(replaceDefaultBrandName("SimplAssist", "$& Partner")).toBe(
      "$& Partner",
    );
  });

  it("rebrands operational copy only when it is presented to a partner user", () => {
    const verificationError =
      "This EIN is already connected to another SimplAssist account. Contact SimplAssist Support for help.";
    const reviewFinding =
      "Customer asked SimplAssist to review restricted-service fit";
    const numberError =
      "Finish business verification before choosing your SimplAssist number";
    const launchError =
      "SimplAssist could not recheck your existing Telnyx brand right now.";

    expect(
      replaceDefaultBrandName(verificationError, "Alpha Dog Agency"),
    ).toBe(
      "This EIN is already connected to another Alpha Dog Agency account. Contact Alpha Dog Agency Support for help.",
    );
    expect(replaceDefaultBrandName(reviewFinding, "Alpha Dog Agency")).toBe(
      "Customer asked Alpha Dog Agency to review restricted-service fit",
    );
    expect(replaceDefaultBrandName(numberError, "Alpha Dog Agency")).toBe(
      "Finish business verification before choosing your Alpha Dog Agency number",
    );
    expect(replaceDefaultBrandName(launchError, "Alpha Dog Agency")).toBe(
      "Alpha Dog Agency could not recheck your existing Telnyx brand right now.",
    );
    expect(replaceDefaultBrandName(verificationError, "SimplAssist")).toBe(
      verificationError,
    );
  });
});
