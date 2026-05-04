import Telnyx from "telnyx";

export const telnyx = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY!,
  publicKey: process.env.TELNYX_PUBLIC_KEY!,
});

export const TELNYX_MESSAGING_PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID!;
export const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID!;
