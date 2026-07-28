import { describe, expect, it } from "vitest";

import {
  buildSmsComplianceCopy,
  defaultOnboardingOptInDescription,
  MOBILE_INFORMATION_SHARING_DISCLOSURE,
  resolveComplianceCopyLocale,
} from "./complianceCopy";

const BUSINESS = {
  name: "Northstar Home Care",
  email: "help@northstar.example",
  phone_number: "+13175550199",
};
const SMS_NUMBER = "+13175550123";
const ENTRY_POINT = "https://app.example.test/c/northstar-home-care";
const PRIVACY_URL = `${ENTRY_POINT}/privacy`;
const ENGLISH_MISSED_CALL_SMS =
  "Hi, this is Northstar Home Care — saw your call come in. Just reply here with what you need and we'll get you taken care of.\n\nMsg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.";
const SPANISH_MISSED_CALL_SMS =
  "Hola, somos Northstar Home Care — vimos tu llamada. Solo responde aquí con lo que necesitas y nos encargaremos de ayudarte.\n\nLa frecuencia de mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responde HELP para recibir ayuda o STOP para dejar de recibir mensajes.";
const ENGLISH_VOICEMAIL_GREETING =
  "Thanks for calling Northstar Home Care. By leaving a message after the beep, you'll get a text back from us.";
const SPANISH_VOICEMAIL_GREETING =
  "Gracias por llamar a Northstar Home Care. Al dejar un mensaje después del tono, te responderemos por mensaje de texto.";
const OPT_IN_MESSAGE =
  "Northstar Home Care: You are subscribed to customer-care texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.";

describe("buildSmsComplianceCopy", () => {
  it("builds the exact localized SMS and voicemail scripts", () => {
    const copy = buildSmsComplianceCopy({
      business: BUSINESS,
      smsPhoneNumber: SMS_NUMBER,
      smsEntryPoint: ENTRY_POINT,
      privacyUrl: PRIVACY_URL,
    });

    expect(copy.missedCallSms).toEqual({
      en: ENGLISH_MISSED_CALL_SMS,
      es: SPANISH_MISSED_CALL_SMS,
    });
    expect(copy.voicemailGreetings).toEqual({
      en: ENGLISH_VOICEMAIL_GREETING,
      es: SPANISH_VOICEMAIL_GREETING,
    });
    expect(copy.confirmationSms).toBe(ENGLISH_MISSED_CALL_SMS);
    expect(copy.voicemailGreeting).toBe(ENGLISH_VOICEMAIL_GREETING);
    expect(copy.optinMessage).toBe(OPT_IN_MESSAGE);
  });

  it.each([
    ["en" as const, ENGLISH_MISSED_CALL_SMS, ENGLISH_VOICEMAIL_GREETING],
    ["es" as const, SPANISH_MISSED_CALL_SMS, SPANISH_VOICEMAIL_GREETING],
    ["both" as const, ENGLISH_MISSED_CALL_SMS, ENGLISH_VOICEMAIL_GREETING],
  ])(
    "selects the %s compliance scripts without changing the localized records",
    (language, expectedSms, expectedGreeting) => {
      const copy = buildSmsComplianceCopy({
        business: BUSINESS,
        smsPhoneNumber: SMS_NUMBER,
        smsEntryPoint: ENTRY_POINT,
        privacyUrl: PRIVACY_URL,
        language,
      });

      expect(copy.confirmationSms).toBe(expectedSms);
      expect(copy.confirmationSms).toBe(
        copy.missedCallSms[resolveComplianceCopyLocale(language)]
      );
      expect(copy.voicemailGreeting).toBe(expectedGreeting);
      expect(copy.voicemailGreeting).toBe(
        copy.voicemailGreetings[resolveComplianceCopyLocale(language)]
      );
      expect(copy.missedCallSms.en).toBe(ENGLISH_MISSED_CALL_SMS);
      expect(copy.missedCallSms.es).toBe(SPANISH_MISSED_CALL_SMS);
      expect(copy.voicemailGreetings.en).toBe(ENGLISH_VOICEMAIL_GREETING);
      expect(copy.voicemailGreetings.es).toBe(SPANISH_VOICEMAIL_GREETING);
      expect(copy.optinMessage).toBe(OPT_IN_MESSAGE);
      expect(copy.optinMessage).not.toBe(copy.confirmationSms);
    }
  );

  it("preserves two actual line feeds between each SMS's two paragraphs", () => {
    const copy = buildSmsComplianceCopy({
      business: BUSINESS,
      smsPhoneNumber: SMS_NUMBER,
      smsEntryPoint: ENTRY_POINT,
      privacyUrl: PRIVACY_URL,
    });

    for (const sms of Object.values(copy.missedCallSms)) {
      expect(sms).toContain("\n\n");
      expect(sms).not.toContain("\\n\\n");
      expect(sms.split("\n\n")).toHaveLength(2);
    }
  });

  it("quotes the confirmation SMS and voicemail script verbatim in messageFlow", () => {
    const copy = buildSmsComplianceCopy({
      business: BUSINESS,
      smsPhoneNumber: SMS_NUMBER,
      smsEntryPoint: ENTRY_POINT,
      privacyUrl: PRIVACY_URL,
    });

    expect(copy.messageFlow).toContain(
      `Confirmation SMS: “${copy.confirmationSms}”`
    );
    expect(copy.messageFlow).toContain(
      `Voicemail disclosure: “${copy.voicemailGreeting}”`
    );
  });

  it("covers the complete 806 disclosure checklist with the real SMS path", () => {
    const copy = buildSmsComplianceCopy({
      business: BUSINESS,
      smsPhoneNumber: SMS_NUMBER,
      smsEntryPoint: ENTRY_POINT,
      privacyUrl: PRIVACY_URL,
    });

    expect(copy.optInPaths.inboundSms).toContain(SMS_NUMBER);
    expect(copy.optInPaths.inboundSms).toContain(ENTRY_POINT);
    expect(copy.optInPaths.voicemail).toContain(SMS_NUMBER);
    expect(copy.optInPaths.voicemail).toContain(
      "only after the caller hears the full disclosure and leaves a message"
    );
    expect(copy.optInPaths.callForwarding).toBe(
      "Calls may be forwarded to a team member; a call or live conversation alone is not SMS consent."
    );

    for (const required of [
      copy.disclosures.purpose,
      copy.disclosures.frequency,
      copy.disclosures.rates,
      copy.disclosures.help,
      copy.disclosures.stop,
      MOBILE_INFORMATION_SHARING_DISCLOSURE,
      copy.disclosures.privacyPolicy,
    ]) {
      expect(copy.messageFlow).toContain(required);
    }

    expect(copy.disclosures).toEqual({
      purpose:
        "This SMS program is for customer care only, including responses to customer questions, missed-call follow-ups, and service coordination.",
      frequency: "Message frequency varies by conversation.",
      rates: "Message and data rates may apply.",
      help: "Reply HELP for help.",
      stop: "Reply STOP to opt out.",
      mobileInformationSharing: MOBILE_INFORMATION_SHARING_DISCLOSURE,
      privacyPolicy: `Privacy Policy: ${PRIVACY_URL}.`,
    });
  });

  it("does not substitute the business contact phone for a missing SMS number", () => {
    const copy = buildSmsComplianceCopy({
      business: BUSINESS,
      smsPhoneNumber: null,
      smsEntryPoint: null,
      privacyUrl: PRIVACY_URL,
    });

    expect(copy.optInPaths.inboundSms).toContain(
      "the business's published SimplAssist SMS number"
    );
    expect(copy.optInPaths.voicemail).toContain(
      "the business's published SimplAssist SMS number"
    );
    expect(copy.optInPaths.inboundSms).not.toContain(BUSINESS.phone_number);
    expect(copy.optInPaths.voicemail).not.toContain(BUSINESS.phone_number);
  });

  it.each([
    ["Red Maple Repairs", "+12025550101", "red-maple-repairs"],
    ["Blue River Dental", "+14155550102", "blue-river-dental"],
  ])(
    "derives customer-specific copy for %s without retained values",
    (name, smsPhoneNumber, slug) => {
      const entryPoint = `https://app.example.test/c/${slug}`;
      const copy = buildSmsComplianceCopy({
        business: { name, email: null, phone_number: null },
        smsPhoneNumber,
        smsEntryPoint: entryPoint,
        privacyUrl: `${entryPoint}/privacy`,
      });

      expect(copy.confirmationSms).toContain(name);
      expect(copy.messageFlow).toContain(smsPhoneNumber);
      expect(copy.messageFlow).toContain(entryPoint);
    }
  );
});

describe("resolveComplianceCopyLocale", () => {
  it.each([
    ["es" as const, "es"],
    ["en" as const, "en"],
    ["both" as const, "en"],
    [null, "en"],
    [undefined, "en"],
  ])("maps %s to %s", (language, expected) => {
    expect(resolveComplianceCopyLocale(language)).toBe(expected);
  });
});

describe("defaultOnboardingOptInDescription", () => {
  it("includes the approved mobile-information sharing statement", () => {
    const description = defaultOnboardingOptInDescription();

    expect(description).toContain(MOBILE_INFORMATION_SHARING_DISCLOSURE);
    expect(description).toContain("Reply HELP for help or STOP to opt out.");
    expect(description).toContain("Message and data rates may apply.");
  });
});
