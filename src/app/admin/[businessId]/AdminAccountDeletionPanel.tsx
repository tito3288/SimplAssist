"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  accountDeletionPreviewSchema,
  adminAccountDeletionRunSchema,
  type AdminAccountDeletionPreview,
} from "@/lib/account/adminDeletion.shared";
import { adminServiceControlReasonSchema } from "@/lib/admin/accountServiceControls.shared";
import { body, bodyFaint, statusDanger } from "@/lib/theme-v2/theme";

export function AdminAccountDeletionPanel({
  initialPreview,
}: {
  initialPreview: AdminAccountDeletionPreview;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState(initialPreview);
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledgeLiveResources, setAcknowledgeLiveResources] =
    useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const operationBlocked =
    preview.provisioningOperationState === "active" ||
    preview.provisioningOperationState === "unknown";
  const confirmationMatches = confirmationName === preview.businessName;
  const reasonValid = adminServiceControlReasonSchema.safeParse(reason).success;

  function clearModalInputs() {
    setConfirmationName("");
    setReason("");
    setAcknowledgeLiveResources(false);
  }

  function closeModal() {
    if (submitting) return;
    setOpen(false);
    clearModalInputs();
    setMessage(null);
  }

  async function submit() {
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/admin/businesses/${preview.businessId}/schedule-deletion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmationName,
            acknowledgeLiveResources,
            reason,
          }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);

      if (response.ok) {
        const result = adminAccountDeletionRunSchema.safeParse(payload);
        if (
          !result.success ||
          result.data.preview.businessId !== preview.businessId
        ) {
          setMessage("The server returned an invalid deletion result.");
          return;
        }

        setPreview(result.data.preview);
        setOpen(false);
        clearModalInputs();
        setMessage(
          result.data.adminEventCreated
            ? "Deletion scheduled and recorded in the admin audit."
            : result.data.previouslyScheduledByAdmin
              ? "This deletion was already scheduled by an admin."
              : "This deletion was already scheduled by the customer.",
        );
        router.refresh();
        return;
      }

      if (isRecord(payload) && payload.error === "live_ack_required") {
        const refreshed = accountDeletionPreviewSchema.safeParse(
          payload.preview,
        );
        if (
          refreshed.success &&
          refreshed.data.businessId === preview.businessId
        ) {
          setPreview(refreshed.data);
          setAcknowledgeLiveResources(false);
          setMessage(
            "Live resources changed. Review the refreshed summary and acknowledge it before continuing.",
          );
          return;
        }
      }

      if (isRecord(payload) && payload.error === "confirmation_mismatch") {
        setConfirmationName("");
        setMessage("The business name changed. Refresh and try again.");
        return;
      }

      setMessage(publicErrorMessage(payload));
    } catch {
      setMessage("Could not schedule deletion. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (preview.lifecycleStage === "suspended") {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/25 dark:bg-amber-500/[0.08]">
        <h2 className="font-semibold text-amber-900 dark:text-amber-100">
          Deletion scheduled
        </h2>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          This account is scheduled for terminal cleanup on{" "}
          {formatDateTime(preview.deletionScheduledFor)}. The customer may
          reactivate during the 60-day grace period.
        </p>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-red-50/60 p-4 dark:border-red-500/25 dark:bg-red-500/[0.06]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-red-900 dark:text-red-100">
            Danger Zone
          </h2>
          <p className="mt-1 text-sm text-red-800 dark:text-red-200">
            Schedule this account for deletion after a 60-day reactivation
            window. This is not immediate permanent deletion.
          </p>
          {operationBlocked ? (
            <p className="mt-2 text-sm font-medium text-red-800 dark:text-red-200">
              {preview.provisioningOperationState === "active"
                ? "Provisioning is in progress. Wait for it to finish before scheduling deletion."
                : "Provisioning has an unresolved outcome. Reconcile it before scheduling deletion."}
            </p>
          ) : null}
          {message ? <p className="mt-2 text-sm">{message}</p> : null}
        </div>
        <Button
          type="button"
          variant="danger"
          disabled={operationBlocked}
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
        >
          Schedule account deletion
        </Button>
      </div>

      <Modal
        open={open}
        onClose={closeModal}
        title="Schedule account deletion"
        description="Review the locked account state, record an admin reason, and confirm the exact business name."
      >
        <div className="space-y-5">
          <div className={`rounded-xl p-4 ${statusDanger}`}>
            <p className="text-sm font-medium">
              Deletion is scheduled for 60 days from now, not performed
              immediately. The customer may reactivate during this window.
            </p>
          </div>

          <div className={`space-y-2 text-sm ${body}`}>
            <p>
              {preview.billingMode === "stripe"
                ? "Stripe billing is paused when deletion is scheduled and canceled during terminal cleanup."
                : "This partner-managed account performs no Stripe work during scheduling or terminal cleanup."}
            </p>
            <p>
              Managed phone and Telnyx resources enter the existing release
              lifecycle; protected or shared resources may be held under the
              current policy.
            </p>
            <p>
              Auth access, partner assignment, configuration, Google
              credentials, and account-linked provisioning state are removed or
              scrubbed only at terminal cleanup. Existing audit and history rows
              described by the retention policy remain.
            </p>
          </div>

          <dl className={`grid grid-cols-2 gap-2 text-sm ${bodyFaint}`}>
            <Summary label="Lifecycle" value={preview.lifecycleStage} />
            <Summary
              label="Subscription"
              value={preview.subscriptionStatus ?? "none"}
            />
            <Summary
              label="Campaign"
              value={preview.campaignStatus ?? "none"}
            />
            <Summary
              label="Assigned phones"
              value={String(preview.assignedPhoneCount)}
            />
            <Summary
              label="Pending phone"
              value={preview.hasPendingPhoneNumber ? "yes" : "no"}
            />
            <Summary
              label="Provisioning jobs"
              value={`${preview.provisioningJobCount} (${preview.provisioningOperationState})`}
            />
          </dl>

          {preview.requiresLiveAcknowledgement ? (
            <label className={`flex items-start gap-3 text-sm ${body}`}>
              <input
                type="checkbox"
                checked={acknowledgeLiveResources}
                onChange={(event) =>
                  setAcknowledgeLiveResources(event.target.checked)
                }
                className="mt-0.5 h-4 w-4"
              />
              <span>
                I acknowledge the live subscription, campaign, or phone
                resources shown above and their release lifecycle.
              </span>
            </label>
          ) : null}

          <div>
            <label
              htmlFor="admin-deletion-reason"
              className={`mb-2 block text-sm font-medium ${body}`}
            >
              Reason for scheduling deletion (admin audit only)
            </label>
            <textarea
              id="admin-deletion-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              rows={4}
              aria-describedby="admin-deletion-reason-help"
              aria-invalid={reason.length > 0 && !reasonValid}
              className="w-full resize-y rounded-lg border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5]"
            />
            <p
              id="admin-deletion-reason-help"
              className={`mt-1 text-xs ${bodyFaint}`}
            >
              Required: 8–500 characters in a single paragraph. Do not include
              customer contact details, message content, or provider data in
              this durable admin reason.
            </p>
          </div>

          <div>
            <label className={`mb-2 block text-sm font-medium ${body}`}>
              Type the exact business name{" "}
              {JSON.stringify(preview.businessName)}
            </label>
            <input
              type="text"
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              autoComplete="off"
              className="w-full rounded-lg border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5]"
            />
          </div>

          {message ? <p className="text-sm text-red-700">{message}</p> : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={submitting}
              onClick={closeModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              loading={submitting}
              disabled={
                operationBlocked ||
                !confirmationMatches ||
                !reasonValid ||
                (preview.requiresLiveAcknowledgement &&
                  !acknowledgeLiveResources)
              }
              onClick={submit}
            >
              Schedule deletion
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 p-2 dark:border-white/[0.1]">
      <dt>{label}</dt>
      <dd className="mt-0.5 font-medium text-stone-800 dark:text-stone-100">
        {value}
      </dd>
    </div>
  );
}

function publicErrorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return "Could not schedule deletion. Try again.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "the recorded cleanup date";
  return new Date(value).toLocaleString();
}
