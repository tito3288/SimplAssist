"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const TIMEZONES = [
  { label: "Eastern Time (ET)", value: "America/New_York" },
  { label: "Central Time (CT)", value: "America/Chicago" },
  { label: "Mountain Time (MT)", value: "America/Denver" },
  { label: "Pacific Time (PT)", value: "America/Los_Angeles" },
  { label: "Alaska Time (AKT)", value: "America/Anchorage" },
  { label: "Hawaii Time (HT)", value: "Pacific/Honolulu" },
  { label: "Arizona (no DST)", value: "America/Phoenix" },
  { label: "Atlantic Time (AT)", value: "America/Puerto_Rico" },
  { label: "Indiana (Eastern)", value: "America/Indiana/Indianapolis" },
  { label: "UTC", value: "UTC" },
];

interface TimezoneSelectorProps {
  businessId: string;
  initialTimezone: string;
}

export default function TimezoneSelector({
  businessId,
  initialTimezone,
}: TimezoneSelectorProps) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleChange(newTimezone: string) {
    setTimezone(newTimezone);
    setSaving(true);
    setSaved(false);

    try {
      const supabase = createBrowserClient();
      const { error } = await supabase
        .from("businesses")
        .update({ timezone: newTimezone })
        .eq("id", businessId);
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Revert on failure
      setTimezone(initialTimezone);
    } finally {
      setSaving(false);
    }
  }

  // Check if current timezone is in the list, if not add it
  const hasCurrentTimezone = TIMEZONES.some((tz) => tz.value === timezone);

  return (
    <div className="flex flex-col gap-1">
      <select
        value={timezone}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="w-full rounded-[22px] px-4 py-3 text-sm focus:outline-none bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30 appearance-none cursor-pointer"
      >
        {!hasCurrentTimezone && (
          <option value={timezone}>{timezone}</option>
        )}
        {TIMEZONES.map((tz) => (
          <option key={tz.value} value={tz.value}>
            {tz.label}
          </option>
        ))}
      </select>
      {saving && (
        <p className="text-xs text-stone-400 dark:text-[#666]">Saving...</p>
      )}
      {saved && (
        <p className="text-xs text-green-500">Timezone updated!</p>
      )}
    </div>
  );
}
