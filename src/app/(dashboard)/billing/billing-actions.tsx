"use client";

import { useState } from "react";
import type { SubscriptionPlan } from "@/types/database";
import { PulsingDot } from "@/components/ui/pulsing-dot";

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

  async function handlePortal() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Portal error:", error);
    } finally {
      setLoading(false);
    }
  }

  if (mode === "portal") {
    return (
      <button
        onClick={handlePortal}
        disabled={loading}
        className="rounded-lg bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] px-4 py-2 text-sm font-medium text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Loading..." : "Manage Subscription"}
      </button>
    );
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] px-4 py-2.5 text-sm font-medium text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:opacity-90 disabled:opacity-50"
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
