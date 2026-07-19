"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock, X } from "lucide-react";
import { card } from "@/lib/theme-v2/theme";
import {
  pausedFeaturesStorageKey,
  shouldShowPaymentWarning,
} from "./statusBannerState";
import { BillingPortalButton } from "@/components/billing/BillingPortalButton";

interface FeatureStatusBannersProps {
  businessId: string;
  plan: string;
  status: string;
  pausedFeatures: string[];
}

export function FeatureStatusBanners({
  businessId,
  plan,
  status,
  pausedFeatures,
}: FeatureStatusBannersProps) {
  const storageKey = useMemo(
    () =>
      pausedFeaturesStorageKey({
        businessId,
        plan,
        status,
        pausedFeatures,
      }),
    [businessId, pausedFeatures, plan, status]
  );
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.sessionStorage.getItem(storageKey) === "dismissed");
  }, [storageKey]);

  function dismissPausedNotice() {
    window.sessionStorage.setItem(storageKey, "dismissed");
    setDismissed(true);
  }

  return (
    <div className="space-y-3">
      {shouldShowPaymentWarning(status) && (
        <div className={`${card} border-amber-300 p-4 dark:border-amber-500/40`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-900 dark:text-[#f5f5f5]">
                Payment needs attention
              </p>
              <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-[#c9c9cb]">
                Your service remains active while Stripe retries the payment. Update your payment method to avoid interruption if the subscription becomes unpaid or canceled.
              </p>
            </div>
            <BillingPortalButton
              className="shrink-0 rounded-full bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
              label="Manage billing"
              loadingLabel="Opening…"
            />
          </div>
        </div>
      )}

      {pausedFeatures.length > 0 && !dismissed && (
        <div className={`${card} border-amber-200 p-4 dark:border-amber-500/30`}>
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[#c2410c] dark:text-[#ff914d]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-900 dark:text-[#f5f5f5]">
                Some saved features are paused
              </p>
              <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-[#c9c9cb]">
                Your current plan doesn&apos;t include the features below. Their settings and history are still saved and will return when your plan includes them again.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {pausedFeatures.map((feature) => (
                  <li
                    key={feature}
                    className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700 dark:bg-white/[0.08] dark:text-[#d7d7d9]"
                  >
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/billing"
                className="mt-3 inline-flex text-xs font-semibold text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
              >
                Manage plan
              </Link>
            </div>
            <button
              type="button"
              onClick={dismissPausedNotice}
              aria-label="Dismiss paused features notice"
              className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-[#888] dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
