import type { OnboardingRegistrationStatus } from "@/types/database";

export type InitialContentQualityGateBusiness = {
  onboarding_completed_at?: string | null;
  telnyx_brand_id?: string | null;
  brand_status?: string | null;
  campaign_status?: string | null;
  onboarding_registration_status?: OnboardingRegistrationStatus | null;
};

/**
 * The 3+3 rule governs onboarding and the initial launch only. Once carrier
 * registration has genuinely started, or onboarding has completed, existing
 * customers stay live and repair their knowledge through Settings.
 */
export function shouldEnforceInitialContentQuality(
  business: InitialContentQualityGateBusiness
): boolean {
  const registrationStarted = Boolean(
    business.telnyx_brand_id ||
      business.brand_status ||
      business.campaign_status ||
      business.onboarding_registration_status === "submitted"
  );

  return !business.onboarding_completed_at && !registrationStarted;
}
