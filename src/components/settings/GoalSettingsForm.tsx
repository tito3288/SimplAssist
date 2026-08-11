"use client";

import { useReducer, useState } from "react";
import { useRouter } from "next/navigation";

import { PrimaryGoalFields } from "@/components/goals/PrimaryGoalFields";
import { PulsingDot } from "@/components/ui/pulsing-dot";
import { primaryCtaInlineClass } from "@/lib/glass";
import {
  buildPrimaryGoalUpdate,
  isEditablePrimaryGoal,
  type EditablePrimaryGoal,
  type PrimaryGoalUpdate,
} from "@/lib/goals/primaryGoal";
import { createClient } from "@/lib/supabase/client";
import type { PrimaryGoal } from "@/types/database";

export type GoalSettingsFormProps = {
  businessId: string;
  initialPrimaryGoal: PrimaryGoal | null;
  initialGoalUrl: string | null;
};

type GoalSettingsDraft = {
  primaryGoal: EditablePrimaryGoal | null;
  goalUrl: string;
};

type GoalSettingsDraftAction =
  | { type: "primary_goal"; value: EditablePrimaryGoal }
  | { type: "goal_url"; value: string };

export function reduceGoalSettingsDraft(
  draft: GoalSettingsDraft,
  action: GoalSettingsDraftAction
): GoalSettingsDraft {
  if (action.type === "primary_goal") {
    return { ...draft, primaryGoal: action.value };
  }

  return { ...draft, goalUrl: action.value };
}

export async function saveGoalSettings({
  supabase,
  businessId,
  payload,
  refresh,
}: {
  supabase: ReturnType<typeof createClient>;
  businessId: string;
  payload: PrimaryGoalUpdate;
  refresh: () => void;
}): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update(payload)
    .eq("id", businessId);
  if (error) throw error;

  refresh();
}

export default function GoalSettingsForm({
  businessId,
  initialPrimaryGoal,
  initialGoalUrl,
}: GoalSettingsFormProps) {
  const router = useRouter();
  const [draft, dispatch] = useReducer(reduceGoalSettingsDraft, {
    primaryGoal: isEditablePrimaryGoal(initialPrimaryGoal)
      ? initialPrimaryGoal
      : null,
    goalUrl: initialGoalUrl ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"success" | "error" | null>(null);
  const payload = buildPrimaryGoalUpdate({
    primary_goal: draft.primaryGoal,
    goal_url: draft.goalUrl,
  });

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payload) return;

    setSaving(true);
    setStatus(null);
    try {
      await saveGoalSettings({
        supabase: createClient(),
        businessId,
        payload,
        refresh: () => router.refresh(),
      });
      setStatus("success");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mb-8 space-y-4 border-b border-[#ece4d8] pb-8 dark:border-white/[0.10]"
    >
      <PrimaryGoalFields
        primaryGoal={draft.primaryGoal}
        goalUrl={draft.goalUrl}
        onPrimaryGoalChange={(value) =>
          dispatch({ type: "primary_goal", value })
        }
        onGoalUrlChange={(value) => dispatch({ type: "goal_url", value })}
        disabled={saving}
      />

      <div className="flex items-center gap-4 pt-4">
        <button
          type="submit"
          disabled={saving || !payload}
          className={primaryCtaInlineClass}
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving…
            </>
          ) : (
            "Save Settings"
          )}
        </button>
        {status === "success" && (
          <span className="text-sm font-medium text-green-600 dark:text-green-400">
            Settings saved successfully!
          </span>
        )}
        {status === "error" && (
          <span className="text-sm font-medium text-red-600 dark:text-red-400">
            Could not save your AI settings. Please try again.
          </span>
        )}
      </div>
    </form>
  );
}
