"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminSetupLinkTransfer } from "@/app/admin/AdminSetupLinkProvider";
import {
  PROVISIONING_STATUS_PRESENTATION,
  publicProvisioningJobSchema,
  type PublicProvisioningJob,
  type SetupEmailRouteResponse,
} from "@/lib/admin/clientProvisioning.shared";
import {
  btnPrimaryCompact,
  btnSecondaryCompact,
  statusDanger,
  statusInfo,
  statusNeutral,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";
import {
  parseConciergeRecoveryCallbackUrl,
  parseProvisioningRouteResponse,
} from "../CreateClientForm";

type PendingAction = "retry" | "send_email" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorCode(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : null;
}

export function parseSetupEmailRouteResponse(
  value: unknown,
): SetupEmailRouteResponse | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "provisioning")
  ) {
    return null;
  }
  const provisioning = publicProvisioningJobSchema.safeParse(
    value.provisioning,
  );
  return provisioning.success ? { provisioning: provisioning.data } : null;
}

function statusClass(
  tone: (typeof PROVISIONING_STATUS_PRESENTATION)[PublicProvisioningJob["status"]]["tone"],
): string {
  return {
    neutral: statusNeutral,
    info: statusInfo,
    warning: statusWarning,
    success: statusSuccess,
    danger: statusDanger,
  }[tone];
}

const ERROR_MESSAGES: Record<string, string> = {
  job_not_found: "The provisioning job could not be found.",
  provisioning_conflict:
    "The provisioning job no longer matches its account or business.",
  email_in_use: "That email now belongs to another account.",
  partner_inactive: "The assigned partner is no longer active and connected.",
  setup_already_completed:
    "Password setup is already complete for this client.",
  setup_email_failed: "The setup email could not be sent.",
  provisioning_in_progress:
    "Another provisioning operation is still in progress. Try again shortly.",
  provisioning_outcome_unknown:
    "The prior operation has an unknown outcome. Use Retry to reconcile it before continuing.",
  job_dismissed:
    "This provisioning job is dismissed. Restore it before continuing.",
  auth_identity_mismatch:
    "The Auth identity no longer matches this provisioning job.",
};

export function ClientProvisioningActions({
  initialProvisioning,
  expectedPartnerOrigin,
}: {
  initialProvisioning: PublicProvisioningJob;
  expectedPartnerOrigin: string | null;
}) {
  const setupLinkTransfer = useAdminSetupLinkTransfer();
  const [provisioning, setProvisioning] =
    useState<PublicProvisioningJob>(initialProvisioning);
  const [adminSetupUrl, setAdminSetupUrl] = useState<string | null>(null);
  const consumedProvisioningId = useRef<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (consumedProvisioningId.current === initialProvisioning.id) return;
    consumedProvisioningId.current = initialProvisioning.id;

    const stagedSetupUrl = setupLinkTransfer.take(initialProvisioning.id);
    const safeSetupUrl = expectedPartnerOrigin
      ? parseConciergeRecoveryCallbackUrl(stagedSetupUrl, expectedPartnerOrigin)
      : null;
    // Strict Mode may invoke this effect twice. Never let a second empty take
    // clear the secret consumed by the first invocation.
    if (safeSetupUrl) setAdminSetupUrl(safeSetupUrl);
  }, [expectedPartnerOrigin, initialProvisioning.id, setupLinkTransfer]);

  function presentError(rawPayload: unknown, fallback: string) {
    const errorCode = readErrorCode(rawPayload);
    setError((errorCode && ERROR_MESSAGES[errorCode]) || fallback);
  }

  function matchesCurrentJob(candidate: PublicProvisioningJob): boolean {
    return (
      candidate.id === provisioning.id &&
      candidate.email === provisioning.email &&
      candidate.businessName === provisioning.businessName &&
      candidate.partnerId === provisioning.partnerId &&
      candidate.partnerName === provisioning.partnerName &&
      candidate.billingMode === provisioning.billingMode &&
      candidate.partnerPlan === provisioning.partnerPlan
    );
  }

  const operationsAvailable =
    expectedPartnerOrigin !== null && provisioning.status !== "dismissed";

  async function generateAdminSetupLink() {
    if (pendingAction || !operationsAvailable || !expectedPartnerOrigin) return;
    const partnerOrigin = expectedPartnerOrigin;
    setPendingAction("retry");
    setAdminSetupUrl(null);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/admin/clients/${provisioning.id}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sendSetupEmailNow: false }),
        },
      );
      const rawPayload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        presentError(rawPayload, "A fresh setup link could not be generated.");
        return;
      }

      const payload = parseProvisioningRouteResponse(rawPayload);
      const safeSetupUrl = parseConciergeRecoveryCallbackUrl(
        payload?.adminSetupUrl,
        partnerOrigin,
      );
      if (
        !payload ||
        !safeSetupUrl ||
        !matchesCurrentJob(payload.provisioning)
      ) {
        setError("The server returned an invalid one-time setup link.");
        return;
      }

      setProvisioning(payload.provisioning);
      setAdminSetupUrl(safeSetupUrl);
      setNotice(
        "A fresh admin-held setup link was generated. It is shown only in this page session.",
      );
    } catch {
      setError("A fresh setup link could not be generated.");
    } finally {
      setPendingAction(null);
    }
  }

  async function sendFreshSetupEmail() {
    if (pendingAction || !operationsAvailable) return;
    setPendingAction("send_email");
    setAdminSetupUrl(null);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/admin/clients/${provisioning.id}/send-setup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const rawPayload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        presentError(rawPayload, "A fresh setup email could not be sent.");
        return;
      }

      const payload = parseSetupEmailRouteResponse(rawPayload);
      if (!payload || !matchesCurrentJob(payload.provisioning)) {
        setError("The server returned an invalid setup-email response.");
        return;
      }

      setProvisioning(payload.provisioning);
      setNotice("A fresh partner-branded setup email was sent.");
    } catch {
      setError("A fresh setup email could not be sent.");
    } finally {
      setPendingAction(null);
    }
  }

  const presentation = PROVISIONING_STATUS_PRESENTATION[provisioning.status];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(presentation.tone)}`}
        >
          {presentation.label}
        </span>
        <span className="text-xs text-stone-500 dark:text-[#bdbdbf]">
          Setup-link attempts: {provisioning.inviteAttemptCount}
        </span>
      </div>

      {adminSetupUrl && (
        <div className={`space-y-3 rounded-xl px-4 py-3 ${statusWarning}`}>
          <p className="text-sm font-medium">One-time admin setup link</p>
          <p className="text-xs">
            This recovery link is held only in memory and is consumed once when
            this detail view opens. It will not be available after navigation or
            a full reload.
          </p>
          <a
            href={adminSetupUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="inline-flex rounded-full bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
          >
            Open setup link in a new tab
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={generateAdminSetupLink}
          disabled={pendingAction !== null || !operationsAvailable}
          className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {pendingAction === "retry"
            ? "Generating…"
            : "Generate fresh admin setup link"}
        </button>
        <button
          type="button"
          onClick={sendFreshSetupEmail}
          disabled={pendingAction !== null || !operationsAvailable}
          className={`${btnPrimaryCompact} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {pendingAction === "send_email"
            ? "Sending…"
            : "Send fresh setup email"}
        </button>
      </div>

      {!operationsAvailable ? (
        <p className={`rounded-xl px-4 py-3 text-sm ${statusWarning}`}>
          Setup-link and email actions require an active partner with a
          connected domain. This job remains available for inspection and
          lifecycle actions.
        </p>
      ) : null}

      {notice && (
        <p className="text-sm text-green-700 dark:text-green-300">{notice}</p>
      )}
      {error && (
        <p
          role="alert"
          className={`rounded-xl px-4 py-3 text-sm ${statusDanger}`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
