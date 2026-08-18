"use client";

import { useId, useState } from "react";

const BILLING_PORTAL_ERROR =
  "Could not open billing right now. Please try again.";

type OpenBillingPortalArgs = {
  fetcher?: typeof fetch;
  navigate: (url: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

export async function openBillingPortal({
  fetcher = fetch,
  navigate,
  setLoading,
  setError,
}: OpenBillingPortalArgs): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const response = await fetcher("/api/billing/portal", { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
    };
    if (!response.ok || !payload.url) {
      throw new Error("Billing Portal session was not created.");
    }
    navigate(payload.url);
  } catch (error) {
    console.error("Portal error:", error);
    setError(BILLING_PORTAL_ERROR);
  } finally {
    setLoading(false);
  }
}

export function BillingPortalButtonView({
  className,
  label,
  loadingLabel,
  loading,
  error,
  errorId,
  onClick,
}: {
  className?: string;
  label: string;
  loadingLabel: string;
  loading: boolean;
  error: string | null;
  errorId: string;
  onClick: () => void;
}) {
  return (
    <div className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-describedby={error ? errorId : undefined}
        className={className}
      >
        {loading ? loadingLabel : label}
      </button>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="max-w-xs text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function BillingPortalButton({
  className,
  label = "Manage subscription",
  loadingLabel = "Opening…",
}: {
  className?: string;
  label?: string;
  loadingLabel?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function openPortal() {
    void openBillingPortal({
      navigate: (url) => {
        window.location.href = url;
      },
      setLoading,
      setError,
    });
  }

  return (
    <BillingPortalButtonView
      className={className}
      label={label}
      loadingLabel={loadingLabel}
      loading={loading}
      error={error}
      errorId={errorId}
      onClick={openPortal}
    />
  );
}
