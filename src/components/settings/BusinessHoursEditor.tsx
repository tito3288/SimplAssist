'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BusinessHours } from '@/types/database';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DayHours {
  id?: string;
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
}

interface BusinessHoursEditorProps {
  businessId: string;
  initialHours: BusinessHours[];
}

export default function BusinessHoursEditor({ businessId, initialHours }: BusinessHoursEditorProps) {
  const [hours, setHours] = useState<DayHours[]>(() => {
    // Ensure all 7 days exist
    return DAYS.map((_, i) => {
      const existing = initialHours.find((h) => h.day_of_week === i);
      return existing
        ? { id: existing.id, day_of_week: i, is_closed: existing.is_closed, open_time: existing.open_time, close_time: existing.close_time }
        : { day_of_week: i, is_closed: i === 0 || i === 6, open_time: '09:00', close_time: '17:00' };
    });
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const updateDay = (index: number, updates: Partial<DayHours>) => {
    setHours((prev) => prev.map((h, i) => (i === index ? { ...h, ...updates } : h)));
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      const supabase = createClient();
      await supabase.from('business_hours').delete().eq('business_id', businessId);
      const { error } = await supabase.from('business_hours').insert(
        hours.map((h) => ({
          business_id: businessId,
          day_of_week: h.day_of_week,
          is_closed: h.is_closed,
          open_time: h.is_closed ? '00:00' : h.open_time,
          close_time: h.is_closed ? '00:00' : h.close_time,
        }))
      );
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      // Handle silently
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {hours.map((day, index) => (
        <div
          key={index}
          className={`flex items-center gap-4 p-3 rounded-lg border ${
            day.is_closed ? 'bg-gray-50 border-gray-200' : 'border-gray-300'
          }`}
        >
          <span className="w-24 text-sm font-medium text-gray-700">{DAYS[index]}</span>

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
                className="px-2 py-1 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-gray-400">to</span>
              <input
                type="time"
                value={day.close_time}
                onChange={(e) => updateDay(index, { close_time: e.target.value })}
                className="px-2 py-1 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center gap-4 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="py-2 px-6 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Hours'}
        </button>
        {success && (
          <span className="text-sm text-green-600 font-medium">Hours saved successfully!</span>
        )}
      </div>
    </div>
  );
}
