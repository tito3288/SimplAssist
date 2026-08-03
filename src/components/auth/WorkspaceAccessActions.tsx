"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { btnPrimaryWide } from "@/lib/theme-v2/theme";

type CustomerBrowserClient = ReturnType<typeof createBrowserClient>;

export async function signOutAndNavigateToLogin(
  client: Pick<CustomerBrowserClient, "auth">,
  navigate: (path: string) => void
): Promise<void> {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;

  // A relative destination always stays on the current host. Workspace access
  // never accepts a destination from a query parameter or another caller.
  navigate("/login");
}

export function WorkspaceAccessActions() {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = createBrowserClient();

  async function useDifferentAccount() {
    setSigningOut(true);
    setError(null);

    try {
      await signOutAndNavigateToLogin(client, (path) => {
        window.location.assign(path);
      });
    } catch {
      setError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={signingOut}
        onClick={useDifferentAccount}
        className={btnPrimaryWide}
      >
        {signingOut ? "Signing out…" : "Use a different account here"}
      </button>
      {error && (
        <p className="text-center text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
