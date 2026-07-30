"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  primaryCtaCompactClass,
  secondaryCtaCompactClass,
} from "@/lib/glass";
import { inputField } from "@/lib/theme-v2/theme";

export type WaitlistSendSummary = {
  sent: number;
  failed: number;
  skipped: number;
  needsReview: number;
};

type WaitlistSendPayload =
  | { action: "test" }
  | { action: "single"; signupId: string }
  | {
      action: "bulk";
      confirmation: "SEND";
      expectedCount: number;
      cutoff: string;
    };

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const GENERIC_ERROR = "Could not send the launch email. Please try again.";

function isSummary(value: unknown): value is WaitlistSendSummary {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return ["sent", "failed", "skipped", "needsReview"].every(
    (key) =>
      typeof candidate[key] === "number" &&
      Number.isInteger(candidate[key]) &&
      (candidate[key] as number) >= 0
  );
}

export async function requestWaitlistSend(
  payload: WaitlistSendPayload,
  fetcher: Fetcher = fetch
): Promise<WaitlistSendSummary> {
  const response = await fetcher("/api/admin/waitlist/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : GENERIC_ERROR;
    throw new Error(message);
  }

  if (!isSummary(body)) {
    throw new Error(GENERIC_ERROR);
  }

  return body;
}

function SummaryMessage({ summary }: { summary: WaitlistSendSummary }) {
  return (
    <p className="text-sm text-stone-600 dark:text-[#bdbdbf]" role="status">
      Sent {summary.sent.toLocaleString()} · Failed{" "}
      {summary.failed.toLocaleString()} · Skipped{" "}
      {summary.skipped.toLocaleString()} · Review needed{" "}
      {summary.needsReview.toLocaleString()}
    </p>
  );
}

export function WaitlistLaunchControls({
  adminEmailAvailable,
  pendingRecipientCount,
  cutoff,
}: {
  adminEmailAvailable: boolean;
  pendingRecipientCount: number;
  cutoff: string;
}) {
  const router = useRouter();
  const [testSending, setTestSending] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [testSummary, setTestSummary] = useState<WaitlistSendSummary | null>(
    null
  );
  const [bulkSummary, setBulkSummary] = useState<WaitlistSendSummary | null>(
    null
  );
  const [testError, setTestError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function sendTest() {
    setTestSending(true);
    setTestError(null);
    setTestSummary(null);
    try {
      setTestSummary(await requestWaitlistSend({ action: "test" }));
    } catch (error) {
      setTestError(
        error instanceof Error ? error.message : GENERIC_ERROR
      );
    } finally {
      setTestSending(false);
    }
  }

  async function sendBulk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== "SEND" || pendingRecipientCount === 0) return;

    setBulkSending(true);
    setBulkError(null);
    setBulkSummary(null);
    try {
      const summary = await requestWaitlistSend({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: pendingRecipientCount,
        cutoff,
      });
      setBulkSummary(summary);
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setBulkError(
        error instanceof Error ? error.message : GENERIC_ERROR
      );
    } finally {
      setBulkSending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[22px] border border-[#ede5d9] bg-[#faf7f2] p-5 dark:border-white/[0.10] dark:bg-white/[0.04]">
        <h2 className="font-semibold">Send an admin test</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          Sends the launch preview only to the signed-in admin. No waitlist row
          is claimed or updated.
        </p>
        <button
          type="button"
          disabled={!adminEmailAvailable || testSending}
          onClick={sendTest}
          className={`mt-4 ${secondaryCtaCompactClass}`}
        >
          {testSending ? "Sending test..." : "Send admin test"}
        </button>
        {!adminEmailAvailable && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            The signed-in admin account needs an email address before a test
            can be sent.
          </p>
        )}
        {testSummary && (
          <div className="mt-3">
            <SummaryMessage summary={testSummary} />
          </div>
        )}
        {testError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {testError}
          </p>
        )}
      </section>

      <section className="rounded-[22px] border border-amber-200 bg-amber-50 p-5 dark:border-amber-400/25 dark:bg-amber-400/[0.08]">
        <h2 className="font-semibold">Send to all pending</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-[#d4d4d8]">
          This snapshot contains{" "}
          <strong>
            {pendingRecipientCount.toLocaleString()} sendable pending
            recipients
          </strong>
          . Claimed rows are excluded, and newer signups remain pending.
        </p>
        <form onSubmit={sendBulk} className="mt-4 space-y-3">
          <label className="block text-sm font-medium" htmlFor="bulk-confirmation">
            Type <span className="font-mono">SEND</span> to confirm
          </label>
          <input
            id="bulk-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="SEND"
            className={`${inputField} max-w-xs`}
          />
          <button
            type="submit"
            disabled={
              bulkSending ||
              pendingRecipientCount === 0 ||
              confirmation !== "SEND"
            }
            className={primaryCtaCompactClass}
          >
            {bulkSending
              ? "Sending to pending..."
              : `Send to all pending (${pendingRecipientCount.toLocaleString()})`}
          </button>
        </form>
        {bulkSummary && (
          <div className="mt-3">
            <SummaryMessage summary={bulkSummary} />
          </div>
        )}
        {bulkError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {bulkError}
          </p>
        )}
      </section>
    </div>
  );
}

export function WaitlistSingleSendButton({
  signupId,
}: {
  signupId: string;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<WaitlistSendSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendSingle() {
    setSending(true);
    setError(null);
    setSummary(null);
    try {
      const result = await requestWaitlistSend({
        action: "single",
        signupId,
      });
      setSummary(result);
      router.refresh();
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : GENERIC_ERROR
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={sending}
        onClick={sendSingle}
        className={secondaryCtaCompactClass}
      >
        {sending ? "Sending..." : "Send"}
      </button>
      {summary && (
        <p className="text-xs text-stone-500 dark:text-[#bdbdbf]" role="status">
          Sent {summary.sent}; failed {summary.failed}; skipped{" "}
          {summary.skipped}; review {summary.needsReview}
        </p>
      )}
      {error && (
        <p className="max-w-40 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
