import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PASSWORD_RESET_INTENT_COOKIE,
  passwordResetOriginForWorkspaceHost,
  verifyPasswordResetIntent,
} from "@/lib/auth/recovery.server";
import { requirePasswordSetupRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const passwordSchema = z
  .object({
    password: z.string().min(6).max(128),
    mode: z.literal("reset").optional(),
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
  const requestOrigin = passwordResetOriginForWorkspaceHost(
    workspace.access.hostKind,
    request.headers.get("host"),
  );
  if (!requestOrigin || !isExactSameOriginRequest(request, requestOrigin)) {
    return json(
      {
        error: "same_origin_required",
        message: "Password setup must be submitted from this workspace.",
      },
      403,
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

  const isReset = parsed.mode === "reset";
  const mustSetPassword = user.app_metadata?.must_set_password === true;

  if (
    isReset &&
    !verifyPasswordResetIntent(
      user.id,
      requestOrigin,
      request.cookies.get(PASSWORD_RESET_INTENT_COOKIE)?.value,
    )
  ) {
    return json(
      {
        error: "password_reset_intent_required",
        message: "This password reset link is no longer active.",
      },
      403,
    );
  }

  if (!isReset && !mustSetPassword) {
    return json(
      {
        error: "password_setup_not_required",
        message: "This password setup link is no longer active.",
      },
      409,
    );
  }

  // Setup always consumes the literal-true gate. Recovery accepts every
  // marker state, but only writes the false tombstone when that gate was
  // actually active; ordinary password resets must not re-arm or otherwise
  // alter setup-flow metadata.
  const attributes =
    !isReset || mustSetPassword
      ? {
          password: parsed.password,
          app_metadata: {
            ...user.app_metadata,
            must_set_password: false,
          },
        }
      : { password: parsed.password };

  try {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      attributes,
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

  const response = json({ ok: true, redirectTo: "/onboarding" }, 200);
  if (isReset) expireResetIntentCookie(response, requestOrigin);
  return response;
}

function json(body: object, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isExactSameOriginRequest(
  request: NextRequest,
  expectedOrigin: string,
): boolean {
  // This endpoint changes an Auth credential. Require both browser fetch
  // metadata and an exact allow-listed current origin; neither raw Host nor
  // request.nextUrl.origin is ever accepted as a redirect or trust target.
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;

  const providedOrigin = request.headers.get("origin");
  if (!providedOrigin) return false;

  try {
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

function expireResetIntentCookie(
  response: NextResponse,
  origin: string,
): void {
  response.cookies.set({
    name: PASSWORD_RESET_INTENT_COOKIE,
    value: "",
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}
