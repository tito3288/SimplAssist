import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAdminUser, type AdminUser } from "./auth";
import { ClientProvisioningError } from "./clientProvisioning.server";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Origin",
} as const;

export function provisioningJson(
  body: unknown,
  init: { status?: number } = {},
): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: RESPONSE_HEADERS,
  });
}

function configuredCanonicalOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isConfiguredSameOrigin(request: NextRequest): boolean {
  const expectedOrigin = configuredCanonicalOrigin();
  const rawOrigin = request.headers.get("origin");
  if (!expectedOrigin || !rawOrigin) return false;

  try {
    const origin = new URL(rawOrigin);
    if (
      origin.origin !== expectedOrigin ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

export async function authorizeProvisioningMutation(
  request: NextRequest,
): Promise<{ admin: AdminUser } | { response: NextResponse }> {
  // getAdminUser() is itself canonical-Host-only and uses the isolated
  // sa-admin-auth cookie channel. Keep it before origin/body processing so
  // unauthorized callers receive the existing non-disclosing response.
  const admin = await getAdminUser();
  if (!admin) {
    return { response: provisioningJson({ error: "Not found" }, { status: 404 }) };
  }
  if (!isConfiguredSameOrigin(request)) {
    return {
      response: provisioningJson(
        { error: "origin_not_allowed" },
        { status: 403 },
      ),
    };
  }
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      response: provisioningJson({ error: "invalid_request" }, { status: 400 }),
    };
  }
  return { admin };
}

export async function readProvisioningJson(
  request: NextRequest,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: provisioningJson({ error: "invalid_request" }, { status: 400 }),
    };
  }
}

export function provisioningFailure(error: unknown): NextResponse {
  if (error instanceof ClientProvisioningError) {
    return provisioningJson(
      {
        error: error.code,
        ...(error.provisioningId
          ? { provisioningId: error.provisioningId }
          : {}),
      },
      { status: error.status },
    );
  }

  // Never log provider/Auth error objects here. They can echo request bodies,
  // recovery tokens, or action links.
  console.error("[admin:client-provisioning] request failed");
  return provisioningJson({ error: "provisioning_failed" }, { status: 500 });
}
