import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { StrictAuthCallbackOrigin } from "./callbackOrigin.server";
import { resolveStrictAuthCallbackOrigin } from "./callbackOrigin.server";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { supabaseAdmin } from "@/lib/supabase/admin";

const RESET_STATE_CONTEXT = "simplassist:password-reset-state:v1";
const RESET_INTENT_CONTEXT = "simplassist:password-reset-intent:v1";
const RESET_INTENT_MAX_AGE_MS = 15 * 60 * 1000;
const RESET_INTENT_CLOCK_SKEW_MS = 30 * 1000;
export const PASSWORD_RESET_INTENT_COOKIE = "simplassist-reset-intent";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PasswordResetBusiness = {
  id: string;
  ownerId: string;
  partnerId: string | null;
};

export type GeneratedAuthRecoveryLink = {
  hashedToken: string;
  verificationType: string;
  user: User;
};

export async function generateAuthRecoveryLink(input: {
  email: string;
  redirectTo: string;
}): Promise<GeneratedAuthRecoveryLink> {
  const result = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: input.email,
    options: { redirectTo: input.redirectTo },
  });

  const properties = result.data?.properties;
  const user = result.data?.user;
  if (
    result.error ||
    !properties ||
    !user ||
    properties.verification_type !== "recovery" ||
    typeof properties.hashed_token !== "string" ||
    !properties.hashed_token.trim()
  ) {
    throw result.error ?? new Error("Recovery link generation failed");
  }

  return {
    hashedToken: properties.hashed_token,
    verificationType: properties.verification_type,
    user,
  };
}

export async function findAuthUserByExactEmail(
  normalizedEmail: string,
): Promise<User | null> {
  let page = 1;
  let match: User | null = null;

  for (;;) {
    const result = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (result.error) throw result.error;

    const matches = result.data.users.filter(
      (user) => user.email?.trim().toLowerCase() === normalizedEmail,
    );
    if (matches.length > 1 || (matches.length === 1 && match !== null)) {
      throw new Error("Auth email identity is ambiguous");
    }
    if (matches.length === 1) match = matches[0];

    if (!result.data.nextPage) return match;
    page = result.data.nextPage;
  }
}

export function createPasswordResetState(
  origin: string,
  tokenHash: string,
): string {
  return createHmac("sha256", passwordResetStateKey())
    .update(passwordResetStatePayload(origin, tokenHash))
    .digest("base64url");
}

export function verifyPasswordResetState(
  origin: string,
  tokenHash: string,
  state: string,
): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
    const provided = decodeCanonicalBase64Url(state);
    if (!provided) return false;
    const expected = Buffer.from(
      createPasswordResetState(origin, tokenHash),
      "base64url",
    );
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    );
  } catch {
    return false;
  }
}

export function createPasswordResetIntent(
  userId: string,
  origin: string,
  now = Date.now(),
): string {
  if (!isUuid(userId) || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Password reset intent input is malformed");
  }
  passwordResetStatePayload(origin, "intent-origin-check");

  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      userId,
      origin,
      issuedAt: now,
      nonce: randomBytes(16).toString("base64url"),
    }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", passwordResetIntentKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyPasswordResetIntent(
  userId: string,
  origin: string,
  value: string | null | undefined,
  now = Date.now(),
): boolean {
  try {
    if (!isUuid(userId) || !value || !Number.isSafeInteger(now)) return false;
    const parts = value.split(".");
    if (parts.length !== 2) return false;
    const [payload, providedSignature] = parts;
    if (
      !/^[A-Za-z0-9_-]+$/.test(payload) ||
      !/^[A-Za-z0-9_-]{43}$/.test(providedSignature)
    ) {
      return false;
    }

    const expectedSignature = createHmac("sha256", passwordResetIntentKey())
      .update(payload)
      .digest("base64url");
    const provided = decodeCanonicalBase64Url(providedSignature);
    if (!provided) return false;
    const expected = Buffer.from(expectedSignature, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return false;
    }

    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      Object.keys(decoded).sort().join(",") !==
        "issuedAt,nonce,origin,userId,version" ||
      decoded.version !== 1 ||
      decoded.userId !== userId ||
      decoded.origin !== origin ||
      typeof decoded.issuedAt !== "number" ||
      !Number.isSafeInteger(decoded.issuedAt) ||
      typeof decoded.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/.test(decoded.nonce)
    ) {
      return false;
    }

    return (
      decoded.issuedAt <= now + RESET_INTENT_CLOCK_SKEW_MS &&
      now - decoded.issuedAt <= RESET_INTENT_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

export function passwordResetOriginForWorkspaceHost(
  hostKind: "canonical" | "partner",
  rawHost: string | null,
): string | null {
  if (hostKind === "canonical") return getCanonicalAppOrigin();
  const hostname = normalizeHostHeader(rawHost);
  return hostname ? `https://${hostname}` : null;
}

export async function passwordResetUserMatchesOrigin(
  userId: string,
  resolved: StrictAuthCallbackOrigin,
): Promise<boolean> {
  const business = await loadPasswordResetBusiness(userId);
  if (!business || !businessMatchesOrigin(business, resolved)) return false;

  try {
    const { resolveBusinessEmailBrand } = await import(
      "@/lib/email/businessEmailBrand.server"
    );
    const brand = await resolveBusinessEmailBrand(business.id);
    return (
      brand.publicOrigin === resolved.origin &&
      brand.partnerId === resolved.partnerId
    );
  } catch {
    return false;
  }
}

export async function processPasswordResetRequest(input: {
  email: string;
  rawHost: string | null;
}): Promise<void> {
  // Reject unknown/inactive Hosts before the intentionally exhaustive Auth
  // scan so spoofed domains cannot consume that expensive provider work.
  const resolved = await resolveStrictAuthCallbackOrigin(input.rawHost);
  if (!resolved) return;

  const user = await findAuthUserByExactEmail(input.email);
  if (!user || !isUuid(user.id)) return;

  const business = await loadPasswordResetBusiness(user.id);
  if (!business) return;

  let brand: Awaited<
    ReturnType<
      typeof import("@/lib/email/businessEmailBrand.server").resolveBusinessEmailBrand
    >
  >;
  try {
    const { resolveBusinessEmailBrand } = await import(
      "@/lib/email/businessEmailBrand.server"
    );
    brand = await resolveBusinessEmailBrand(business.id);
  } catch {
    return;
  }

  if (
    !businessMatchesOrigin(business, resolved) ||
    brand.partnerId !== resolved.partnerId ||
    brand.publicOrigin !== resolved.origin
  ) {
    return;
  }

  const callback = new URL("/api/auth/callback", resolved.origin);
  const generated = await generateAuthRecoveryLink({
    email: input.email,
    redirectTo: callback.toString(),
  });
  if (
    generated.user.id !== user.id ||
    generated.user.email?.trim().toLowerCase() !== input.email ||
    generated.verificationType !== "recovery"
  ) {
    throw new Error("Generated recovery identity did not match the request");
  }

  callback.searchParams.set("flow", "reset");
  callback.searchParams.set("token_hash", generated.hashedToken);
  callback.searchParams.set("type", "recovery");
  callback.searchParams.set(
    "state",
    createPasswordResetState(resolved.origin, generated.hashedToken),
  );

  const { sendPasswordResetEmail } = await import("@/lib/email/passwordReset");
  await sendPasswordResetEmail({
    brand,
    recipient: input.email,
    resetUrl: callback.toString(),
  });
}

async function loadPasswordResetBusiness(
  userId: string,
): Promise<PasswordResetBusiness | null> {
  if (!isUuid(userId)) return null;

  const result = await supabaseAdmin
    .from("businesses")
    .select("id,owner_id,partner_id,deleted_at")
    .eq("owner_id", userId)
    .is("deleted_at", null);
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    return null;
  }

  const row = result.data[0] as Record<string, unknown>;
  if (
    !isUuid(row.id) ||
    row.owner_id !== userId ||
    (row.partner_id !== null && !isUuid(row.partner_id)) ||
    row.deleted_at !== null
  ) {
    return null;
  }

  return {
    id: row.id,
    ownerId: userId,
    partnerId: row.partner_id,
  };
}

function businessMatchesOrigin(
  business: PasswordResetBusiness,
  resolved: StrictAuthCallbackOrigin,
): boolean {
  return resolved.kind === "direct"
    ? business.partnerId === null && resolved.partnerId === null
    : business.partnerId === resolved.partnerId;
}

function passwordResetStateKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return createHmac("sha256", secret).update(RESET_STATE_CONTEXT).digest();
}

function passwordResetIntentKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return createHmac("sha256", secret).update(RESET_INTENT_CONTEXT).digest();
}

function passwordResetStatePayload(origin: string, tokenHash: string): string {
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    !tokenHash ||
    tokenHash !== tokenHash.trim()
  ) {
    throw new Error("Password reset state input is malformed");
  }
  return `${RESET_STATE_CONTEXT}\0${origin}\0${tokenHash}`;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
