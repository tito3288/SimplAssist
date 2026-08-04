"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import DeleteAccountModal from "@/components/settings/DeleteAccountModal";
import { secondaryCtaCompactClass } from "@/lib/glass";

export default function OnboardingDeleteAccount() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${secondaryCtaCompactClass} min-h-10 gap-2 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300`}
      >
        <Trash2 className="h-4 w-4" />
        Delete account
      </button>
      <DeleteAccountModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
