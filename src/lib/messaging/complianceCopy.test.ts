import { describe, expect, it } from "vitest";

import {
  buildSmsComplianceCopy,
  defaultOnboardingOptInDescription,
  MOBILE_INFORMATION_SHARING_DISCLOSURE,
} from "./complianceCopy";

const BUSINESS = {
  name: "Northstar Home Care",
  email: "help@northstar.example",
  phone_number: "+13175550199",
};
const SMS_NUMBER = "+13175550123";
const ENTRY_POINT = "https://app.example.test/c/northstar-home-care";
const PRIVACY_URL = `${ENTRY_POINT}/privacy`;

describe("buildSmsComplianceCopy", () => {
  it("builds the exact shared confirmation and voicemail scripts", () => {
    const copy = buildSmsComplianceCopy({
      business: BUSINESS,
      smsPhoneNumber: SMS_NUMBER,
      smsEntryPoint: ENTRY_POINT,
      privacyUrl: PRIVACY_URL,
    });

    expect(copy.confirmationSms).toBe(
      "Northstar Home Care: You are subscribed to customer-care texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out."
    );
    expect(copy.optinMessage).toBe(copy.confirmationSms);
    expect(copy.voicemailGreeting).toBe(
      "Thanks for calling Northstar Home Care. We are unavailable right now. If you leave a message after the beep, you agree to receive a customer-care text follow-up from us. Message frequency varies and message and data rates may apply. If we text you, reply HELP for help or STOP to opt out. We will not share mobile information with third parties for promotional or marketing purposes. If you do not want a text follow-up, hang up without leaving a message. Please leave your message after the beep."
    );
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

    expect(copy.disclosures.privacyPolicy).toBe(
      `Privacy Policy: ${PRIVACY_URL}.`
    );
    expect(copy.voicemailGreeting).toContain(
      MOBILE_INFORMATION_SHARING_DISCLOSURE
    );
    expect(copy.disclosures.mobileInformationSharing).toBe(
      MOBILE_INFORMATION_SHARING_DISCLOSURE
    );
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

describe("defaultOnboardingOptInDescription", () => {
  it("includes the approved mobile-information sharing statement", () => {
    const description = defaultOnboardingOptInDescription();

    expect(description).toContain(MOBILE_INFORMATION_SHARING_DISCLOSURE);
    expect(description).toContain("Reply HELP for help or STOP to opt out.");
    expect(description).toContain("Message and data rates may apply.");
  });
});
