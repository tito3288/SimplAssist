"use client";

import {
  PRIMARY_GOAL_COPY,
  PRIMARY_GOAL_OPTIONS,
  type EditablePrimaryGoal,
} from "@/lib/goals/primaryGoal";

export interface PrimaryGoalFieldsProps {
  primaryGoal: EditablePrimaryGoal | null;
  goalUrl: string;
  onPrimaryGoalChange: (primaryGoal: EditablePrimaryGoal) => void;
  onGoalUrlChange: (goalUrl: string) => void;
  disabled?: boolean;
}

export function PrimaryGoalFields({
  primaryGoal,
  goalUrl,
  onPrimaryGoalChange,
  onGoalUrlChange,
  disabled = false,
}: PrimaryGoalFieldsProps) {
  return (
    <fieldset
      data-primary-goal-fields
      disabled={disabled}
      aria-describedby="primary-goal-helper"
      className="space-y-3"
    >
      <legend className="text-base font-semibold text-stone-900 dark:text-[#f5f5f5]">
        {PRIMARY_GOAL_COPY.question}
      </legend>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PRIMARY_GOAL_OPTIONS.map((option) => {
          const selected = primaryGoal === option.value;
          return (
            <label
              key={option.value}
              className={`cursor-pointer rounded-[18px] border p-4 text-sm transition-colors ${
                selected
                  ? "border-[var(--brand-primary)] bg-[var(--brand-wash)] ring-2 ring-[rgb(var(--brand-primary-rgb)/.20)] dark:border-[var(--brand-primary-dark)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/.11)] dark:ring-[rgb(var(--brand-primary-dark-rgb)/.20)]"
                  : "border-[#e9e0d4] bg-white/70 hover:border-[#d8ccbc] hover:bg-white dark:border-white/[0.10] dark:bg-white/[0.035] dark:hover:border-white/[0.17] dark:hover:bg-white/[0.055]"
              }`}
            >
              <input
                type="radio"
                name="primary_goal"
                value={option.value}
                checked={selected}
                onChange={() => onPrimaryGoalChange(option.value)}
                className="sr-only"
              />
              <span className="font-medium text-stone-900 dark:text-[#f5f5f5]">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>

      <p
        id="primary-goal-helper"
        className="text-xs leading-relaxed text-stone-500 dark:text-[#bdbdbf]"
      >
        {PRIMARY_GOAL_COPY.helper}
      </p>

      {primaryGoal === "signup" && (
        <input
          type="url"
          id="goal_url"
          name="goal_url"
          aria-label="goal_url"
          placeholder="https://"
          minLength={9}
          maxLength={2048}
          required
          value={goalUrl}
          onChange={(event) => onGoalUrlChange(event.target.value)}
          className="w-full rounded-lg border border-[#e3dacc] bg-white px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        />
      )}
    </fieldset>
  );
}
