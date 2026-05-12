import Telnyx from "telnyx";

export const telnyx = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY!,
  publicKey: process.env.TELNYX_PUBLIC_KEY!,
});

// Reserved for SimplAssist's OWN outbound only — account notifications, billing
// alerts, password resets, marketing about SimplAssist itself. NEVER use this
// for customer-to-end-consumer traffic; resolve the per-customer messaging
// profile via getMessagingProfileForOutbound() in src/lib/messaging/lookup.ts
// instead. Sending customer traffic through this shared profile produces the
// brand/sender identity mismatch that TCR rejects.
export const TELNYX_MESSAGING_PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID!;

// @deprecated Voice routing is now per-customer (businesses.telnyx_voice_application_id).
// Kept for transition period; not referenced by any active code path.
export const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID!;
