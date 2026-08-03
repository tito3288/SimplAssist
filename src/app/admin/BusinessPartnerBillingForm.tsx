"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { primaryCtaCompactClass } from "@/lib/glass";
import type {
  BillingMode,
  PartnerStatus,
  SubscriptionPlan,
} from "@/types/database";

export type AdminPartnerOption = {
  id: string;
  name: string;
};

type CurrentPartner = AdminPartnerOption & {
  status: PartnerStatus | "unavailable";
};

interface BusinessPartnerBillingFormProps {
  businessId: string;
  initialPartnerId: string | null;
  initialBillingMode: BillingMode;
  initialPartnerPlan: SubscriptionPlan | null;
  currentPartner: CurrentPartner | null;
  activePartners: AdminPartnerOption[];
}

const PARTNER_PLAN_OPTIONS: Array<{
  value: SubscriptionPlan;
  label: string;
}> = [
  { value: "sms_only", label: "Starter — 500 included SMS parts" },
  { value: "sms_and_chat", label: "Growth — 1,500 included SMS parts" },
  { value: "full", label: "Full — 2,500 included SMS parts" },
];

const PARTNER_PLAN_LABELS: Record<SubscriptionPlan, string> = {
  sms_only: "Starter",
  sms_and_chat: "Growth",
  full: "Full",
};

const ERROR_MESSAGES: Record<string, string> = {
  subscription_exists:
    "Remove every Stripe subscription row before assigning partner-managed billing.",
  partner_required: "Choose an active partner for non-Stripe billing.",
  partner_inactive: "That partner is inactive or no longer available.",
  invalid_partner_plan: "Choose a valid partner plan.",
  unsupported_partner_stripe:
    "Partner assignment with Stripe billing is not supported yet.",
  business_not_found: "Business not found.",
};

export function BusinessPartnerBillingForm({
  businessId,
  initialPartnerId,
  initialBillingMode,
  initialPartnerPlan,
  currentPartner,
  activePartners,
}: BusinessPartnerBillingFormProps) {
  const router = useRouter();
  const [partnerId, setPartnerId] = useState(initialPartnerId ?? "");
  const [billingMode, setBillingMode] = useState<BillingMode>(
    initialBillingMode
  );
  const [partnerPlan, setPartnerPlan] = useState<SubscriptionPlan>(
    initialPartnerPlan ?? "sms_and_chat"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPartnerIsSelectable = activePartners.some(
    (partner) => partner.id === currentPartner?.id
  );
  const currentPartnerLabel = !currentPartner
    ? "Unassigned"
    : currentPartner.status === "unavailable"
      ? "Assigned partner unavailable"
      : `${currentPartner.name}${
          currentPartner.status === "inactive" ? " (inactive)" : ""
        }`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (billingMode === "stripe" && partnerId) {
      setError(ERROR_MESSAGES.unsupported_partner_stripe);
      return;
    }
    if (billingMode !== "stripe" && !partnerId) {
      setError(ERROR_MESSAGES.partner_required);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/business-partner-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          partnerId: partnerId || null,
          billingMode,
          partnerPlan: billingMode === "stripe" ? null : partnerPlan,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setError(
          (payload.error && ERROR_MESSAGES[payload.error]) ||
            "Could not update partner billing."
        );
        return;
      }

      router.refresh();
    } catch {
      setError("Could not update partner billing.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-stone-500 dark:text-[#bdbdbf]">
            Current partner
          </dt>
          <dd className="text-right">{currentPartnerLabel}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-stone-500 dark:text-[#bdbdbf]">
            Current billing mode
          </dt>
          <dd className="text-right capitalize">{initialBillingMode}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-stone-500 dark:text-[#bdbdbf]">
            Current partner plan
          </dt>
          <dd className="text-right">
            {initialPartnerPlan
              ? PARTNER_PLAN_LABELS[initialPartnerPlan]
              : "Not partner-managed"}
          </dd>
        </div>
      </dl>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Partner</span>
        <select
          value={partnerId}
          onChange={(event) => {
            const nextPartnerId = event.target.value;
            setPartnerId(nextPartnerId);
            setPartnerPlan(
              nextPartnerId === initialPartnerId && initialPartnerPlan
                ? initialPartnerPlan
                : "sms_and_chat"
            );
          }}
          className="w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-stone-900 dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5]"
        >
          <option value="">Unassigned</option>
          {currentPartner && !currentPartnerIsSelectable && (
            <option value={currentPartner.id} disabled>
              {currentPartner.status === "unavailable"
                ? "Assigned partner unavailable"
                : `${currentPartner.name} (inactive)`}
            </option>
          )}
          {activePartners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Partner plan</span>
        <select
          value={partnerPlan}
          disabled={billingMode === "stripe"}
          onChange={(event) =>
            setPartnerPlan(event.target.value as SubscriptionPlan)
          }
          className="w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5]"
        >
          {PARTNER_PLAN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="block text-xs text-stone-500 dark:text-[#bdbdbf]">
          New partner assignments default to Growth. Partner plans use the same
          feature matrix and included SMS allowances as Stripe plans.
        </span>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Billing mode</span>
        <select
          value={billingMode}
          onChange={(event) =>
            setBillingMode(event.target.value as BillingMode)
          }
          className="w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-stone-900 dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5]"
        >
          <option value="stripe">Stripe</option>
          <option value="invoiced">Partner invoiced</option>
          <option value="comped">Partner comped</option>
        </select>
      </label>

      <div className="space-y-2 text-xs text-amber-800 dark:text-amber-200">
        <p>
          Non-Stripe assignment is refused while any subscription row exists,
          including a canceled subscription.
        </p>
        <p>
          Returning to Stripe clears the partner plan. The business will
          require checkout before access continues.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className={`${primaryCtaCompactClass} py-2`}
      >
        {saving ? "Saving..." : "Save partner billing"}
      </button>
    </form>
  );
}
