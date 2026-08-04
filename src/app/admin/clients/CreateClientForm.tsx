"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAdminSetupLinkTransfer } from "@/app/admin/AdminSetupLinkProvider";
import {
  type CreatePartnerClientInput,
  provisioningIdSchema,
  publicProvisioningJobSchema,
  type ProvisioningRouteResponse,
} from "@/lib/admin/clientProvisioning.shared";
import {
  btnPrimaryCompact,
  fieldLabel,
  inputField,
  statusDanger,
  statusWarning,
} from "@/lib/theme-v2/theme";
import type { PartnerBillingMode, SubscriptionPlan } from "@/types/database";

export type ActiveConnectedPartnerOption = {
  id: string;
  name: string;
  customDomain: string;
};

const PLAN_OPTIONS: Array<{
  value: SubscriptionPlan;
  label: string;
}> = [
  { value: "sms_only", label: "Starter — 500 included SMS parts" },
  { value: "sms_and_chat", label: "Growth — 1,500 included SMS parts" },
  { value: "full", label: "Full — 2,500 included SMS parts" },
];

const ERROR_MESSAGES: Record<string, string> = {
  email_in_use: "That email already belongs to an account or provisioning job.",
  partner_inactive: "That partner is no longer active and connected.",
  partner_required: "Choose an active connected partner.",
  invalid_partner_plan: "Choose a valid partner plan.",
  invalid_request: "Review the client details and try again.",
  provisioning_conflict:
    "The existing provisioning state could not be resumed safely.",
  provisioning_in_progress:
    "Another provisioning operation is still in progress. Try again shortly.",
  provisioning_outcome_unknown:
    "The prior provisioning outcome must be reconciled from the client detail page.",
  job_dismissed:
    "This email belongs to a dismissed provisioning job. Restore that job before retrying.",
  auth_identity_mismatch:
    "The existing Auth identity does not match this provisioning job.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorCode(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : null;
}

export function readFailedProvisioningId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const parsed = provisioningIdSchema.safeParse(value.provisioningId);
  return parsed.success ? parsed.data : null;
}

export function buildCreatePartnerClientRequest(input: {
  email: string;
  businessName: string;
  partnerId: string;
  billingMode: PartnerBillingMode;
  partnerPlan: SubscriptionPlan;
  sendSetupEmailNow?: boolean;
}): CreatePartnerClientInput {
  return {
    email: input.email,
    businessName: input.businessName,
    partnerId: input.partnerId,
    billingMode: input.billingMode,
    partnerPlan: input.partnerPlan,
    sendSetupEmailNow: input.sendSetupEmailNow ?? false,
  };
}

export function parseConciergeRecoveryCallbackUrl(
  value: unknown,
  expectedOrigin: string,
): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    const allowedOrigin = new URL(expectedOrigin);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== "/api/auth/callback" ||
      allowedOrigin.protocol !== "https:" ||
      !allowedOrigin.hostname ||
      allowedOrigin.port ||
      allowedOrigin.username ||
      allowedOrigin.password ||
      allowedOrigin.pathname !== "/" ||
      allowedOrigin.search ||
      allowedOrigin.hash ||
      url.origin !== allowedOrigin.origin
    ) {
      return null;
    }

    const expectedKeys = ["flow", "token_hash", "type"];
    const actualKeys = Array.from(url.searchParams.keys()).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index]) ||
      url.searchParams.getAll("flow").length !== 1 ||
      url.searchParams.getAll("token_hash").length !== 1 ||
      url.searchParams.getAll("type").length !== 1 ||
      url.searchParams.get("flow") !== "concierge" ||
      url.searchParams.get("type") !== "recovery" ||
      !url.searchParams.get("token_hash")?.trim()
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function parseProvisioningRouteResponse(
  value: unknown,
): ProvisioningRouteResponse | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).some(
      (key) => key !== "provisioning" && key !== "adminSetupUrl",
    )
  ) {
    return null;
  }

  const provisioning = publicProvisioningJobSchema.safeParse(
    value.provisioning,
  );
  if (!provisioning.success) return null;
  if (
    value.adminSetupUrl !== undefined &&
    typeof value.adminSetupUrl !== "string"
  ) {
    return null;
  }

  return {
    provisioning: provisioning.data,
    ...(typeof value.adminSetupUrl === "string"
      ? { adminSetupUrl: value.adminSetupUrl }
      : {}),
  };
}

export function CreateClientForm({
  activePartners,
}: {
  activePartners: ActiveConnectedPartnerOption[];
}) {
  const router = useRouter();
  const setupLinkTransfer = useAdminSetupLinkTransfer();
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [billingMode, setBillingMode] =
    useState<PartnerBillingMode>("invoiced");
  const [partnerPlan, setPartnerPlan] =
    useState<SubscriptionPlan>("sms_and_chat");
  const [sendSetupEmailNow, setSendSetupEmailNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedPartner = activePartners.find(
      (partner) => partner.id === partnerId,
    );
    if (!selectedPartner || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildCreatePartnerClientRequest({
            email,
            businessName,
            partnerId,
            billingMode,
            partnerPlan,
            sendSetupEmailNow,
          }),
        ),
      });
      const rawPayload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const resumableProvisioningId = readFailedProvisioningId(rawPayload);
        if (resumableProvisioningId) {
          router.push(`/admin/clients/${resumableProvisioningId}`);
          return;
        }
        const errorCode = readErrorCode(rawPayload);
        setError(
          (errorCode && ERROR_MESSAGES[errorCode]) ||
            "The partner client could not be created.",
        );
        return;
      }

      const payload = parseProvisioningRouteResponse(rawPayload);
      if (!payload) {
        setError("The server returned an invalid provisioning response.");
        return;
      }
      if (
        payload.provisioning.email !== email.trim().toLowerCase() ||
        payload.provisioning.businessName !== businessName.trim() ||
        payload.provisioning.partnerId !== selectedPartner.id ||
        payload.provisioning.partnerName !== selectedPartner.name ||
        payload.provisioning.billingMode !== billingMode ||
        payload.provisioning.partnerPlan !== partnerPlan
      ) {
        setError("The server returned a mismatched provisioning response.");
        return;
      }

      if (sendSetupEmailNow) {
        if (payload.adminSetupUrl !== undefined) {
          setError("The server returned an unexpected setup-link response.");
          return;
        }
      } else {
        const safeSetupUrl = parseConciergeRecoveryCallbackUrl(
          payload.adminSetupUrl,
          `https://${selectedPartner.customDomain}`,
        );
        if (!safeSetupUrl) {
          setError("A valid one-time setup link was not returned.");
          return;
        }
        setupLinkTransfer.stage(payload.provisioning.id, safeSetupUrl);
      }

      router.push(`/admin/clients/${payload.provisioning.id}`);
    } catch {
      setError("The partner client could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  const noEligiblePartners = activePartners.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {noEligiblePartners && (
        <p className={`rounded-xl px-4 py-3 text-sm ${statusWarning}`}>
          Create and connect an active partner before provisioning a client.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={fieldLabel}>Client email</span>
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputField}
          />
        </label>

        <label className="space-y-1.5">
          <span className={fieldLabel}>Business name</span>
          <input
            type="text"
            autoComplete="organization"
            required
            maxLength={200}
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            className={inputField}
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className={fieldLabel}>Partner</span>
        <select
          required
          value={partnerId}
          onChange={(event) => setPartnerId(event.target.value)}
          disabled={noEligiblePartners}
          className={inputField}
        >
          <option value="">Choose an active connected partner</option>
          {activePartners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.name} — {partner.customDomain}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={fieldLabel}>Billing mode</span>
          <select
            value={billingMode}
            onChange={(event) =>
              setBillingMode(event.target.value as PartnerBillingMode)
            }
            className={inputField}
          >
            <option value="invoiced">Partner invoiced</option>
            <option value="comped">Partner comped</option>
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={fieldLabel}>Partner plan</span>
          <select
            value={partnerPlan}
            onChange={(event) =>
              setPartnerPlan(event.target.value as SubscriptionPlan)
            }
            className={inputField}
          >
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan.value} value={plan.value}>
                {plan.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-[#ece4d8] p-4 text-sm dark:border-white/[0.10]">
        <input
          type="checkbox"
          checked={sendSetupEmailNow}
          onChange={(event) => setSendSetupEmailNow(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#ea580c] dark:accent-[#ff914d]"
        />
        <span>
          <span className="block font-medium">Send setup email now</span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-[#bdbdbf]">
            Leave this off to open the one-time recovery link yourself. Turn it
            on only when the partner-branded email should be sent immediately.
          </span>
        </span>
      </label>

      {error && (
        <p
          role="alert"
          className={`rounded-xl px-4 py-3 text-sm ${statusDanger}`}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || noEligiblePartners}
        className={`${btnPrimaryCompact} py-2 disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {submitting ? "Creating client…" : "Create partner client"}
      </button>
    </form>
  );
}
