"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import StepProgress from "@/components/onboarding/StepProgress";
import { SETUP_FEE_CENTS, SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import { SETUP_FEE_EXPLAINER_PATH } from "@/lib/support/constants";
import { statusNeutral, tile } from "@/lib/theme-v2/theme";
import { cn } from "@/lib/utils";
import type { SubscriptionPlan } from "@/types/database";

const RECOMMENDED_PLAN: SubscriptionPlan = "sms_and_chat";
const SETUP_FEE = SETUP_FEE_CENTS / 100;

export function OnboardingPlanPreview() {
  const [selectedPlan, setSelectedPlan] =
    useState<SubscriptionPlan>(RECOMMENDED_PLAN);

  return (
    <>
      <StepProgress currentStep={8} />

      <div className="mb-5 rounded-[18px] border border-[#ede5d9] bg-[#faf7f2] px-4 py-3 text-sm text-stone-600 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#bdbdbf]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Your progress is saved.</span>
          <span className="text-xs text-stone-500 dark:text-[#888]">
            Continue setup: Review &amp; Pay
          </span>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
            Review &amp; Pay
          </h1>
          <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">
            Choose your plan and pay before we submit your SMS registration for
            carrier review.
          </p>
        </div>

        <section className={cn("p-4", tile)} aria-labelledby="plan-section-title">
          <h2
            id="plan-section-title"
            className="mb-3 font-medium text-stone-900 dark:text-[#f5f5f5]"
          >
            Plan &amp; Setup Fee
          </h2>

          <fieldset className="space-y-3">
            <legend className="sr-only">Choose a SimplAssist plan</legend>

            {(
              Object.entries(SUBSCRIPTION_PLANS) as [
                SubscriptionPlan,
                (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan],
              ][]
            ).map(([key, plan]) => {
              const selected = selectedPlan === key;
              const recommended = key === RECOMMENDED_PLAN;
              const today = plan.price + SETUP_FEE;

              return (
                <label
                  key={key}
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
                    name="preview-subscription-plan"
                    value={key}
                    checked={selected}
                    onChange={() => setSelectedPlan(key)}
                    className="sr-only"
                  />

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
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-stone-500 dark:text-[#bdbdbf]">
                        Then ${plan.price}/month. Includes{" "}
                        {plan.includedSmsParts.toLocaleString()} SMS parts/month.
                      </span>
                    </span>

                    <span className="flex items-center gap-3">
                      <span className="whitespace-nowrap font-medium text-stone-700 dark:text-[#d8d8d8]">
                        ${today} today
                      </span>
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
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className={cn("mt-3 rounded-[16px] p-3 text-xs", statusNeutral)}>
            <p className="font-medium text-stone-800 dark:text-[#f5f5f5]">
              ${SETUP_FEE} one-time setup and SMS activation fee
            </p>
            <p className="mt-1 leading-relaxed">
              This covers your business&apos;s registration with AT&amp;T, T-Mobile,
              Verizon, Cricket, Metro, Visible, Mint, Boost, and every other
              U.S. carrier via The Campaign Registry, plus phone number
              activation and the compliance pages carriers require — so your
              messages are delivered reliably instead of filtered as spam.
            </p>
            <a
              href={SETUP_FEE_EXPLAINER_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-medium underline underline-offset-2 hover:text-[#ea580c] dark:hover:text-[#ff914d]"
            >
              Learn more about this fee →
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
