"use client";

import { useState } from "react";
import { ArrowRight, PhoneForwarded, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { orangeAccentIcon } from "@/lib/glass";
import { body, card, ink } from "@/lib/theme-v2/theme";

const NUDGE_ENDPOINT = "/api/settings/call-forwarding/nudge";

async function resolveNudge(): Promise<void> {
  const response = await fetch(NUDGE_ENDPOINT, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to resolve the call-forwarding nudge");
  }
}

export default function CallForwardingNudge() {
  const router = useRouter();
  const { showToast } = useToast();
  const [visible, setVisible] = useState(true);
  const [isResolving, setIsResolving] = useState(false);

  const dismiss = async () => {
    if (isResolving) return;

    setVisible(false);
    setIsResolving(true);

    try {
      await resolveNudge();
    } catch {
      setVisible(true);
      showToast(
        "We couldn't dismiss this suggestion. Please try again.",
        "error"
      );
    } finally {
      setIsResolving(false);
    }
  };

  const openSettings = async () => {
    if (isResolving) return;

    setVisible(false);
    setIsResolving(true);

    try {
      await resolveNudge();
    } catch {
      showToast(
        "We couldn't save this preference, but you can still set up call forwarding.",
        "error"
      );
    } finally {
      router.push("/settings#call-forwarding");
    }
  };

  if (!visible) return null;

  return (
    <aside
      className={`p-4 sm:p-5 ${card}`}
      aria-labelledby="call-forwarding-nudge-title"
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 shrink-0 ${orangeAccentIcon}`} aria-hidden="true">
          <PhoneForwarded className="h-5 w-5 text-[#c2410c] dark:text-[#ff914d]" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            id="call-forwarding-nudge-title"
            className={`text-sm font-semibold ${ink}`}
          >
            Want calls to ring your phone?
          </p>
          <p className={`mt-1 text-sm ${body}`}>
            Forward calls to the phone you already use. If you miss one,
            SimplAssist will still send the automatic follow-up.
          </p>
          <button
            type="button"
            onClick={openSettings}
            disabled={isResolving}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c2410c] transition-colors hover:text-[#9a3412] disabled:cursor-wait disabled:opacity-60 dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
          >
            Set up call forwarding
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={isResolving}
          aria-label="Dismiss call forwarding suggestion"
          className="shrink-0 rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 disabled:cursor-wait disabled:opacity-60 dark:text-[#bdbdbf] dark:hover:bg-white/[0.08] dark:hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
