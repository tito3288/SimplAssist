"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { primaryCtaCompactClass } from "@/lib/glass";

export function A2pApproveForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [acknowledgeFeeRisk, setAcknowledgeFeeRisk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch("/api/admin/a2p-risk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId,
        note,
        acknowledgeFeeRisk,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(payload.error ?? "Could not approve review.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setNote("");
    setAcknowledgeFeeRisk(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Approval note"
        minLength={8}
        className="min-h-20 w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledgeFeeRisk}
          onChange={(event) => setAcknowledgeFeeRisk(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-[#ea580c] dark:accent-[#ff914d]"
        />
        <span>I acknowledge the Telnyx review-fee and rejection risk for this account.</span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving || note.trim().length < 8 || !acknowledgeFeeRisk}
        className={`${primaryCtaCompactClass} py-2`}
      >
        {saving ? "Approving..." : "Approve current hash"}
      </button>
    </form>
  );
}
