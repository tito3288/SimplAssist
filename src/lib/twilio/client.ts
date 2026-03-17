import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;

export const twilioClient = twilio(accountSid, authToken);

export async function searchAvailableNumbers(areaCode: string) {
  const numbers = await twilioClient
    .availablePhoneNumbers("US")
    .local.list({ areaCode: parseInt(areaCode), limit: 10 });

  return numbers.map((n) => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
  }));
}

export async function purchaseNumber(phoneNumber: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const number = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber,
    smsUrl: `${appUrl}/api/twilio/webhook`,
    smsMethod: "POST",
  });

  return number;
}

export async function releaseNumber(twilioSid: string) {
  await twilioClient.incomingPhoneNumbers(twilioSid).remove();
}

export { twilio };
