import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  SUBSCRIPTION_PLANS,
  STRIPE_PRICE_IDS,
} from "@/lib/stripe/config";
import type { SubscriptionPlan } from "@/types/database";
import { BillingActions } from "./billing-actions";

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

  const hasActiveSubscription =
    subscription && subscription.status !== "canceled";

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
      <p className="mt-2 text-gray-600">
        {hasActiveSubscription
          ? "Manage your subscription"
          : "Choose a plan to get started"}
      </p>

      {hasActiveSubscription ? (
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {SUBSCRIPTION_PLANS[subscription.plan as SubscriptionPlan]
                  ?.name ?? subscription.plan}
              </h2>
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    subscription.status === "active"
                      ? "bg-green-100 text-green-800"
                      : subscription.status === "past_due"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                  }`}
                >
                  {subscription.status.replace("_", " ")}
                </span>
                <span className="text-sm text-gray-500">
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
              className={`relative rounded-lg border bg-white p-6 shadow-sm ${
                key === "sms_and_chat"
                  ? "border-blue-500 ring-2 ring-blue-500"
                  : "border-gray-200"
              }`}
            >
              {key === "sms_and_chat" && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-0.5 text-xs font-medium text-white">
                  Recommended
                </span>
              )}
              <h3 className="text-lg font-semibold text-gray-900">
                {plan.name}
              </h3>
              <p className="mt-2">
                <span className="text-3xl font-bold text-gray-900">
                  ${plan.price}
                </span>
                <span className="text-gray-500">/mo</span>
              </p>
              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-gray-600"
                  >
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-green-500"
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
    </div>
  );
}
