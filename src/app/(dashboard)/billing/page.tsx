import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import type { SubscriptionPlan } from "@/types/database";
import { BillingActions } from "./billing-actions";
import {
  card,
  cardRecommended,
  statusSuccess,
  statusWarning,
  statusDanger,
} from "@/lib/theme-v2/theme";

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) redirect("/onboarding");

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("business_id", business.id)
    .single();

  const { data: usagePeriod } = await supabase
    .from("billing_usage_periods")
    .select("*")
    .eq("business_id", business.id)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasActiveSubscription =
    subscription && subscription.status !== "canceled";
  const usedSmsParts = usagePeriod
    ? usagePeriod.inbound_sms_parts + usagePeriod.outbound_sms_parts
    : 0;
  const includedSmsParts = usagePeriod?.included_sms_parts ?? 0;
  const usagePercent =
    includedSmsParts > 0 ? Math.min(100, Math.round((usedSmsParts / includedSmsParts) * 100)) : 0;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">Billing</h1>
      <p className="mt-2 text-stone-500 dark:text-[#bdbdbf]">
        {hasActiveSubscription
          ? "Manage your subscription"
          : "Choose a plan to get started"}
      </p>

      {hasActiveSubscription ? (
        <div className={`mt-8 p-6 ${card}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5]">
                {SUBSCRIPTION_PLANS[subscription.plan as SubscriptionPlan]
                  ?.name ?? subscription.plan}
              </h2>
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    subscription.status === "active"
                      ? statusSuccess
                      : subscription.status === "past_due"
                        ? statusWarning
                        : statusDanger
                  }`}
                >
                  {subscription.status.replace("_", " ")}
                </span>
                <span className="text-sm text-stone-500 dark:text-[#bdbdbf]">
                  Next billing date:{" "}
                  {new Date(
                    subscription.current_period_end
                  ).toLocaleDateString()}
                </span>
              </div>
            </div>
            <BillingActions mode="portal" />
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {(
            Object.entries(SUBSCRIPTION_PLANS) as [
              SubscriptionPlan,
              (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan],
            ][]
          ).map(([key, plan]) => (
            <div
              key={key}
              className={`relative p-6 rounded-[28px] ${
                key === "sms_and_chat" ? cardRecommended : card
              }`}
            >
              {key === "sms_and_chat" && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ea580c] dark:bg-[#ff914d] px-3 py-0.5 text-xs font-medium text-white dark:text-[#16100b]">
                  Recommended
                </span>
              )}
              <h3 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5]">
                {plan.name}
              </h3>
              <p className="mt-2">
                <span className="text-3xl font-bold text-stone-900 dark:text-[#f5f5f5]">
                  ${plan.price}
                </span>
                <span className="text-stone-500 dark:text-[#bdbdbf]">/mo</span>
              </p>
              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-stone-500 dark:text-[#bdbdbf]"
                  >
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#c2410c] dark:text-[#ff914d]"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <BillingActions mode="checkout" plan={key} />
              </div>
            </div>
          ))}
        </div>
      )}

      {hasActiveSubscription && (
        <div className={`mt-6 p-6 ${card}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5]">
                SMS usage
              </h2>
              <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
                Current billing period usage counts inbound and outbound SMS parts.
              </p>
            </div>
            <div className="text-sm font-medium text-stone-700 dark:text-[#d8d8d8]">
              {usedSmsParts.toLocaleString()} / {includedSmsParts.toLocaleString()} parts
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-white/[0.10]">
            <div
              className={`h-full rounded-full ${
                usagePercent >= 100
                  ? "bg-red-500"
                  : usagePercent >= 80
                    ? "bg-amber-500"
                    : "bg-green-500"
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-stone-500 dark:text-[#bdbdbf]">
            {usagePercent >= 100
              ? "Outbound SMS is paused until you upgrade or enable overages."
              : usagePercent >= 80
                ? "You are close to your included SMS parts for this period."
                : "Your SMS usage is within the included amount."}
          </p>
        </div>
      )}
    </div>
  );
}
