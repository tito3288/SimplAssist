import { describe, expect, it, vi } from "vitest";

import { REJECTION_SUPPORT_MESSAGE } from "@/lib/onboarding/rejectionGuidance";
import {
  BusinessInfoSaveError,
  persistOnboardingBusinessInfo,
  type BusinessInfoData,
} from "./BusinessInfoForm";

const businessInfo: BusinessInfoData = {
  name: "Example Service LLC",
  business_type: "hvac",
  business_type_other: "",
  website: "https://example.test",
  phone: "(317) 555-0100",
  email: "owner@example.test",
  address: "123 Main Street",
  city: "Indianapolis",
  state: "IN",
  zip: "46204",
};

describe("persistOnboardingBusinessInfo", () => {
  it("posts the full form and browser timezone to the server-authoritative route", async () => {
    const fetchBusinessInfo = vi
      .fn()
      .mockResolvedValue(Response.json({ success: true }));

    await persistOnboardingBusinessInfo(
      businessInfo,
      "America/Indiana/Indianapolis",
      fetchBusinessInfo,
    );

    expect(fetchBusinessInfo).toHaveBeenCalledExactlyOnceWith(
      "/api/onboarding/business-info",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...businessInfo,
          timezone: "America/Indiana/Indianapolis",
        }),
      },
    );
    expect(JSON.parse(fetchBusinessInfo.mock.calls[0][1].body)).not.toHaveProperty(
      "businessId",
    );
  });

  it("surfaces the support-only response from an already-rejected save", async () => {
    const fetchBusinessInfo = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: REJECTION_SUPPORT_MESSAGE,
          code: "rejection_support_required",
        },
        { status: 409 },
      ),
    );

    await expect(
      persistOnboardingBusinessInfo(
        businessInfo,
        "America/Indiana/Indianapolis",
        fetchBusinessInfo,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "BusinessInfoSaveError",
        message: REJECTION_SUPPORT_MESSAGE,
      }),
    );
  });

  it("uses safe fallback copy when an error response has no JSON message", async () => {
    const fetchBusinessInfo = vi.fn().mockResolvedValue(
      new Response("not json", { status: 500 }),
    );

    await expect(
      persistOnboardingBusinessInfo(
        businessInfo,
        "America/Indiana/Indianapolis",
        fetchBusinessInfo,
      ),
    ).rejects.toEqual(
      new BusinessInfoSaveError(
        "Could not save your business information. Please try again.",
      ),
    );
  });
});
