import { createMessagingProfile } from "./messagingProfile";
import { createVoiceApplication } from "./voiceApplication";
import { registerBrand } from "./brand";
import { registerCampaign } from "./campaign";

export { createMessagingProfile } from "./messagingProfile";
export { createVoiceApplication } from "./voiceApplication";
export { registerBrand } from "./brand";
export { registerCampaign } from "./campaign";

export async function runFullRegistration(businessId: string): Promise<void> {
  await createMessagingProfile(businessId);
  await createVoiceApplication(businessId);
  await registerBrand(businessId);
  await registerCampaign(businessId);
}
