import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { ResolvedWorkspaceAccess } from "@/lib/customer/workspaceAccess.server";
import {
  getCanonicalAppHostname,
  getCanonicalAppOrigin,
} from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { supabaseAdmin } from "@/lib/supabase/admin";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ATTEMPT_LIFETIME_MS = 10 * 60 * 1000;
const HANDOFF_LIFETIME_MS = 5 * 60 * 1000;

const partnerRowSchema = z
  .object({
    id: z.string().uuid(),
    custom_domain: z.string().nullable(),
    status: z.enum(["active", "inactive"]),
    domain_status: z.enum(["pending", "connected"]),
  })
  .strict();

const stageRowSchema = z
  .object({
    attempt_id: z.string().uuid(),
    business_id: z.string().uuid(),
    owner_user_id: z.string().uuid(),
    origin_partner_id: z.string().uuid().nullable(),
    origin_hostname: z.string(),
    sanitized_result: z.enum(["access_denied", "provider_error"]).nullable(),
    handoff_expires_at: z.string(),
  })
  .strict();

const claimRowSchema = z
  .object({
    attempt_id: z.string().uuid(),
    authorization_code: z.string().nullable(),
    sanitized_result: z.enum(["access_denied", "provider_error"]).nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if ((row.authorization_code === null) === (row.sanitized_result === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAuth claim result is inconsistent",
      });
    }
    if (
      row.authorization_code !== null &&
      (row.authorization_code.length === 0 ||
        row.authorization_code.length > 4096 ||
        CONTROL_CHARACTER.test(row.authorization_code))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAuth authorization code is invalid",
      });
    }
  });

const attemptExpiryRowSchema = z.object({ expires_at: z.string() }).strict();

const settingsRowSchema = z.object({ business_id: z.string().uuid() }).strict();

export type GoogleOAuthWorkspaceIdentity = {
  businessId: string;
  ownerUserId: string;
  partnerId: string | null;
  hostname: string;
  origin: string;
  hostKind: "canonical" | "partner";
};

export type GoogleOAuthSanitizedResult = "access_denied" | "provider_error";

export type GoogleOAuthClaim = {
  attemptId: string;
  authorizationCode: string | null;
  sanitizedResult: GoogleOAuthSanitizedResult | null;
};

export type GoogleOAuthAttemptErrorCode =
  | "invalid_request"
  | "workspace_changed"
  | "attempt_invalid_or_expired"
  | "handoff_invalid_or_expired"
  | "configuration_error"
  | "service_unavailable";

export class GoogleOAuthAttemptError extends Error {
  constructor(
    readonly code: GoogleOAuthAttemptErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = "GoogleOAuthAttemptError";
  }
}

export function createGoogleOAuthOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function parseGoogleOAuthOpaqueToken(value: unknown): string | null {
  if (typeof value !== "string" || !OPAQUE_TOKEN.test(value)) return null;

  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value
      ? value
      : null;
  } catch {
    return null;
  }
}

export function digestGoogleOAuthOpaqueToken(value: string): string {
  const token = parseGoogleOAuthOpaqueToken(value);
  if (!token) throw new GoogleOAuthAttemptError("invalid_request", 400);
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isExactCanonicalGoogleCallbackHost(
  rawHost: string | null,
): boolean {
  try {
    return normalizeHostHeader(rawHost) === getCanonicalAppHostname();
  } catch {
    return false;
  }
}

export async function resolveGoogleOAuthWorkspaceIdentity(
  access: ResolvedWorkspaceAccess,
  rawHost: string | null,
): Promise<GoogleOAuthWorkspaceIdentity> {
  const requestHostname = normalizeHostHeader(rawHost);
  const canonicalHostname = getCanonicalAppHostname();
  const canonicalOrigin = getCanonicalAppOrigin();
  if (!requestHostname) throw workspaceChanged();

  if (access.hostKind === "canonical") {
    if (
      access.business.partner_id !== null ||
      requestHostname !== canonicalHostname
    ) {
      throw workspaceChanged();
    }
    return {
      businessId: access.business.id,
      ownerUserId: access.user.id,
      partnerId: null,
      hostname: canonicalHostname,
      origin: canonicalOrigin,
      hostKind: "canonical",
    };
  }

  const partnerId = access.business.partner_id;
  if (!partnerId) throw workspaceChanged();
  const hostname = await loadAvailablePartnerHostname(partnerId);
  if (!hostname || hostname !== requestHostname) throw workspaceChanged();

  return {
    businessId: access.business.id,
    ownerUserId: access.user.id,
    partnerId,
    hostname,
    origin: `https://${hostname}`,
    hostKind: "partner",
  };
}

export async function requireGoogleCalendarSettings(
  businessId: string,
): Promise<void> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin
      .from("ai_settings")
      .select("business_id")
      .eq("business_id", businessId)
      .maybeSingle();
  } catch {
    throw serviceUnavailable();
  }

  if (result.error) throw serviceUnavailable();
  const parsed = settingsRowSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.business_id !== businessId) {
    throw serviceUnavailable();
  }
}

export async function createGoogleCalendarOAuthAttempt(input: {
  identity: GoogleOAuthWorkspaceIdentity;
  state: string;
  originVerifier: string;
}): Promise<string> {
  const expiresAt = new Date(Date.now() + ATTEMPT_LIFETIME_MS).toISOString();
  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin.rpc("create_google_calendar_oauth_attempt", {
      p_state_digest: digestGoogleOAuthOpaqueToken(input.state),
      p_origin_verifier_digest: digestGoogleOAuthOpaqueToken(
        input.originVerifier,
      ),
      p_business_id: input.identity.businessId,
      p_owner_user_id: input.identity.ownerUserId,
      p_origin_partner_id: input.identity.partnerId,
      p_origin_hostname: input.identity.hostname,
      p_expires_at: expiresAt,
    });
  } catch {
    throw serviceUnavailable();
  }

  if (result.error) throw mapCreateError(result.error);
  const attemptId = z.string().uuid().safeParse(result.data);
  if (!attemptId.success) throw serviceUnavailable();
  return attemptId.data;
}

export async function stageGoogleCalendarOAuthHandoff(input: {
  state: string;
  authorizationCode: string | null;
  sanitizedResult: GoogleOAuthSanitizedResult | null;
}): Promise<{ handoff: string; returnOrigin: string }> {
  if (
    (input.authorizationCode === null) === (input.sanitizedResult === null) ||
    (input.authorizationCode !== null &&
      (input.authorizationCode.length === 0 ||
        input.authorizationCode.length > 4096 ||
        CONTROL_CHARACTER.test(input.authorizationCode)))
  ) {
    throw new GoogleOAuthAttemptError("invalid_request", 400);
  }

  const stateDigest = digestGoogleOAuthOpaqueToken(input.state);
  const handoff = createGoogleOAuthOpaqueToken();
  const attemptExpiry = await loadAttemptExpiry(stateDigest);
  const now = Date.now();
  const expiresAt = Math.min(attemptExpiry, now + HANDOFF_LIFETIME_MS);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new GoogleOAuthAttemptError("attempt_invalid_or_expired", 400);
  }

  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin.rpc("stage_google_calendar_oauth_handoff", {
      p_state_digest: stateDigest,
      p_handoff_digest: digestGoogleOAuthOpaqueToken(handoff),
      p_authorization_code: input.authorizationCode,
      p_sanitized_result: input.sanitizedResult,
      p_handoff_expires_at: new Date(expiresAt).toISOString(),
    });
  } catch {
    throw serviceUnavailable();
  }

  if (result.error) throw mapStageError(result.error);
  const parsed = stageRowSchema.safeParse(result.data);
  if (!parsed.success || !isTimestamp(parsed.data.handoff_expires_at)) {
    throw serviceUnavailable();
  }

  return {
    handoff,
    returnOrigin: await resolveStagedReturnOrigin(
      parsed.data.origin_partner_id,
      parsed.data.origin_hostname,
    ),
  };
}

export async function claimGoogleCalendarOAuthHandoff(input: {
  identity: GoogleOAuthWorkspaceIdentity;
  handoff: string;
  originVerifier: string;
}): Promise<GoogleOAuthClaim> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin.rpc("claim_google_calendar_oauth_handoff", {
      p_handoff_digest: digestGoogleOAuthOpaqueToken(input.handoff),
      p_origin_verifier_digest: digestGoogleOAuthOpaqueToken(
        input.originVerifier,
      ),
      p_business_id: input.identity.businessId,
      p_owner_user_id: input.identity.ownerUserId,
      p_origin_partner_id: input.identity.partnerId,
      p_origin_hostname: input.identity.hostname,
    });
  } catch {
    throw serviceUnavailable();
  }

  if (result.error) throw mapClaimError(result.error);
  const parsed = claimRowSchema.safeParse(result.data);
  if (!parsed.success) throw serviceUnavailable();
  return {
    attemptId: parsed.data.attempt_id,
    authorizationCode: parsed.data.authorization_code,
    sanitizedResult: parsed.data.sanitized_result,
  };
}

export async function completeGoogleCalendarOAuthConnection(input: {
  attemptId: string;
  identity: GoogleOAuthWorkspaceIdentity;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  googleEmail: string | null;
}): Promise<void> {
  const credentialResult = z
    .object({
      attemptId: z.string().uuid(),
      accessToken: z.string().min(1).max(32768),
      refreshToken: z.string().min(1).max(32768),
      tokenExpiry: z.string().refine(isFutureTimestamp),
      googleEmail: z.string().email().max(254).nullable(),
    })
    .strict()
    .safeParse({
      attemptId: input.attemptId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenExpiry: input.tokenExpiry,
      googleEmail: input.googleEmail,
    });
  if (!credentialResult.success) {
    throw new GoogleOAuthAttemptError("configuration_error", 503);
  }

  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin.rpc(
      "complete_google_calendar_oauth_connection",
      {
        p_attempt_id: credentialResult.data.attemptId,
        p_business_id: input.identity.businessId,
        p_owner_user_id: input.identity.ownerUserId,
        p_origin_partner_id: input.identity.partnerId,
        p_origin_hostname: input.identity.hostname,
        p_access_token: credentialResult.data.accessToken,
        p_refresh_token: credentialResult.data.refreshToken,
        p_token_expiry: credentialResult.data.tokenExpiry,
        p_google_email: credentialResult.data.googleEmail,
        p_calendar_id: "primary",
      },
    );
  } catch {
    throw serviceUnavailable();
  }

  if (result.error) throw mapCompleteError(result.error);
  if (result.data !== true) throw serviceUnavailable();
}

export async function purgeExpiredGoogleCalendarOAuthAttempts(): Promise<void> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin.rpc(
      "purge_expired_google_calendar_oauth_attempts",
      {},
    );
  } catch {
    throw serviceUnavailable();
  }
  if (
    result.error ||
    !z.number().int().nonnegative().safeParse(result.data).success
  ) {
    throw serviceUnavailable();
  }
}

function canonicalOriginForHostname(hostname: string): string | null {
  try {
    return hostname === getCanonicalAppHostname()
      ? getCanonicalAppOrigin()
      : null;
  } catch {
    return null;
  }
}

async function resolveStagedReturnOrigin(
  partnerId: string | null,
  hostname: string,
): Promise<string> {
  const normalized = normalizeHostHeader(hostname);
  if (!normalized || normalized !== hostname) throw workspaceChanged();

  if (partnerId === null) {
    const canonical = canonicalOriginForHostname(hostname);
    if (!canonical) throw workspaceChanged();
    return canonical;
  }

  if (hostname === getCanonicalAppHostname()) throw workspaceChanged();
  const currentHostname = await loadAvailablePartnerHostname(partnerId);
  if (currentHostname !== hostname) throw workspaceChanged();
  return `https://${hostname}`;
}

async function loadAvailablePartnerHostname(
  partnerId: string,
): Promise<string | null> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin
      .from("partners")
      .select("id,custom_domain,status,domain_status")
      .eq("id", partnerId)
      .maybeSingle();
  } catch {
    throw serviceUnavailable();
  }
  if (result.error) throw serviceUnavailable();

  const parsed = partnerRowSchema.safeParse(result.data);
  if (
    !parsed.success ||
    parsed.data.id !== partnerId ||
    parsed.data.status !== "active" ||
    parsed.data.domain_status !== "connected" ||
    typeof parsed.data.custom_domain !== "string" ||
    !parsed.data.custom_domain.includes(".") ||
    normalizeHostHeader(parsed.data.custom_domain) !==
      parsed.data.custom_domain ||
    parsed.data.custom_domain === getCanonicalAppHostname()
  ) {
    return null;
  }
  return parsed.data.custom_domain;
}

async function loadAttemptExpiry(stateDigest: string): Promise<number> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin
      .from("google_calendar_oauth_attempts")
      .select("expires_at")
      .eq("state_digest", stateDigest)
      .maybeSingle();
  } catch {
    throw serviceUnavailable();
  }
  if (result.error) throw serviceUnavailable();
  const parsed = attemptExpiryRowSchema.safeParse(result.data);
  if (!parsed.success || !isTimestamp(parsed.data.expires_at)) {
    throw new GoogleOAuthAttemptError("attempt_invalid_or_expired", 400);
  }
  return Date.parse(parsed.data.expires_at);
}

function mapCreateError(error: unknown): GoogleOAuthAttemptError {
  if (databaseErrorIs(error, "55000", "oauth_workspace_changed")) {
    return workspaceChanged();
  }
  return serviceUnavailable();
}

function mapStageError(error: unknown): GoogleOAuthAttemptError {
  if (databaseErrorIs(error, "55000", "oauth_workspace_changed")) {
    return workspaceChanged();
  }
  if (
    databaseErrorIs(error, "55000", "oauth_attempt_invalid_or_expired") ||
    databaseErrorIs(error, "22023", "invalid_oauth_handoff")
  ) {
    return new GoogleOAuthAttemptError("attempt_invalid_or_expired", 400);
  }
  return serviceUnavailable();
}

function mapClaimError(error: unknown): GoogleOAuthAttemptError {
  if (databaseErrorIs(error, "55000", "oauth_workspace_changed")) {
    return workspaceChanged();
  }
  if (
    databaseErrorIs(error, "55000", "oauth_handoff_invalid_or_expired") ||
    databaseErrorIs(error, "22023", "invalid_oauth_handoff")
  ) {
    return new GoogleOAuthAttemptError("handoff_invalid_or_expired", 400);
  }
  return serviceUnavailable();
}

function mapCompleteError(error: unknown): GoogleOAuthAttemptError {
  if (databaseErrorIs(error, "55000", "oauth_workspace_changed")) {
    return workspaceChanged();
  }
  if (databaseErrorIs(error, "55000", "oauth_attempt_invalid_or_expired")) {
    return new GoogleOAuthAttemptError("attempt_invalid_or_expired", 400);
  }
  return serviceUnavailable();
}

function databaseErrorIs(
  error: unknown,
  sqlState: string,
  token: string,
): boolean {
  if (!isRecord(error) || error.code !== sqlState) return false;
  const text = [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return new RegExp(`\\b${token}\\b`).test(text);
}

function workspaceChanged(): GoogleOAuthAttemptError {
  return new GoogleOAuthAttemptError("workspace_changed", 403);
}

function serviceUnavailable(): GoogleOAuthAttemptError {
  return new GoogleOAuthAttemptError("service_unavailable", 503);
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isFutureTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
