"use client";

import { useState } from "react";
import type { SubscriptionPlan } from "@/types/database";

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
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? "Loading..." : "Manage Subscription"}
      </button>
    );
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${
        plan === "sms_and_chat"
          ? "bg-blue-600 hover:bg-blue-700"
          : "bg-gray-900 hover:bg-gray-800"
      }`}
    >
      {loading ? "Loading..." : "Subscribe"}
    </button>
  );
}
