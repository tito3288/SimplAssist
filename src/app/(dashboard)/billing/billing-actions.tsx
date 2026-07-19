"use client";

import { useState } from "react";
import type { SubscriptionPlan } from "@/types/database";
import { PulsingDot } from "@/components/ui/pulsing-dot";
import { primaryCtaInlineClass } from "@/lib/glass";
import { BillingPortalButton } from "@/components/billing/BillingPortalButton";

export function BillingActions({
  mode,
  plan,
}: {
  mode: "checkout" | "portal";
  plan?: SubscriptionPlan;
}) {
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Checkout error:", error);
    } finally {
      setLoading(false);
    }
  }

  if (mode === "portal") {
    return (
      <BillingPortalButton
        className={`${primaryCtaInlineClass} text-sm`}
        label="Manage Subscription"
        loadingLabel="Loading..."
      />
    );
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className={`${primaryCtaInlineClass} w-full py-2.5 text-sm`}
    >
      {loading ? (
        <>
          <PulsingDot inline />
          Loading…
        </>
      ) : (
        "Subscribe"
      )}
    </button>
  );
}
