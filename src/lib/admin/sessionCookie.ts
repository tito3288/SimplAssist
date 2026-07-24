// Shared by the server, browser, and middleware admin-session clients; must
// stay free of "server-only" so the browser client can import it. The name is
// the @supabase/ssr storage key: the admin session lives in "sa-admin-auth"
// cookies (chunked as .0/.1 when large), fully disjoint from the customer
// session's default "sb-<project-ref>-auth-token" namespace.
export const ADMIN_AUTH_COOKIE_NAME = "sa-admin-auth";

// @supabase/ssr's defaults omit the Secure attribute. The admin cookie is the
// highest-privilege credential in the system, so it opts in (production only —
// Secure cookies break plain-http local dev). NODE_ENV is inlined at build
// time, so this is safe in the client bundle.
export const ADMIN_AUTH_COOKIE_OPTIONS = {
  name: ADMIN_AUTH_COOKIE_NAME,
  secure: process.env.NODE_ENV === "production",
};
