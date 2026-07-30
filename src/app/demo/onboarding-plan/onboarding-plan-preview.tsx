"use client";

import { useState } from "react";
import { PlanSelectionOption } from "@/components/onboarding/PlanSelectionOption";
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

              return (
                <PlanSelectionOption
                  key={key}
                  inputName="preview-subscription-plan"
                  planKey={key}
                  plan={plan}
                  selected={selected}
                  recommended={recommended}
                  onSelect={setSelectedPlan}
                />
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
