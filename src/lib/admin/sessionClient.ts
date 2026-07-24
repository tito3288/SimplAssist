"use client";

import { createBrowserClient } from "@supabase/ssr";
import { ADMIN_AUTH_COOKIE_OPTIONS } from "./sessionCookie";

// Browser client for the admin session channel. isSingleton: false is
// load-bearing: createBrowserClient caches a module-level singleton by
// default, so without it this call could return the already-constructed
// CUSTOMER client (default cookie name) and admin sign-in/sign-out would
// silently operate on the customer session. We memoize our own instance
// instead so one client owns the admin channel's refresh timer.
let adminBrowserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createAdminSessionBrowserClient() {
  if (!adminBrowserClient) {
    adminBrowserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: ADMIN_AUTH_COOKIE_OPTIONS,
        isSingleton: false,
      }
    );
  }
  return adminBrowserClient;
}
