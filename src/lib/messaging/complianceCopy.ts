import type { Language } from "@/types/database";

export interface SmsComplianceBusiness {
  name: string;
  email: string | null;
  phone_number: string | null;
}

export interface SmsComplianceCopy {
  messageFlow: string;
  legalOptInDescription: string;
  optinMessage: string;
  optoutMessage: string;
  helpMessage: string;
  voicemailGreeting: string;
  missedCallSms: Record<"en" | "es", string>;
}

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

export function buildSmsComplianceCopy({
  business,
  smsPhoneNumber,
  privacyUrl,
}: {
  business: SmsComplianceBusiness;
  smsPhoneNumber: string;
  privacyUrl: string;
}): SmsComplianceCopy {
  const brandName = business.name.trim();
  const contact = supportContact(business);

  const optinPaths = [
    `${brandName} offers two customer-initiated SMS opt-in paths.`,
    `Inbound SMS opt-in: customers text ${smsPhoneNumber}, the ${brandName} SMS number, to ask a question or request service.`,
    `Verbal call opt-in: customers call ${smsPhoneNumber}, hear a voicemail disclosure that leaving a message permits a customer-care SMS follow-up, and then leave a voicemail message after the disclosure.`,
  ].join(" ");

  const programDetails = [
    `Calls to ${smsPhoneNumber} may be forwarded to ${brandName}.`,
    `${brandName} uses SMS for customer care only, including responses to customer questions, missed-call follow-ups, and service coordination.`,
    "Message frequency varies by conversation. Message and data rates may apply.",
    "Reply HELP for help or STOP to opt out.",
  ].join(" ");

  return {
    messageFlow: [
      optinPaths,
      programDetails,
      `Privacy Policy: ${privacyUrl}.`,
    ].join(" "),
    legalOptInDescription: [optinPaths, programDetails].join(" "),
    optinMessage: `${brandName}: You are subscribed to customer-care texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.`,
    optoutMessage: `${brandName}: You are unsubscribed. No further messages will be sent. Reply START to opt back in.`,
    helpMessage: `${brandName}: For help, contact ${contact}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`,
    voicemailGreeting: [
      `Thanks for calling ${brandName}.`,
      "We are unavailable right now.",
      `If you leave a message after the beep, you agree to receive a customer-care text follow-up from ${brandName}.`,
      "Message frequency varies and message and data rates may apply.",
      "If we text you, reply HELP for help or STOP to opt out.",
      "If you do not want a text follow-up, hang up without leaving a message.",
      "Please leave your message after the beep.",
    ].join(" "),
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
    privacyUrl: "the business privacy policy",
  });

  if (language === "es") return copy.missedCallSms.es;
  return copy.missedCallSms.en;
}

export function defaultOnboardingOptInDescription(): string {
  return [
    "Customers opt in through two customer-initiated paths.",
    "Inbound SMS opt-in: customers text the SimpleAssist number first to ask a question or request service.",
    "Verbal call opt-in: customers call the SimpleAssist number, hear a voicemail disclosure that leaving a message permits a customer-care SMS follow-up, and then leave a voicemail message after the disclosure.",
    "Messages are customer care only, including responses to customer questions, missed-call follow-ups, and service coordination.",
    "Message frequency varies. Message and data rates may apply.",
    "Reply HELP for help or STOP to opt out.",
  ].join(" ");
}
