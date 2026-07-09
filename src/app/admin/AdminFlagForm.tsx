"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface AdminFlagFormProps {
  businessId: string;
  initial: {
    billing_pilot: boolean;
    billing_comped: boolean;
    billing_exempt: boolean;
    telnyx_submission_disabled: boolean;
    sms_overage_opt_in: boolean;
    billing_admin_notes: string | null;
  };
}

export function AdminFlagForm({ businessId, initial }: AdminFlagFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState(initial);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch("/api/admin/business-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, ...flags }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(payload.error ?? "Could not update flags.");
      setSaving(false);
      return;
    }

    setSaving(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["billing_pilot", "Pilot"],
            ["billing_comped", "Comped"],
            ["billing_exempt", "Billing exempt"],
            ["telnyx_submission_disabled", "No Telnyx submit"],
            ["sms_overage_opt_in", "Overage opt-in"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(event) =>
                setFlags((current) => ({
                  ...current,
                  [key]: event.target.checked,
                }))
              }
              className="h-4 w-4 rounded accent-[#ff914d]"
            />
            {label}
          </label>
        ))}
      </div>
      <textarea
        value={flags.billing_admin_notes ?? ""}
        onChange={(event) =>
          setFlags((current) => ({
            ...current,
            billing_admin_notes: event.target.value,
          }))
        }
        placeholder="Internal notes"
        className="min-h-20 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5]"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-orange-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save flags"}
      </button>
    </form>
  );
}
