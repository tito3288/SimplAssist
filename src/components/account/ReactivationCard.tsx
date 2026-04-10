"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";
import { textPrimary, textSecondary } from "@/lib/glass";

interface ReactivationCardProps {
  deletionDate: string;
}

export default function ReactivationCard({ deletionDate }: ReactivationCardProps) {
  const [loading, setLoading] = useState(false);
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
    try {
      const res = await fetch("/api/account/reactivate", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reactivate");
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      console.error("[reactivate]", err);
      setLoading(false);
    }
  }

  async function handleSignOut() {
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
