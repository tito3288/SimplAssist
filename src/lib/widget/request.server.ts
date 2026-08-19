import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

const UUID = z.string().uuid();
const SESSION_ID = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
const SESSION_NONCE = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
const MAX_BODY_BYTES = 12 * 1024;
const NO_TEXT_CONTROLS = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const NO_SINGLE_LINE_CONTROLS = /^[^\u0000-\u001f\u007f]*$/;

export const publicWidgetQuerySchema = z
  .object({ businessId: UUID, sessionId: SESSION_ID })
  .strict();

export const widgetChatRequestSchema = z
  .object({
    businessId: UUID,
    sessionId: SESSION_ID,
    sessionNonce: SESSION_NONCE.optional(),
    clientMessageId: UUID,
    message: z.string().trim().min(1).max(2000).regex(NO_TEXT_CONTROLS),
    visitorEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    visitorName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(NO_SINGLE_LINE_CONTROLS)
      .optional(),
    preview: z.boolean().optional(),
  })
  .strict();

export const widgetEndRequestSchema = z
  .object({
    businessId: UUID,
    sessionId: SESSION_ID,
    sessionNonce: SESSION_NONCE.optional(),
    preview: z.boolean().optional(),
  })
  .strict();

export const widgetLeadRequestSchema = z
  .object({
    businessId: UUID,
    sessionId: SESSION_ID,
    sessionNonce: SESSION_NONCE,
    clientLeadId: UUID,
    sourceClientMessageId: UUID,
    message: z.string().trim().min(1).max(2000).regex(NO_TEXT_CONTROLS),
    visitorEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    visitorName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(NO_SINGLE_LINE_CONTROLS)
      .optional(),
  })
  .strict()
  .refine((value) => value.visitorEmail || value.visitorName, {
    message: "A lead name or email is required",
  });

export type WidgetErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "origin_not_allowed"
  | "rate_limited"
  | "service_unavailable";

export function widgetErrorResponse(
  code: WidgetErrorCode,
  status: 400 | 401 | 403 | 429 | 503,
  options: { origin?: string; retryAfterSeconds?: number } = {},
): NextResponse {
  const response = NextResponse.json(
    {
      error: code,
      ...(status === 429 || status === 503 ? { retryable: true } : {}),
    },
    { status },
  );
  applyWidgetResponseHeaders(response, options.origin);
  if (status === 429 && options.retryAfterSeconds) {
    response.headers.set("Retry-After", String(options.retryAfterSeconds));
  }
  return response;
}

export function applyWidgetResponseHeaders(
  response: NextResponse,
  allowedOrigin?: string,
): NextResponse {
  response.headers.set("Vary", appendVary(response.headers.get("Vary"), "Origin"));
  response.headers.set("Cache-Control", "no-store");
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  }
  return response;
}

export function widgetOptionsResponse(
  allowedOrigin: string,
  method: "GET" | "POST",
): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Methods", `${method}, OPTIONS`);
  if (method === "POST") {
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
  }
  response.headers.set("Access-Control-Max-Age", "600");
  return applyWidgetResponseHeaders(response, allowedOrigin);
}

export function parseExactWidgetQuery(request: Request):
  | { ok: true; data: z.infer<typeof publicWidgetQuerySchema> }
  | { ok: false } {
  const params = new URL(request.url).searchParams;
  const keys = Array.from(params.keys());
  if (
    keys.length !== 2 ||
    new Set(keys).size !== 2 ||
    !params.has("businessId") ||
    !params.has("sessionId")
  ) {
    return { ok: false };
  }
  const parsed = publicWidgetQuerySchema.safeParse({
    businessId: params.get("businessId"),
    sessionId: params.get("sessionId"),
  });
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

export async function parseWidgetJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false }> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") return { ok: false };
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    return { ok: false };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES) {
      return { ok: false };
    }
  }

  let raw: string;
  try {
    const body = request.body;
    if (!body) return { ok: false };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    );
  } catch {
    return { ok: false };
  }
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return { ok: false };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

function appendVary(current: string | null, value: string): string {
  const values = (current ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
  return values.join(", ");
}
