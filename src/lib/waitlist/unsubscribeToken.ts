import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const SIGNING_CONTEXT = "waitlist-unsubscribe:v1:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MIN_SECRET_BYTES = 32;

function waitlistUnsubscribeSecret(
  override?: string
): string {
  const secret = override ?? process.env.WAITLIST_UNSUBSCRIBE_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error(
      "WAITLIST_UNSUBSCRIBE_SECRET must contain at least 32 bytes"
    );
  }

  return secret;
}

function signatureFor(signupId: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${SIGNING_CONTEXT}${signupId}`)
    .digest();
}

export function createWaitlistUnsubscribeToken(
  signupId: string,
  secretOverride?: string
): string {
  const normalizedSignupId = signupId.toLowerCase();
  if (!UUID_PATTERN.test(normalizedSignupId)) {
    throw new Error("A valid waitlist signup UUID is required");
  }

  const secret = waitlistUnsubscribeSecret(secretOverride);
  const signature = signatureFor(normalizedSignupId, secret).toString(
    "base64url"
  );

  return `${TOKEN_VERSION}.${normalizedSignupId}.${signature}`;
}

export function verifyWaitlistUnsubscribeToken(
  token: string,
  secretOverride?: string
): string | null {
  const secret = waitlistUnsubscribeSecret(secretOverride);
  const parts = token.split(".");

  if (parts.length !== 3) return null;

  const [version, rawSignupId, rawSignature] = parts;
  const signupId = rawSignupId.toLowerCase();

  if (
    version !== TOKEN_VERSION ||
    rawSignupId !== signupId ||
    !UUID_PATTERN.test(signupId) ||
    !SIGNATURE_PATTERN.test(rawSignature)
  ) {
    return null;
  }

  const providedSignature = Buffer.from(rawSignature, "base64url");
  const expectedSignature = signatureFor(signupId, secret);

  if (
    providedSignature.toString("base64url") !== rawSignature ||
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }

  return signupId;
}
