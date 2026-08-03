import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { requirePasswordSetupRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const passwordSchema = z
  .object({
    password: z.string().min(6).max(128),
  })
  .strict();

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const workspace = await requirePasswordSetupRouteAccess();
  if (!workspace.ok) {
    workspace.response.headers.set("Cache-Control", "private, no-store");
    return workspace.response;
  }

  const { user } = workspace.access;
  if (!isExactSameOriginRequest(request, workspace.access.hostKind)) {
    return json(
      {
        error: "same_origin_required",
        message: "Password setup must be submitted from this workspace.",
      },
      403,
    );
  }

  if (user.app_metadata?.must_set_password !== true) {
    return json(
      {
        error: "password_setup_not_required",
        message: "This password setup link is no longer active.",
      },
      409,
    );
  }

  let parsed: z.infer<typeof passwordSchema>;
  try {
    parsed = passwordSchema.parse(await request.json());
  } catch {
    return json(
      {
        error: "invalid_password",
        message: "Password must be between 6 and 128 characters.",
      },
      400,
    );
  }

  // Retain an explicit false tombstone while preserving unrelated app
  // metadata. Every setup gate activates on literal true only, so stale or
  // malformed values fail closed and a replay cannot reopen this flow.
  const appMetadata = {
    ...user.app_metadata,
    must_set_password: false,
  };

  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      {
        password: parsed.password,
        app_metadata: appMetadata,
      },
    );

    if (error || !data.user || data.user.id !== user.id) {
      return json(
        {
          error: "password_update_failed",
          message: "We could not set your password. Please try again.",
        },
        500,
      );
    }
  } catch {
    return json(
      {
        error: "password_update_failed",
        message: "We could not set your password. Please try again.",
      },
      500,
    );
  }

  return json({ ok: true, redirectTo: "/onboarding" }, 200);
}

function json(body: object, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isExactSameOriginRequest(
  request: NextRequest,
  hostKind: "canonical" | "partner",
): boolean {
  // This endpoint changes an Auth credential. Require both browser fetch
  // metadata and an exact allow-listed current origin; neither raw Host nor
  // request.nextUrl.origin is ever accepted as a redirect or trust target.
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;

  const providedOrigin = request.headers.get("origin");
  if (!providedOrigin) return false;

  let expectedOrigin: string;
  try {
    if (hostKind === "canonical") {
      expectedOrigin = getCanonicalAppOrigin();
    } else {
      const hostname = normalizeHostHeader(request.headers.get("host"));
      if (!hostname) return false;
      expectedOrigin = `https://${hostname}`;
    }

    const parsedOrigin = new URL(providedOrigin);
    return (
      (parsedOrigin.protocol === "https:" ||
        parsedOrigin.protocol === "http:") &&
      parsedOrigin.origin === expectedOrigin &&
      !parsedOrigin.username &&
      !parsedOrigin.password &&
      parsedOrigin.pathname === "/" &&
      !parsedOrigin.search &&
      !parsedOrigin.hash
    );
  } catch {
    return false;
  }
}
