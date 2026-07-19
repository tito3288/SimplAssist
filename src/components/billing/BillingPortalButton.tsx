"use client";

import { useState } from "react";

export function BillingPortalButton({
  className,
  label = "Manage subscription",
  loadingLabel = "Opening…",
}: {
  className?: string;
  label?: string;
  loadingLabel?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function openPortal() {
    setLoading(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
      };
      if (!response.ok || !payload.url) {
        throw new Error("Billing Portal session was not created.");
      }
      window.location.href = payload.url;
    } catch (error) {
      console.error("Portal error:", error);
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={openPortal}
      disabled={loading}
      className={className}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}
