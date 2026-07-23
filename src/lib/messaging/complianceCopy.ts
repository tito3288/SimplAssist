import type { Language } from "@/types/database";

export interface SmsComplianceBusiness {
  name: string;
  email: string | null;
  phone_number: string | null;
}

export interface SmsOptInPaths {
  introduction: string;
  inboundSms: string;
  voicemail: string;
  callForwarding: string;
}

export interface SmsProgramDisclosures {
  purpose: string;
  frequency: string;
  rates: string;
  help: string;
  stop: string;
  mobileInformationSharing: string;
  privacyPolicy: string;
}

export interface SmsComplianceCopy {
  optInPaths: SmsOptInPaths;
  disclosures: SmsProgramDisclosures;
  messageFlow: string;
  legalOptInDescription: string;
  confirmationSms: string;
  optinMessage: string;
  optoutMessage: string;
  helpMessage: string;
  voicemailGreeting: string;
  missedCallSms: Record<"en" | "es", string>;
}

export const MOBILE_INFORMATION_SHARING_DISCLOSURE =
  "We will not share mobile information with third parties for promotional or marketing purposes.";

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function supportContact(business: SmsComplianceBusiness): string {
  return (
    cleanText(business.email) ??
    cleanText(business.phone_number) ??
    "the business directly"
  );
}

function quoteVerbatim(value: string): string {
  // The quoted copy can legitimately contain ASCII quotes in a business
  // name. Distinct outer delimiters keep the verbatim payload unambiguous
  // without escaping or otherwise changing the words that are sent/spoken.
  return `“${value}”`;
}

export function buildSmsComplianceCopy({
  business,
  smsPhoneNumber,
  smsEntryPoint,
  privacyUrl,
}: {
  business: SmsComplianceBusiness;
  smsPhoneNumber?: string | null;
  smsEntryPoint?: string | null;
  privacyUrl: string;
}): SmsComplianceCopy {
  const brandName = business.name.trim();
  const contact = supportContact(business);
  const smsNumberDescription =
    cleanText(smsPhoneNumber) ??
    "the business's published SimplAssist SMS number";
  const entryPointDescription =
    cleanText(smsEntryPoint) ??
    "the business's SimplAssist contact page";

  const confirmationSms = `${brandName}: You are subscribed to customer-care texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.`;
  const voicemailGreeting = [
    `Thanks for calling ${brandName}.`,
    "We are unavailable right now.",
    "If you leave a message after the beep, you agree to receive a customer-care text follow-up from us.",
    "Message frequency varies and message and data rates may apply.",
    "If we text you, reply HELP for help or STOP to opt out.",
    MOBILE_INFORMATION_SHARING_DISCLOSURE,
    "If you do not want a text follow-up, hang up without leaving a message.",
    "Please leave your message after the beep.",
  ].join(" ");

  const optInPaths: SmsOptInPaths = {
    introduction: "Customers opt in through two customer-initiated paths.",
    inboundSms: `Inbound SMS opt-in: customers text ${smsNumberDescription}, published at ${entryPointDescription}, with a question or service request.`,
    voicemail: `Voicemail opt-in: customers call ${smsNumberDescription}. If the call reaches voicemail, consent occurs only after the caller hears the full disclosure and leaves a message.`,
    callForwarding:
      "Calls may be forwarded to a team member; a call or live conversation alone is not SMS consent.",
  };

  const disclosures: SmsProgramDisclosures = {
    purpose:
      "This SMS program is for customer care only, including responses to customer questions, missed-call follow-ups, and service coordination.",
    frequency: "Message frequency varies by conversation.",
    rates: "Message and data rates may apply.",
    help: "Reply HELP for help.",
    stop: "Reply STOP to opt out.",
    mobileInformationSharing: MOBILE_INFORMATION_SHARING_DISCLOSURE,
    privacyPolicy: `Privacy Policy: ${privacyUrl}.`,
  };

  const optInNarrative = [
    optInPaths.introduction,
    optInPaths.inboundSms,
    `Confirmation SMS: ${quoteVerbatim(confirmationSms)}`,
    optInPaths.voicemail,
    `Voicemail disclosure: ${quoteVerbatim(voicemailGreeting)}`,
    optInPaths.callForwarding,
  ].join(" ");

  const programDetails = [
    disclosures.purpose,
    disclosures.frequency,
    disclosures.rates,
    disclosures.help,
    disclosures.stop,
    disclosures.mobileInformationSharing,
  ].join(" ");

  return {
    optInPaths,
    disclosures,
    messageFlow: [optInNarrative, programDetails, disclosures.privacyPolicy].join(
      " "
    ),
    legalOptInDescription: [optInNarrative, programDetails].join(" "),
    confirmationSms,
    optinMessage: confirmationSms,
    optoutMessage: `${brandName}: You are unsubscribed. No further messages will be sent. Reply START to opt back in.`,
    helpMessage: `${brandName}: For help, contact ${contact}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`,
    voicemailGreeting,
    missedCallSms: {
      en: `Hi, this is ${brandName}. We received your call and can help by text. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.`,
      es: `Hola, somos ${brandName}. Recibimos su llamada y podemos ayudar por texto. La frecuencia de mensajes varia. Pueden aplicar tarifas de mensajes y datos. Responda HELP para ayuda o STOP para cancelar.`,
    },
  };
}

export function renderMissedCallSms({
  business,
  smsPhoneNumber,
  language,
}: {
  business: SmsComplianceBusiness;
  smsPhoneNumber: string;
  language: Language;
}): string {
  const copy = buildSmsComplianceCopy({
    business,
    smsPhoneNumber,
    smsEntryPoint: smsPhoneNumber,
    privacyUrl: "the business privacy policy",
  });

  if (language === "es") return copy.missedCallSms.es;
  return copy.missedCallSms.en;
}

export function defaultOnboardingOptInDescription(): string {
  return [
    "Customers opt in through two customer-initiated paths.",
    "Inbound SMS opt-in: customers text the SimplAssist number first to ask a question or request service.",
    "Verbal call opt-in: customers call the SimplAssist number, hear a voicemail disclosure that leaving a message permits a customer-care SMS follow-up, and then leave a voicemail message after the disclosure.",
    "Messages are customer care only, including responses to customer questions, missed-call follow-ups, and service coordination.",
    "Message frequency varies. Message and data rates may apply.",
    "Reply HELP for help or STOP to opt out.",
    MOBILE_INFORMATION_SHARING_DISCLOSURE,
  ].join(" ");
}
