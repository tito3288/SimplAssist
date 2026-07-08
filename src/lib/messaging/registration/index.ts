import { createMessagingProfile } from "./messagingProfile";
import { createVoiceApplication } from "./voiceApplication";
import { registerBrand } from "./brand";
import { registerCampaign } from "./campaign";
import { getA2pRiskClearanceForBusiness } from "./riskScreening";

export { createMessagingProfile } from "./messagingProfile";
export { createVoiceApplication } from "./voiceApplication";
export { registerBrand } from "./brand";
export { registerCampaign } from "./campaign";

export async function runFullRegistration(businessId: string): Promise<void> {
  const clearance = await getA2pRiskClearanceForBusiness(businessId);
  if (!clearance.cleared) {
    throw new Error(
      `[registration] A2P risk review is required before Telnyx submission for business ${businessId}: ${clearance.status}`
    );
  }

  await createMessagingProfile(businessId);
  await createVoiceApplication(businessId);
  await registerBrand(businessId);
  await registerCampaign(businessId);
}
