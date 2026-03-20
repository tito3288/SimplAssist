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
      <h2 className="text-xl font-semibold text-gray-900">Set your business hours</h2>
      <p className="text-sm text-gray-500">Let customers know when you&apos;re available.</p>

      <div className="space-y-3">
        {hours.map((day, index) => (
          <div
            key={day.day}
            className={`flex items-center gap-4 p-3 rounded-lg border ${
              day.is_closed ? 'bg-gray-50 border-gray-200' : 'border-gray-300'
            }`}
          >
            <span className="w-24 text-sm font-medium text-gray-700 capitalize">{day.day}</span>

            <button
              type="button"
              onClick={() => updateDay(index, { is_closed: !day.is_closed })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                !day.is_closed ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  !day.is_closed ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-xs text-gray-500 w-12">
              {day.is_closed ? 'Closed' : 'Open'}
            </span>

            {!day.is_closed && (
              <div className="flex items-center gap-2 ml-auto">
                <input
                  type="time"
                  value={day.open_time}
                  onChange={(e) => updateDay(index, { open_time: e.target.value })}
                  className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="time"
                  value={day.close_time}
                  onChange={(e) => updateDay(index, { close_time: e.target.value })}
                  className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="py-2 px-6 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 py-2 px-6 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
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
