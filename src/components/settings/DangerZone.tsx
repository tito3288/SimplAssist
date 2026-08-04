"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import DeleteAccountModal from "@/components/settings/DeleteAccountModal";
import { card, body } from "@/lib/theme-v2/theme";
import { cn } from "@/lib/utils";

export default function DangerZone() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div className={cn(card, "border-red-300 dark:border-red-500/20 p-6")}>
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
        </div>
        <p className={cn("text-sm mb-4", body)}>
          Permanently delete your account and all associated data. This action has a 60-day grace period.
        </p>
        <Button type="button" variant="danger" size="md" onClick={() => setShowModal(true)}>
          Delete Account
        </Button>
      </div>

      <DeleteAccountModal open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}
