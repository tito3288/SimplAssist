'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PulsingDot } from '@/components/ui/pulsing-dot';

interface DayHours {
  day: string;
  is_closed: boolean;
  open_time: string;
  close_time: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_HOURS: DayHours[] = DAYS.map((day) => ({
  day: day.toLowerCase(),
  is_closed: day === 'Sunday' || day === 'Saturday',
  open_time: '09:00',
  close_time: '17:00',
}));

interface BusinessHoursFormProps {
  businessId: string;
  initialData?: DayHours[];
  onNext: (data: DayHours[]) => void;
  onBack: () => void;
}

export default function BusinessHoursForm({ businessId, initialData, onNext, onBack }: BusinessHoursFormProps) {
  const [hours, setHours] = useState<DayHours[]>(initialData || DEFAULT_HOURS);
  const [saving, setSaving] = useState(false);

  const updateDay = (index: number, updates: Partial<DayHours>) => {
    setHours((prev) => prev.map((h, i) => (i === index ? { ...h, ...updates } : h)));
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const supabase = createClient();
      // Delete existing hours then insert new ones
      await supabase.from('business_hours').delete().eq('business_id', businessId);
      const { error } = await supabase.from('business_hours').insert(
        hours.map((h, i) => ({
          business_id: businessId,
          day_of_week: i,
          is_closed: h.is_closed,
          open_time: h.is_closed ? '00:00' : h.open_time,
          close_time: h.is_closed ? '00:00' : h.close_time,
        }))
      );
      if (error) throw error;
      onNext(hours);
    } catch {
      // Silently handle
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Set your business hours</h2>
      <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">Let customers know when you&apos;re available.</p>

      <div className="space-y-3">
        {hours.map((day, index) => (
          <div
            key={day.day}
            className={`flex items-center gap-4 p-3 rounded-lg border ${
              day.is_closed ? 'bg-slate-50 dark:bg-white/[0.04] border-slate-200 dark:border-white/[0.10]' : 'border-slate-200 dark:border-white/[0.12]'
            }`}
          >
            <span className="w-24 text-sm font-medium text-slate-700 dark:text-[#d4d4d8] capitalize">{day.day}</span>

            <button
              type="button"
              onClick={() => updateDay(index, { is_closed: !day.is_closed })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                !day.is_closed ? 'bg-[#ff914d]' : 'bg-gray-300 dark:bg-white/[0.12]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  !day.is_closed ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs text-slate-500 dark:text-[#bdbdbf] w-12">
              {day.is_closed ? 'Closed' : 'Open'}
            </span>

            {!day.is_closed && (
              <div className="flex items-center gap-2 ml-auto">
                <input
                  type="time"
                  value={day.open_time}
                  onChange={(e) => updateDay(index, { open_time: e.target.value })}
                  className="px-2 py-1 border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-transparent"
                />
                <span className="text-slate-400 dark:text-[#666]">to</span>
                <input
                  type="time"
                  value={day.close_time}
                  onChange={(e) => updateDay(index, { close_time: e.target.value })}
                  className="px-2 py-1 border border-slate-200 dark:border-white/[0.12] bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-transparent"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="py-2 px-6 border border-slate-200 dark:border-white/[0.12] text-slate-700 dark:text-[#bdbdbf] font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 py-2 px-6 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] font-medium rounded-lg hover:bg-orange-600 dark:hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving…
            </>
          ) : (
            'Next'
          )}
        </button>
      </div>
    </div>
  );
}
