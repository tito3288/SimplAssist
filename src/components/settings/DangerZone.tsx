"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import DeleteAccountModal from "@/components/settings/DeleteAccountModal";

export default function DangerZone() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div className="rounded-[28px] border border-red-300 dark:border-red-500/20 bg-white/70 dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.05))] shadow-sm dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-[18px] p-6">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">
          Permanently delete your account and all associated data. This action has a 60-day grace period.
        </p>
        <Button variant="danger" size="md" onClick={() => setShowModal(true)}>
          Delete Account
        </Button>
      </div>

      <DeleteAccountModal open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}
