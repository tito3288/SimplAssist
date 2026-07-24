import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { adminUserIds } from "@/lib/admin/allowlist";
import { isAdminPath } from "@/lib/admin/adminPath";
import { ADMIN_AUTH_COOKIE_OPTIONS } from "@/lib/admin/sessionCookie";

// Refreshes both auth channels: the customer session (default sb-* cookies,
// every matched path) and the admin session (sa-admin-auth cookies, admin
// paths only). The two clients write disjoint cookie names, but they must
// share ONE response: the canonical per-client pattern recreates the
// response inside setAll, which would drop the first client's rotated
// tokens — and a dropped Set-Cookie after refresh-token rotation kills that
// session. So each setAll only mutates the request (downstream server
// components read from it) and queues the write; the response is built once
// at the end with every queued cookie applied.
export async function updateSession(request: NextRequest) {
  const pendingCookies: {
    name: string;
    value: string;
    options: CookieOptions;
  }[] = [];

  const makeClient = (cookieOptions?: { name: string; secure: boolean }) =>
    createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        ...(cookieOptions ? { cookieOptions } : {}),
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            pendingCookies.push(...cookiesToSet);
          },
        },
      }
    );

  await makeClient().auth.getUser();

  if (isAdminPath(request.nextUrl.pathname)) {
    const adminClient = makeClient(ADMIN_AUTH_COOKIE_OPTIONS);
    const {
      data: { user },
    } = await adminClient.auth.getUser();

    // A signed-in admin-channel user who is not allowlisted is signed out
    // immediately (scope "local": revokes only this session, clears only the
    // admin cookies), so a failed admin sign-in never leaves a session
    // behind. auth-js RETURNS errors rather than throwing, so check the
    // result; on failure the session lingers but every downstream gate
    // still fails closed to 404.
    if (user && !adminUserIds().has(user.id)) {
      const { error } = await adminClient.auth.signOut({ scope: "local" });
      if (error) {
        console.error(
          "[admin-auth] Failed to revoke non-allowlisted admin-channel session:",
          error.message
        );
      }
    }
  }

  const response = NextResponse.next({ request });
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options)
  );

  return response;
}
