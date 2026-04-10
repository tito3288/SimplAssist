"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { glassInput, textSecondary } from "@/lib/glass";

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DeleteAccountModal({ open, onClose }: DeleteAccountModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createBrowserClient();
  const { showToast } = useToast();

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete account");
      }

      showToast("Account scheduled for deletion. You have 60 days to reactivate.", "info");
      await supabase.auth.signOut();
      router.push("/login");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Something went wrong", "error");
      setLoading(false);
    }
  }

  function handleClose() {
    setConfirmText("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Delete Account"
      description="This action will schedule your account for permanent deletion."
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-red-50 dark:bg-red-500/[0.06] border border-red-200 dark:border-red-500/20 p-4">
          <p className="text-sm text-red-800 dark:text-red-300 leading-relaxed">
            All your data including contacts, conversations, services, FAQs, and AI settings will be{" "}
            <strong>permanently deleted after 60 days</strong>. This cannot be undone after the grace period.
          </p>
        </div>

        <p className={`text-sm ${textSecondary}`}>
          You can reactivate your account within 60 days by logging back in.
        </p>

        <div>
          <label className={`block text-sm font-medium mb-2 ${textSecondary}`}>
            Type <strong className="text-red-600 dark:text-red-400">DELETE</strong> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className={`w-full rounded-lg px-3 py-2 text-sm ${glassInput}`}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <Button
            variant="secondary"
            size="md"
            onClick={handleClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            loading={loading}
            disabled={confirmText !== "DELETE"}
            onClick={handleDelete}
            className="flex-1"
          >
            Delete My Account
          </Button>
        </div>
      </div>
    </Modal>
  );
}
