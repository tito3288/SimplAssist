import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { widgetErrorResponse } from "@/lib/widget/request.server";

export const WIDGET_EDGE_ORIGIN_HEADER =
  "x-simplassist-widget-edge-origin";

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const DIGEST_DOMAIN = "simplassist-widget-edge-origin-v1\0";

export type WidgetEdgeOriginVerification =
  | "verified"
  | "forbidden"
  | "unavailable";

/**
 * Verifies a server-only marker that the trusted edge overwrites before
 * forwarding public widget traffic to Railway. Hashing both values first
 * keeps timingSafeEqual inputs fixed-width without branching on secret length.
 */
export function verifyWidgetEdgeOrigin(
  request: Request,
  configuredSecret = process.env.WIDGET_EDGE_ORIGIN_SECRET,
): WidgetEdgeOriginVerification {
  if (!configuredSecret || !SECRET_PATTERN.test(configuredSecret)) {
    return "unavailable";
  }

  const suppliedSecret = request.headers.get(WIDGET_EDGE_ORIGIN_HEADER);
  if (!suppliedSecret || !SECRET_PATTERN.test(suppliedSecret)) {
    return "forbidden";
  }

  const expectedDigest = digestSecret(configuredSecret);
  const suppliedDigest = digestSecret(suppliedSecret);
  return timingSafeEqual(expectedDigest, suppliedDigest)
    ? "verified"
    : "forbidden";
}

export function requireWidgetEdgeOrigin(
  request: Request,
): NextResponse | null {
  const result = verifyWidgetEdgeOrigin(request);
  if (result === "verified") return null;
  if (result === "unavailable") {
    return widgetErrorResponse("service_unavailable", 503);
  }
  return widgetErrorResponse("origin_not_allowed", 403);
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(DIGEST_DOMAIN).update(secret).digest();
}
