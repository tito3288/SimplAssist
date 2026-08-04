import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAdminUser, type AdminUser } from "./auth";
import { isCanonicalAdminHostname } from "./canonicalHost";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Origin",
} as const;

export function adminMutationJson(
  body: unknown,
  init: { status?: number } = {},
): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: RESPONSE_HEADERS,
  });
}

export async function authorizeAdminMutation(
  request: NextRequest,
): Promise<{ admin: AdminUser } | { response: NextResponse }> {
  // getAdminUser() performs the canonical Host check before reading the
  // isolated sa-admin-auth channel. Keep it first so unauthorized callers do
  // not learn whether Origin, content type, route params, or JSON are valid.
  const admin = await getAdminUser();
  if (!admin) {
    return {
      response: adminMutationJson({ error: "Not found" }, { status: 404 }),
    };
  }

  // Defense in depth at the route boundary. getAdminUser() performs the same
  // exact Host check before reading sa-admin-auth, but the adapter must remain
  // safe if its identity dependency is replaced in a test or future refactor.
  if (!isCanonicalAdminHostname(request.headers.get("host"))) {
    return {
      response: adminMutationJson({ error: "Not found" }, { status: 404 }),
    };
  }

  if (!isConfiguredSameOrigin(request)) {
    return {
      response: adminMutationJson(
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
      response: adminMutationJson(
        { error: "invalid_request" },
        { status: 400 },
      ),
    };
  }

  return { admin };
}

export async function readAdminMutationJson(
  request: NextRequest,
): Promise<
  { ok: true; value: unknown } | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: adminMutationJson(
        { error: "invalid_request" },
        { status: 400 },
      ),
    };
  }
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
