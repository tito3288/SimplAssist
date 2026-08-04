"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  provisioningLifecycleResponseSchema,
  type ProvisioningDismissalState,
} from "@/lib/admin/clientProvisioning.shared";
import {
  statusDanger,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";

const ERROR_MESSAGES: Record<string, string> = {
  job_not_found: "The provisioning job could not be found.",
  provisioning_in_progress:
    "A provisioning operation is still in progress. Try again shortly.",
  provisioning_outcome_unknown:
    "The prior provisioning operation must be reconciled before this job can be dismissed.",
  provisioning_has_resources:
    "This job has an Auth user, business, or setup-email resource and cannot be dismissed.",
  job_not_dismissible: "This provisioning job is not eligible for dismissal.",
  provisioning_action_failed: "The provisioning action could not be completed.",
};

export function ClientProvisioningLifecycleActions({
  provisioningId,
  dismissalState,
  businessId,
}: {
  provisioningId: string;
  dismissalState: ProvisioningDismissalState;
  businessId: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(action: "dismiss" | "restore") {
    if (pending || completed) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/clients/${provisioningId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const rawPayload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = readErrorCode(rawPayload);
        setError(
          (code && ERROR_MESSAGES[code]) ||
            "The provisioning action could not be completed.",
        );
        return;
      }

      const result = provisioningLifecycleResponseSchema.safeParse(rawPayload);
      const expectedStatus =
        action === "dismiss" ? "dismissed" : "needs_attention";
      if (
        !result.success ||
        result.data.provisioningId !== provisioningId ||
        result.data.status !== expectedStatus
      ) {
        setError("The server returned an invalid provisioning result.");
        return;
      }
      setCompleted(true);
      router.refresh();
    } catch {
      setError("The provisioning action could not be completed.");
    } finally {
      setPending(false);
    }
  }

  if (dismissalState === "has_resources") {
    return (
      <div className={`space-y-3 rounded-xl p-4 ${statusWarning}`}>
        <p className="text-sm">
          This provisioning job is linked to account resources and cannot be
          dismissed. Use the account deletion lifecycle instead.
        </p>
        {businessId ? (
          <Link
            href={`/admin/${businessId}`}
            className="inline-flex rounded-full bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
          >
            Manage account deletion
          </Link>
        ) : (
          <p className="text-xs">
            Retry or reconcile this provisioning job first; no prepared business
            is linked yet.
          </p>
        )}
      </div>
    );
  }

  if (
    dismissalState === "in_progress" ||
    dismissalState === "outcome_unknown"
  ) {
    return (
      <div className={`rounded-xl p-4 text-sm ${statusWarning}`}>
        {dismissalState === "in_progress"
          ? "A provisioning operation is active. Wait for it to finish before dismissing this job."
          : "A prior provisioning operation has an unknown outcome. Retry to reconcile it before dismissal."}
      </div>
    );
  }

  if (dismissalState === "not_dismissible") {
    return (
      <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">
        This job is not currently eligible for dismissal. Only resource-free
        failed jobs, or pending jobs untouched for at least 15 minutes, can be
        dismissed.
      </p>
    );
  }

  const restoring = dismissalState === "restore";
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600 dark:text-[#bdbdbf]">
        {restoring
          ? "Restore this hidden job to Needs attention while preserving its last safe error code and reserved email."
          : "Hide this resource-free failed job from the current queue. The row and its unique email reservation remain intact."}
      </p>
      <Button
        type="button"
        size="sm"
        variant={restoring ? "secondary" : "danger"}
        disabled={pending || completed}
        onClick={() => mutate(restoring ? "restore" : "dismiss")}
      >
        {completed
          ? restoring
            ? "Restored"
            : "Dismissed"
          : pending
            ? restoring
              ? "Restoring…"
              : "Dismissing…"
            : restoring
              ? "Restore job"
              : "Dismiss failed job"}
      </Button>
      {completed ? (
        <p className={`rounded-xl p-3 text-sm ${statusSuccess}`}>
          {restoring
            ? "Provisioning job restored."
            : "Provisioning job dismissed."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={`rounded-xl p-3 text-sm ${statusDanger}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function readErrorCode(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
