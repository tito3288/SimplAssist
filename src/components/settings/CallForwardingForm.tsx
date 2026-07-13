'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, PhoneForwarded } from 'lucide-react';
import { isE164PhoneNumber, normalizeE164Input } from '@/lib/phone/e164';
import { primaryCtaInlineClass } from '@/lib/glass';
import { tile, ink, body } from '@/lib/theme-v2/theme';

interface CallForwardingFormProps {
  initialEnabled: boolean;
  initialForwardToNumber: string | null;
  smsPhoneNumber: string;
}

type ApiError = {
  error?: string;
  field?: 'forwardToNumber';
};

export default function CallForwardingForm({
  initialEnabled,
  initialForwardToNumber,
  smsPhoneNumber,
}: CallForwardingFormProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [forwardToNumber, setForwardToNumber] = useState(initialForwardToNumber ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const validationError = useMemo(() => {
    const trimmed = normalizeE164Input(forwardToNumber);
    if (enabled && !trimmed) return 'Enter a forward-to phone number';
    if (trimmed && !isE164PhoneNumber(trimmed)) {
      return 'Use E.164 format, like +13175551234';
    }
    if (trimmed && trimmed === smsPhoneNumber) {
      return 'Forward-to number cannot be your SimplAssist number';
    }
    return '';
  }, [enabled, forwardToNumber, smsPhoneNumber]);

  const handleSave = async () => {
    const trimmed = normalizeE164Input(forwardToNumber);
    setSaving(true);
    setSaved(false);
    setError('');

    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/settings/call-forwarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          forwardToNumber: trimmed || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiError;

      if (!res.ok) {
        setError(data.error ?? 'Failed to save call forwarding settings');
        return;
      }

      setForwardToNumber(trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const visibleError = error || validationError;

  return (
    <div className={`${tile} p-4`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="mt-0.5 rounded-lg bg-orange-50 p-2 dark:bg-orange-500/10">
            <PhoneForwarded className="h-5 w-5 text-[#c2410c] dark:text-[#ff914d]" aria-hidden />
          </div>
          <div>
            <h3 className={`font-semibold ${ink}`}>
              Call forwarding
            </h3>
            <p className={`mt-1 text-sm ${body}`}>
              Send inbound calls to your phone first. Missed calls still get the automatic follow-up text.
            </p>
          </div>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 self-start">
          <span className="text-sm font-medium text-stone-700 dark:text-[#d7d7d9]">
            {enabled ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setSaved(false);
              setError('');
            }}
            className="h-5 w-5 rounded border-[#e3dacc] accent-[#ea580c] dark:accent-[#ff914d] text-[#c2410c] dark:text-[#ff914d] focus:ring-[#ea580c]/40 dark:focus:ring-[#ff914d]/40"
            aria-label="Enable call forwarding"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label
            htmlFor="forward-to-number"
            className="mb-1 block text-sm font-medium text-stone-700 dark:text-[#d7d7d9]"
          >
            Forward-to number
          </label>
          <input
            id="forward-to-number"
            type="tel"
            inputMode="tel"
            value={forwardToNumber}
            onChange={(event) => {
              setForwardToNumber(event.target.value);
              setSaved(false);
              setError('');
            }}
            placeholder="+13175551234"
            className="w-full rounded-lg px-3 py-2 focus:outline-none bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || Boolean(validationError)}
          className={`${primaryCtaInlineClass} self-end`}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {visibleError && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" aria-hidden />
          {visibleError}
        </p>
      )}
      {saved && !visibleError && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" aria-hidden />
          Call forwarding settings saved.
        </p>
      )}
    </div>
  );
}
