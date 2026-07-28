import {
  buildSmsComplianceCopy,
  type SmsComplianceBusiness,
  type SmsComplianceCopy,
} from "@/lib/messaging/complianceCopy";
import { isE164PhoneNumber, normalizeE164Input } from "@/lib/phone/e164";
import type { Language } from "@/types/database";

export const TELNYX_CAMPAIGN_MESSAGE_FLOW_MAX_CHARACTERS = 2_048;

export type CampaignMessageFlowErrorCode =
  | "campaign_sms_number_missing"
  | "campaign_sms_number_invalid"
  | "campaign_message_flow_too_long";

export type CampaignMessageFlowErrorKind = "transient" | "permanent";

export class CampaignMessageFlowError extends Error {
  readonly code: CampaignMessageFlowErrorCode;
  readonly kind: CampaignMessageFlowErrorKind;

  constructor(options: {
    code: CampaignMessageFlowErrorCode;
    kind: CampaignMessageFlowErrorKind;
    message: string;
  }) {
    super(options.message);
    this.name = "CampaignMessageFlowError";
    this.code = options.code;
    this.kind = options.kind;
  }
}

export interface CampaignMessageFlowCopy extends SmsComplianceCopy {
  smsPhoneNumber: string;
  messageFlowCharacterCount: number;
}

/**
 * Builds the exact copy submitted with a Telnyx campaign.
 *
 * Unlike the broader shared-copy builder, the campaign boundary requires a
 * concrete E.164 number. It also enforces Telnyx's 2,048-character message
 * flow limit before the caller can persist or submit anything.
 */
export function buildCampaignMessageFlow({
  business,
  smsPhoneNumber,
  smsEntryPoint,
  privacyUrl,
  language,
}: {
  business: SmsComplianceBusiness;
  smsPhoneNumber: string;
  smsEntryPoint: string;
  privacyUrl: string;
  language?: Language | null;
}): CampaignMessageFlowCopy {
  const normalizedSmsPhoneNumber = normalizeE164Input(smsPhoneNumber);
  if (!isE164PhoneNumber(normalizedSmsPhoneNumber)) {
    throw new CampaignMessageFlowError({
      code: "campaign_sms_number_invalid",
      kind: "permanent",
      message:
        "Campaign message flow requires smsPhoneNumber in valid E.164 format.",
    });
  }

  const copy = buildSmsComplianceCopy({
    business,
    smsPhoneNumber: normalizedSmsPhoneNumber,
    smsEntryPoint,
    privacyUrl,
    language,
  });
  const messageFlowCharacterCount = copy.messageFlow.length;

  if (
    messageFlowCharacterCount >
    TELNYX_CAMPAIGN_MESSAGE_FLOW_MAX_CHARACTERS
  ) {
    throw new CampaignMessageFlowError({
      code: "campaign_message_flow_too_long",
      kind: "permanent",
      message: `Campaign message flow is ${messageFlowCharacterCount} characters; the Telnyx limit is ${TELNYX_CAMPAIGN_MESSAGE_FLOW_MAX_CHARACTERS}.`,
    });
  }

  return {
    ...copy,
    smsPhoneNumber: normalizedSmsPhoneNumber,
    messageFlowCharacterCount,
  };
}
