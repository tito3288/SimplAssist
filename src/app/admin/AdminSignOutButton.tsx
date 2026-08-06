"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminSessionBrowserClient } from "@/lib/admin/sessionClient";
import { btnSecondaryCompact } from "@/lib/theme-v2/theme";

// Ends only the admin session channel: scope "local" revokes just this
// session server-side and clears only the sa-admin-auth cookies — any
// customer session in this browser stays signed in.
export default function AdminSignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const supabase = createAdminSessionBrowserClient();

  async function handleSignOut() {
    setSigningOut(true);
    try {
      // auth-js RETURNS errors rather than throwing; on failure the session
      // survives, so log and let the finally block re-enable the button.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.error("[admin-auth] Sign out failed:", error.message);
      }
    } finally {
      router.refresh();
      setSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0`}
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
