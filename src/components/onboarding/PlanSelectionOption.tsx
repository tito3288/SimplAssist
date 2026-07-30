"use client";

import { Check } from "lucide-react";
import { FullSuiteWaitlistButton } from "@/components/waitlist/FullSuiteWaitlistButton";
import { secondaryCtaClass } from "@/lib/glass";
import { isPlanAvailable } from "@/lib/billing/planAvailability";
import { SETUP_FEE_CENTS, SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import { cn } from "@/lib/utils";
import type { SubscriptionPlan } from "@/types/database";

interface PlanSelectionOptionProps {
  inputName: string;
  planKey: SubscriptionPlan;
  plan: (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan];
  selected: boolean;
  recommended: boolean;
  onSelect: (plan: SubscriptionPlan) => void;
}

export function PlanSelectionOption({
  inputName,
  planKey,
  plan,
  selected,
  recommended,
  onSelect,
}: PlanSelectionOptionProps) {
  const available = isPlanAvailable(planKey);
  const today = plan.price + SETUP_FEE_CENTS / 100;

  const content = (
    <>
      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-900 dark:text-[#f5f5f5]">
              {plan.name}
            </span>
            {recommended && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-[#ea580c] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white dark:bg-[#ff914d] dark:text-[#16100b]">
                Recommended
              </span>
            )}
            {!available && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-[#f5dcc4] bg-[#fdf1e7] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#c2410c] dark:border-[#ff914d]/30 dark:bg-[#ff914d]/10 dark:text-[#ffd7bf]">
                Coming Soon
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-stone-500 dark:text-[#bdbdbf]">
            {available ? "Then " : ""}
            ${plan.price}/month. Includes{" "}
            {plan.includedSmsParts.toLocaleString()} SMS parts/month.
          </span>
        </span>

        <span className="flex items-center gap-3">
          <span className="whitespace-nowrap font-medium text-stone-700 dark:text-[#d8d8d8]">
            {available ? `$${today} today` : `$${plan.price}/mo`}
          </span>
          {available && (
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                selected
                  ? "border-[#ea580c] bg-[#ea580c] text-white dark:border-[#ff914d] dark:bg-[#ff914d] dark:text-[#16100b]"
                  : recommended
                    ? "border-[#e4a677] bg-white/80 text-transparent dark:border-[#ff914d]/50 dark:bg-white/[0.05]"
                    : "border-stone-300 bg-white/80 text-transparent dark:border-white/[0.20] dark:bg-white/[0.05]"
              )}
            >
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
          )}
        </span>
      </span>

      {!available && (
        <FullSuiteWaitlistButton
          className={`${secondaryCtaClass} mt-4 w-full py-2.5 text-sm sm:w-auto`}
        />
      )}
    </>
  );

  if (!available) {
    return (
      <div
        aria-label={`${plan.name}, coming soon`}
        className="relative block rounded-[18px] border border-[#f5dcc4] bg-[#fffaf5] px-4 py-4 text-sm dark:border-[#ff914d]/30 dark:bg-[rgba(255,145,77,0.055)]"
      >
        {content}
      </div>
    );
  }

  return (
    <label
      className={cn(
        "group relative block cursor-pointer rounded-[18px] border px-4 py-4 text-sm",
        "transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none",
        "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#ea580c]/60",
        "has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[#faf7f2]",
        "dark:has-[:focus-visible]:ring-[#ff914d]/60 dark:has-[:focus-visible]:ring-offset-[#11100f]",
        selected
          ? "border-[#ea580c] bg-[#fff7ef] ring-2 ring-[#ea580c]/20 shadow-[0_10px_28px_-22px_rgba(154,52,18,0.75)] dark:border-[#ff914d] dark:bg-[rgba(255,145,77,0.11)] dark:ring-[#ff914d]/20"
          : recommended
            ? "border-[#efc5a3] bg-[#fffaf5] hover:border-[#e9ad7b] dark:border-[#ff914d]/35 dark:bg-[rgba(255,145,77,0.055)] dark:hover:border-[#ff914d]/55"
            : "border-[#e9e0d4] bg-white/70 hover:border-[#d8ccbc] hover:bg-white dark:border-white/[0.10] dark:bg-white/[0.035] dark:hover:border-white/[0.17] dark:hover:bg-white/[0.055]"
      )}
    >
      <input
        type="radio"
        name={inputName}
        value={planKey}
        checked={selected}
        onChange={() => onSelect(planKey)}
        className="sr-only"
      />
      {content}
    </label>
  );
}
