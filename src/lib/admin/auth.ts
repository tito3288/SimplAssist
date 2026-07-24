import "server-only";

import { notFound } from "next/navigation";
import { adminUserIds } from "./allowlist";
import { createAdminSessionClient } from "./session";

export type AdminUser = {
  id: string;
  email: string | null;
};

export type AdminGateState =
  | { state: "unauthenticated" }
  | { state: "forbidden" }
  | { state: "admin"; admin: AdminUser };

// Admin identity is read from the admin session channel (sa-admin-auth
// cookies), never from the customer session — the two coexist in one
// browser. An empty allowlist is "forbidden" before any session check so an
// unconfigured deploy 404s instead of rendering a login form that can never
// succeed.
export async function getAdminGateState(): Promise<AdminGateState> {
  const allowed = adminUserIds();
  if (allowed.size === 0) return { state: "forbidden" };

  const supabase = await createAdminSessionClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { state: "unauthenticated" };
  if (!allowed.has(user.id)) return { state: "forbidden" };

  return {
    state: "admin",
    admin: { id: user.id, email: user.email ?? null },
  };
}

export async function getAdminUser(): Promise<AdminUser | null> {
  const gate = await getAdminGateState();
  return gate.state === "admin" ? gate.admin : null;
}

export async function requireAdminUser(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return admin;
}
