import "server-only";

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminUser = {
  id: string;
  email: string | null;
};

export async function getAdminUser(): Promise<AdminUser | null> {
  const allowed = adminUserIds();
  if (allowed.size === 0) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !allowed.has(user.id)) {
    return null;
  }

  return { id: user.id, email: user.email ?? null };
}

export async function requireAdminUser(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return admin;
}

function adminUserIds(): Set<string> {
  const raw = process.env.SIMPLASSIST_ADMIN_USER_IDS;
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}
