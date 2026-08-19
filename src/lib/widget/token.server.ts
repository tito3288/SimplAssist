import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const TOKEN_VERSION = "v1";
const SIGNING_CONTEXT = "simplassist-widget-session:v1:";
const MIN_SECRET_BYTES = 32;
const TOKEN_TTL_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LENGTH = 2048;
const UUID = z.string().uuid();
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const payloadSchema = z
  .object({
    b: UUID,
    o: z.string().url().max(2048),
    s: z.string().regex(SESSION_ID_PATTERN),
    n: z.string().regex(NONCE_PATTERN),
    i: z.number().int().nonnegative(),
    e: z.number().int().positive(),
  })
  .strict();

export type WidgetTokenBinding = {
  businessId: string;
  origin: string;
  sessionId: string;
  sessionNonce: string;
};

export type MintedWidgetToken = {
  token: string;
  sessionNonce: string;
  expiresAt: string;
};

function widgetTokenSecret(override?: string): string {
  const secret = override ?? process.env.WIDGET_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("WIDGET_TOKEN_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${SIGNING_CONTEXT}${encodedPayload}`)
    .digest();
}

export function mintWidgetToken(
  input: Omit<WidgetTokenBinding, "sessionNonce">,
  options: { secret?: string; now?: Date; nonce?: string } = {},
): MintedWidgetToken {
  const secret = widgetTokenSecret(options.secret);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const sessionNonce =
    options.nonce ?? randomBytes(18).toString("base64url");
  if (!NONCE_PATTERN.test(sessionNonce)) {
    throw new Error("A canonical widget session nonce is required");
  }

  const payload = payloadSchema.parse({
    b: input.businessId,
    o: input.origin,
    s: input.sessionId,
    n: sessionNonce,
    i: nowSeconds,
    e: nowSeconds + TOKEN_TTL_SECONDS,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const encodedSignature = signature(encodedPayload, secret).toString(
    "base64url",
  );

  return {
    token: `${TOKEN_VERSION}.${encodedPayload}.${encodedSignature}`,
    sessionNonce,
    expiresAt: new Date(payload.e * 1000).toISOString(),
  };
}

export function verifyWidgetToken(
  token: string,
  expected: WidgetTokenBinding,
  options: { secret?: string; now?: Date } = {},
): boolean {
  const secret = widgetTokenSecret(options.secret);
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, encodedPayload, encodedSignature] = parts;
  if (
    version !== TOKEN_VERSION ||
    !encodedPayload ||
    !SIGNATURE_PATTERN.test(encodedSignature)
  ) {
    return false;
  }

  let parsedPayload: unknown;
  try {
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload) return false;
    parsedPayload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return false;
  }

  const payload = payloadSchema.safeParse(parsedPayload);
  if (!payload.success) return false;

  const providedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signature(encodedPayload, secret);
  if (
    providedSignature.toString("base64url") !== encodedSignature ||
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return false;
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const claims = payload.data;
  return (
    claims.b === expected.businessId &&
    claims.o === expected.origin &&
    claims.s === expected.sessionId &&
    claims.n === expected.sessionNonce &&
    claims.i <= nowSeconds + MAX_CLOCK_SKEW_SECONDS &&
    claims.e > nowSeconds &&
    claims.e - claims.i === TOKEN_TTL_SECONDS
  );
}

export function readWidgetBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > MAX_TOKEN_LENGTH + 7) return null;
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}
