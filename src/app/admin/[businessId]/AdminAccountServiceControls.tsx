"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  adminAccountServiceControlResponseSchema,
  type AdminAccountServiceControlRequest,
  type AdminAccountServiceControlResponse,
  type AdminOperationalControlSnapshot,
} from "@/lib/admin/accountServiceControls.shared";
import {
  body,
  bodyFaint,
  card,
  inputField,
  statusDanger,
  statusSuccess,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";
import type { BillingMode } from "@/types/database";

type InitialOperationalControls = Omit<
  AdminOperationalControlSnapshot,
  "businessId"
>;

type PendingControlAction =
  | { action: "suspend" }
  | { action: "reactivate" }
  | {
      action: "pause";
      service: ServiceControlKey;
    }
  | {
      action: "resume";
      service: ServiceControlKey;
    };

type ServiceControlKey = "ai_replies" | "texting" | "bookings";

interface AdminAccountServiceControlsProps {
  businessId: string;
  billingMode: BillingMode;
  initialControls: InitialOperationalControls;
}

const SERVICE_ROWS: ReadonlyArray<{
  key: ServiceControlKey;
  label: string;
  timestampKey:
    | "aiRepliesPausedAt"
    | "textingPausedAt"
    | "bookingsPausedAt";
  description: string;
}> = [
  {
    key: "ai_replies",
    label: "AI replies",
    timestampKey: "aiRepliesPausedAt",
    description: "Controls automated AI replies across supported channels.",
  },
  {
    key: "texting",
    label: "Texting",
    timestampKey: "textingPausedAt",
    description: "Controls outbound manual and automated text messages.",
  },
  {
    key: "bookings",
    label: "Bookings",
    timestampKey: "bookingsPausedAt",
    description: "Controls creation of new appointments and bookings.",
  },
];

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function AdminAccountServiceControls({
  businessId,
  billingMode,
  initialControls,
}: AdminAccountServiceControlsProps) {
  const router = useRouter();
  const [controls, setControls] = useState<AdminOperationalControlSnapshot>({
    businessId,
    ...initialControls,
  });
  const [pendingAction, setPendingAction] =
    useState<PendingControlAction | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accountSuspended = controls.operationsSuspendedAt !== null;
  const normalizedReason = reason.trim();
  const reasonValid = isReasonValid(pendingAction, reason, normalizedReason);

  function openConfirmation(action: PendingControlAction) {
    setPendingAction(action);
    setReason("");
    setModalError(null);
    setNotice(null);
  }

  function closeConfirmation() {
    if (submitting) return;
    setPendingAction(null);
    setReason("");
    setModalError(null);
  }

  async function submit() {
    if (!pendingAction || !reasonValid) return;

    const request = buildRequest(pendingAction, normalizedReason);
    setSubmitting(true);
    setModalError(null);

    try {
      const response = await fetch(
        `/api/admin/businesses/${businessId}/service-controls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setModalError(publicErrorMessage(response.status, payload));
        return;
      }

      const parsed = adminAccountServiceControlResponseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.controls.businessId !== businessId) {
        setModalError("The server returned an invalid service-control result.");
        return;
      }

      const result: AdminAccountServiceControlResponse = parsed.data;
      setControls(result.controls);
      setPendingAction(null);
      setReason("");
      setNotice(
        result.changed
          ? "Service controls updated and recorded in the admin audit."
          : "The requested state was already current; no new audit event was recorded.",
      );
      router.refresh();
    } catch {
      setModalError("Could not update service controls. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className={`${card} p-5 sm:p-6`}
      aria-labelledby="account-service-controls-heading"
    >
      <div>
        <h2
          id="account-service-controls-heading"
          className="text-lg font-semibold"
        >
          Service controls
        </h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Suspend business activity or independently pause a service while
          preserving dashboard access and account data.
        </p>
      </div>

      {notice ? (
        <p className={`mt-4 rounded-2xl px-4 py-3 text-sm ${statusSuccess}`}>
          {notice}
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        <ControlRow
          label="Account operations"
          description={
            accountSuspended
              ? `Suspended ${formatTimestamp(controls.operationsSuspendedAt!)}. Dashboard access and stored data remain available.`
              : "Active. Suspending blocks business activity but preserves dashboard access and stored data."
          }
          stateLabel={accountSuspended ? "Suspended" : "Active"}
          stateTone={accountSuspended ? "danger" : "success"}
          actionLabel={accountSuspended ? "Reactivate account" : "Suspend account"}
          actionVariant={accountSuspended ? "primary" : "danger"}
          onAction={() =>
            openConfirmation({
              action: accountSuspended ? "reactivate" : "suspend",
            })
          }
        />

        {SERVICE_ROWS.map((service) => {
          const pausedAt = controls[service.timestampKey];
          const independentlyPaused = pausedAt !== null;
          const effectiveNote =
            accountSuspended && !independentlyPaused
              ? " Independently active; effectively paused by account suspension."
              : "";

          return (
            <ControlRow
              key={service.key}
              label={service.label}
              description={`${service.description} ${
                independentlyPaused
                  ? `Independently paused ${formatTimestamp(pausedAt)}.`
                  : "Independently active."
              }${effectiveNote}`}
              stateLabel={independentlyPaused ? "Paused" : "Active"}
              stateTone={independentlyPaused ? "warning" : "success"}
              actionLabel={`${independentlyPaused ? "Resume" : "Pause"} ${
                service.key === "ai_replies"
                  ? service.label
                  : service.label.toLowerCase()
              }`}
              actionVariant={independentlyPaused ? "primary" : "secondary"}
              onAction={() =>
                openConfirmation({
                  action: independentlyPaused ? "resume" : "pause",
                  service: service.key,
                })
              }
            />
          );
        })}
      </div>

      <Modal
        open={pendingAction !== null}
        onClose={closeConfirmation}
        title={pendingAction ? confirmationTitle(pendingAction) : undefined}
        description="Confirm the operational change before it is recorded."
      >
        <div className="space-y-5">
          {pendingAction ? (
            <div
              className={`rounded-xl p-4 text-sm ${
                pendingAction.action === "suspend"
                  ? statusDanger
                  : statusWarning
              }`}
            >
              <p className="font-medium">{confirmationCopy(pendingAction)}</p>
              {pendingAction.action === "reactivate" ? (
                <p className="mt-2">
                  Reactivation does not resume independently paused services.
                </p>
              ) : null}
            </div>
          ) : null}

          {pendingAction && isAccountAction(pendingAction) ? (
            <p className={`text-sm ${body}`}>
              {billingMode === "stripe"
                ? "Suspension does not pause your Stripe subscription; billing continues."
                : "Billing remains managed by your partner; SimplAssist has not changed it."}
            </p>
          ) : null}

          <div>
            <label
              htmlFor="admin-service-control-reason"
              className="mb-2 block text-sm font-medium"
            >
              Reason {pendingAction && isAccountAction(pendingAction) ? "(required)" : "(optional)"}
            </label>
            <textarea
              id="admin-service-control-reason"
              value={reason}
              rows={4}
              onChange={(event) => setReason(event.target.value)}
              className={inputField}
            />
            <p className={`mt-2 text-xs ${bodyFaint}`}>
              When supplied, use 8–500 characters. Do not include customer
              contact details, message content, or provider data in this durable
              admin reason.
            </p>
          </div>

          {normalizedReason !== "" && !reasonValid ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              Enter 8–500 characters without control characters.
            </p>
          ) : null}
          {modalError ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              {modalError}
            </p>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={submitting}
              onClick={closeConfirmation}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={
                pendingAction?.action === "suspend" ? "danger" : "primary"
              }
              className="flex-1"
              loading={submitting}
              disabled={!pendingAction || !reasonValid}
              onClick={submit}
            >
              Confirm change
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function ControlRow({
  label,
  description,
  stateLabel,
  stateTone,
  actionLabel,
  actionVariant,
  onAction,
}: {
  label: string;
  description: string;
  stateLabel: string;
  stateTone: "success" | "warning" | "danger";
  actionLabel: string;
  actionVariant: "primary" | "secondary" | "danger";
  onAction: () => void;
}) {
  const stateClass =
    stateTone === "success"
      ? statusSuccess
      : stateTone === "warning"
        ? statusWarning
        : statusDanger;

  return (
    <div
      className={`${tile} flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{label}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs ${stateClass}`}>
            {stateLabel}
          </span>
        </div>
        <p className={`mt-1 text-sm ${bodyFaint}`}>{description}</p>
      </div>
      <Button
        type="button"
        variant={actionVariant}
        className="shrink-0"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function buildRequest(
  action: PendingControlAction,
  normalizedReason: string,
): AdminAccountServiceControlRequest {
  if (isAccountAction(action)) {
    return { action: action.action, reason: normalizedReason };
  }

  return normalizedReason === ""
    ? { action: action.action, service: action.service }
    : {
        action: action.action,
        service: action.service,
        reason: normalizedReason,
      };
}

function isReasonValid(
  action: PendingControlAction | null,
  rawReason: string,
  normalizedReason: string,
): boolean {
  if (!action) return false;
  if (normalizedReason === "") return !isAccountAction(action);
  const characterCount = Array.from(normalizedReason).length;
  return (
    characterCount >= 8 &&
    characterCount <= 500 &&
    !CONTROL_CHARACTERS.test(rawReason)
  );
}

function isAccountAction(
  action: PendingControlAction,
): action is Extract<PendingControlAction, { action: "suspend" | "reactivate" }> {
  return action.action === "suspend" || action.action === "reactivate";
}

function confirmationTitle(action: PendingControlAction): string {
  if (action.action === "suspend") return "Suspend account operations";
  if (action.action === "reactivate") return "Reactivate account operations";
  const label = serviceLabel(action.service);
  return `${action.action === "pause" ? "Pause" : "Resume"} ${label}`;
}

function confirmationCopy(action: PendingControlAction): string {
  if (action.action === "suspend") {
    return "Suspension blocks AI replies, texting, new bookings, and voice forwarding. Dashboard access and stored account data remain available.";
  }
  if (action.action === "reactivate") {
    return "Reactivation restores account-level operations while preserving each independently paused service.";
  }
  const label = serviceLabel(action.service);
  return action.action === "pause"
    ? `${label} will be independently paused until an admin resumes it.`
    : `${label} will resume unless account operations remain suspended.`;
}

function serviceLabel(service: ServiceControlKey): string {
  return SERVICE_ROWS.find((row) => row.key === service)?.label ?? service;
}

function publicErrorMessage(status: number, payload: unknown): string {
  if (
    status === 409 &&
    isRecord(payload) &&
    payload.error === "account_deletion_in_progress"
  ) {
    return "Service controls are unavailable while account deletion is in progress.";
  }
  if (
    status === 400 &&
    isRecord(payload) &&
    payload.error === "invalid_request"
  ) {
    return "Review the requested change and reason, then try again.";
  }
  return "Could not update service controls. Try again.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}
