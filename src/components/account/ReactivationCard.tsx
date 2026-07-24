"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";
import { textPrimary, textSecondary } from "@/lib/glass";
import { supportHref } from "@/lib/support/constants";

interface ReactivationCardProps {
  deletionDate: string;
}

type ReactivationErrorCode =
  | "stripe_resume_retryable"
  | "stripe_resume_blocked";

type ReactivationErrorState = {
  code: ReactivationErrorCode | null;
  message: string;
};

const REACTIVATION_ERROR_MESSAGES: Record<ReactivationErrorCode, string> = {
  stripe_resume_retryable:
    "We couldn't resume billing right now. Your account remains scheduled for deletion. Please try again.",
  stripe_resume_blocked:
    "We couldn't resume billing automatically. Your account remains scheduled for deletion.",
};

const GENERIC_REACTIVATION_ERROR =
  "We couldn't reactivate your account. Your account remains scheduled for deletion. Please try again.";

export default function ReactivationCard({ deletionDate }: ReactivationCardProps) {
  const [loading, setLoading] = useState(false);
  const [reactivationError, setReactivationError] =
    useState<ReactivationErrorState | null>(null);
  const router = useRouter();
  const supabase = createBrowserClient();

  const formattedDate = new Date(deletionDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  async function handleReactivate() {
    setLoading(true);
    setReactivationError(null);

    try {
      const res = await fetch("/api/account/reactivate", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: unknown;
          code?: unknown;
        } | null;

        if (isReactivationErrorCode(data?.code)) {
          setReactivationError({
            code: data.code,
            message: REACTIVATION_ERROR_MESSAGES[data.code],
          });
        } else {
          setReactivationError({
            code: null,
            message:
              typeof data?.error === "string"
                ? data.error
                : GENERIC_REACTIVATION_ERROR,
          });
        }
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("[reactivate]", err);
      setReactivationError({
        code: null,
        message: GENERIC_REACTIVATION_ERROR,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    // Global scope (default) is deliberate: the customer's remote-revocation
    // lever. Only the dedicated admin identity could be harmed by it, and it
    // must never sign into the customer app.
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
        </div>
        <h1 className={`text-xl font-bold ${textPrimary}`}>
          Account Scheduled for Deletion
        </h1>
      </div>

      <div className="rounded-xl bg-red-50 dark:bg-red-500/[0.06] border border-red-200 dark:border-red-500/20 p-4">
        <p className="text-sm text-red-800 dark:text-red-300">
          Your account and all associated data will be <strong>permanently deleted</strong> on{" "}
          <strong>{formattedDate}</strong>.
        </p>
      </div>

      <p className={`text-sm leading-relaxed ${textSecondary}`}>
        If you change your mind, you can reactivate your account now and pick up right where you left off.
        After the deletion date, your data cannot be recovered.
      </p>

      {reactivationError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/[0.06]"
        >
          <p className="text-sm text-red-800 dark:text-red-300">
            {reactivationError.message}
            {reactivationError.code === "stripe_resume_blocked" && (
              <>
                {" "}Please{" "}
                <a
                  href={supportHref("billing")}
                  className="font-medium underline underline-offset-2 hover:text-red-950 dark:hover:text-red-100"
                >
                  contact support
                </a>
                .
              </>
            )}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          onClick={handleReactivate}
        >
          Reactivate My Account
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={handleSignOut}
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}

function isReactivationErrorCode(
  value: unknown
): value is ReactivationErrorCode {
  return value === "stripe_resume_retryable" || value === "stripe_resume_blocked";
}
