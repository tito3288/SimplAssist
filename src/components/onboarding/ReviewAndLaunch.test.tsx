import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { RequestBrand } from "@/lib/branding/types";

vi.mock("@/components/onboarding/PlanSelectionOption", () => ({
  PlanSelectionOption: ({ plan }: { plan: { features: string[] } }) => (
    <div>Plan option: {plan.features.join(" | ")}</div>
  ),
}));

import { BrandProvider } from "@/components/branding/BrandProvider";
import ReviewAndLaunch, {
  buildOnboardingLaunchRequest,
  requestOnboardingLaunch,
} from "./ReviewAndLaunch";

const DEFAULT_REQUEST_BRAND: RequestBrand = {
  source: "default",
  isPreview: false,
  brand: {
    kind: "default",
    partnerId: null,
    slug: null,
    name: "SimplAssist",
    publicOrigin: "https://simplassist.com",
    logoLightUrl: "/logo-light.png",
    logoDarkUrl: "/logo-dark.png",
    faviconUrl: "/favicon-2.png",
    colors: {
      primary: "#ea580c",
      primaryHover: "#c2410c",
      primaryActive: "#9a3412",
      accent: "#c2410c",
      primaryDark: "#ff914d",
      primaryHoverDark: "#f57f33",
      primaryActiveDark: "#e8752c",
      accentDark: "#ff914d",
    },
  },
};

const PARTNER_REQUEST_BRAND: RequestBrand = {
  ...DEFAULT_REQUEST_BRAND,
  source: "partner_host",
  brand: {
    ...DEFAULT_REQUEST_BRAND.brand,
    kind: "partner",
    partnerId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
  },
};

type ReviewProps = ComponentProps<typeof ReviewAndLaunch>;

const registration: ReviewProps["registration"] = {
  status: "not_started",
  holdReason: null,
  startedAt: null,
  submittedAt: null,
  error: null,
  brandStatus: null,
  brandStatusUpdatedAt: null,
  brandRejectionReason: null,
  campaignStatus: null,
  campaignStatusUpdatedAt: null,
  campaignRejectionReason: null,
  assignmentStatus: null,
  assignmentFailureReason: null,
  smsReady: false,
  smsBlockReason: null,
  riskReview: {
    status: "not_started",
    storedStatus: null,
    inputHash: null,
    currentInputHash: null,
    message: null,
    reason: null,
    findings: [],
    checklistAnswer: null,
    checklistSelections: [],
    scannedAt: null,
    notifiedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    overrideNote: null,
    registrationStarted: false,
  },
};

const baseProps: ReviewProps = {
  data: {
    businessInfo: {
      name: "Northstar Home Care",
      business_type: "general",
      phone: "+13175550199",
      address: "100 Main Street",
      city: "Indianapolis",
      state: "IN",
      zip: "46204",
    },
    businessHours: [],
    servicesCount: 1,
    faqsCount: 1,
    aiSettings: {
      tone: "balanced",
      business_voice: "we",
      language: "en",
      response_delay_seconds: 0,
      web_greeting: "Hello",
      booking_enabled: false,
    },
    phoneNumber: null,
    brandVerification: null,
  },
  billing: {
    mode: "stripe",
    handledByName: null,
    plan: null,
    status: null,
    setupFeePaidAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  },
  registration,
  pendingPhoneNumberFailureReason: null,
  onEditStep: vi.fn(),
  onBack: vi.fn(),
  onSubmitted: vi.fn(),
  onLaunchBlocked: vi.fn(),
};

function renderReview(
  requestBrand: RequestBrand,
  props: ReviewProps = baseProps
): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <ReviewAndLaunch {...props} />
    </BrandProvider>
  );
}

describe("ReviewAndLaunch visible brand copy", () => {
  it("preserves the default plan and number copy", () => {
    const html = renderReview(DEFAULT_REQUEST_BRAND);

    expect(html).toContain("Choose a SimplAssist plan");
    expect(html).toContain(
      "Choose a SimplAssist number before submitting SMS registration."
    );
    expect(html).toContain("One local SimplAssist number");
  });

  it("uses the partner name in plan and number copy", () => {
    const html = renderReview(PARTNER_REQUEST_BRAND);

    expect(html).toContain("Choose an Alpha Dog Agency plan");
    expect(html).toContain(
      "Choose an Alpha Dog Agency number before submitting SMS registration."
    );
    expect(html).toContain("One local Alpha Dog Agency number");
    expect(html).not.toContain("SimplAssist");
  });

  it("uses the partner name in the paid setup support hold", () => {
    const html = renderReview(PARTNER_REQUEST_BRAND, {
      ...baseProps,
      billing: {
        ...baseProps.billing,
        plan: "sms_and_chat",
        status: "active",
      },
      registration: {
        ...registration,
        status: "failed",
        error: "SMS registration is disabled",
      },
    });

    expect(html).toContain(
      "SMS setup is paused. Contact Alpha Dog Agency support to continue."
    );
    expect(html).not.toContain("Contact SimplAssist support");
  });

  it("rebrands stored operational launch errors only for presentation", () => {
    const html = renderReview(PARTNER_REQUEST_BRAND, {
      ...baseProps,
      billing: {
        ...baseProps.billing,
        mode: "invoiced",
        plan: "sms_and_chat",
      },
      registration: {
        ...registration,
        status: "failed",
        error:
          "SimplAssist could not recheck your existing Telnyx brand right now.",
      },
    });

    expect(html).toContain(
      "Alpha Dog Agency could not recheck your existing Telnyx brand right now.",
    );
    expect(html).not.toContain(
      "SimplAssist could not recheck your existing Telnyx brand right now.",
    );
  });
});

describe("ReviewAndLaunch partner-managed billing", () => {
  it.each(["invoiced", "comped"] as const)(
    "renders assigned-partner billing and no Stripe purchase UI in %s mode",
    (mode) => {
      const html = renderReview(PARTNER_REQUEST_BRAND, {
        ...baseProps,
        data: {
          ...baseProps.data,
          phoneNumber: "+13175550123",
        },
        billing: {
          ...baseProps.billing,
          mode,
          handledByName: "Alpha Dog Agency",
        },
      });

      expect(html).toContain("Review &amp; Submit");
      expect(html).toContain("Billing is handled by Alpha Dog Agency.");
      expect(html).toContain("Submit SMS registration");
      expect(html).not.toContain("Plan option");
      expect(html).not.toContain("Plan &amp; Setup Fee");
      expect(html).not.toContain("Review &amp; Pay");
      expect(html).not.toContain("Opening checkout");
      expect(html).not.toContain("Pay &amp; submit");
      expect(html).not.toContain("one-time setup");
      expect(html).not.toContain("charged");
      expect(html).not.toContain("Choose an Alpha Dog Agency plan");
    }
  );

  it("uses the exact external fallback for an orphaned assignment", () => {
    const html = renderReview(DEFAULT_REQUEST_BRAND, {
      ...baseProps,
      data: {
        ...baseProps.data,
        phoneNumber: "+13175550123",
      },
      billing: {
        ...baseProps.billing,
        mode: "invoiced",
        handledByName: null,
      },
    });

    expect(html).toContain("Billing is managed externally.");
    expect(html).not.toContain("Billing is handled by");
  });

  it("keeps launch holds authoritative without showing payment controls", () => {
    const html = renderReview(PARTNER_REQUEST_BRAND, {
      ...baseProps,
      data: {
        ...baseProps.data,
        phoneNumber: "+13175550123",
      },
      billing: {
        ...baseProps.billing,
        mode: "comped",
        handledByName: "Alpha Dog Agency",
      },
      registration: {
        ...registration,
        holdReason: "held_no_ein",
      },
    });

    expect(html).toContain("Add your EIN before SMS setup can continue.");
    expect(html).toContain("Add your EIN");
    expect(html).not.toContain("Submit SMS registration</button>");
    expect(html).not.toContain("checkout");
    expect(html).not.toContain("charged");
  });
});

describe("buildOnboardingLaunchRequest", () => {
  it.each(["invoiced", "comped"] as const)(
    "posts %s onboarding directly to submit-registration",
    (billingMode) => {
      const request = buildOnboardingLaunchRequest({
        billingMode,
        plan: "sms_and_chat",
      });

      expect(request).toEqual({
        url: "/api/onboarding/submit-registration",
        init: { method: "POST" },
      });
      expect(request.url).not.toContain("checkout");
    }
  );

  it("preserves the Stripe onboarding checkout request", () => {
    expect(
      buildOnboardingLaunchRequest({
        billingMode: "stripe",
        plan: "sms_only",
      })
    ).toEqual({
      url: "/api/billing/checkout",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "sms_only", mode: "onboarding" }),
      },
    });
  });

  it.each(["invoiced", "comped"] as const)(
    "calls submit-registration instead of checkout for %s onboarding",
    async (billingMode) => {
      const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

      await requestOnboardingLaunch(
        { billingMode, plan: "sms_and_chat" },
        fetcher
      );

      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledWith(
        "/api/onboarding/submit-registration",
        { method: "POST" }
      );
      expect(fetcher).not.toHaveBeenCalledWith(
        expect.stringContaining("checkout"),
        expect.anything()
      );
    }
  );
});
