'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, PhoneForwarded } from 'lucide-react';
import { useBrand } from '@/components/branding/BrandProvider';
import { replaceDefaultBrandName } from '@/lib/branding/presentation';
import { isE164PhoneNumber, normalizeE164Input } from '@/lib/phone/e164';
import { primaryCtaInlineClass } from '@/lib/glass';
import { tile, ink, body } from '@/lib/theme-v2/theme';

interface CallForwardingFormProps {
  initialEnabled: boolean;
  initialForwardToNumber: string | null;
  smsPhoneNumber: string;
}

type ApiResponse = {
  error?: string;
  field?: 'forwardToNumber';
  callForwardingEnabled?: boolean;
  forwardToNumber?: string | null;
};

type PendingAction = 'toggle' | 'number' | null;

export function presentCallForwardingError(
  message: string,
  brandName: string
): string {
  return replaceDefaultBrandName(message, brandName);
}

function forwardingFailureMessage(
  requestError: unknown,
  remainsEnabled: boolean,
  fallback: string
): string {
  const detail =
    requestError instanceof Error && requestError.message
      ? requestError.message
      : fallback;
  if (detail.includes('Call forwarding remains')) return detail;
  return `${detail.replace(/[.\s]+$/, '')}. Call forwarding remains ${
    remainsEnabled ? 'on' : 'off'
  }.`;
}

export default function CallForwardingForm({
  initialEnabled,
  initialForwardToNumber,
  smsPhoneNumber,
}: CallForwardingFormProps) {
  const brand = useBrand();
  const initialNumber = normalizeE164Input(initialForwardToNumber);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [persistedEnabled, setPersistedEnabled] = useState(initialEnabled);
  const [persistedForwardToNumber, setPersistedForwardToNumber] = useState(initialNumber);
  const [forwardToNumber, setForwardToNumber] = useState(initialNumber);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const normalizedDraft = normalizeE164Input(forwardToNumber);
  const numberIsDirty = normalizedDraft !== persistedForwardToNumber;

  const validationError = useMemo(() => {
    if (normalizedDraft && !isE164PhoneNumber(normalizedDraft)) {
      return 'Use E.164 format, like +13175551234';
    }
    if (normalizedDraft && normalizedDraft === smsPhoneNumber) {
      return `Forward-to number cannot be your ${brand.name} number`;
    }
    if (persistedEnabled && !normalizedDraft) {
      return 'Turn off call forwarding before clearing the forwarding number';
    }
    return '';
  }, [brand.name, normalizedDraft, persistedEnabled, smsPhoneNumber]);

  const canTurnOn = Boolean(
    persistedForwardToNumber &&
      isE164PhoneNumber(persistedForwardToNumber) &&
      persistedForwardToNumber !== smsPhoneNumber &&
      !numberIsDirty
  );
  const enableHelpVisible = !persistedEnabled && !canTurnOn;
  const busy = pendingAction !== null;

  const handleToggle = async (nextEnabled: boolean) => {
    if (busy || nextEnabled === persistedEnabled) return;
    if (nextEnabled && !canTurnOn) {
      setError('Save a valid forwarding number before turning call forwarding on.');
      return;
    }

    const previousEnabled = persistedEnabled;
    setPendingAction('toggle');
    setEnabled(nextEnabled);
    setFeedback('');
    setError('');

    try {
      const res = await fetch('/api/settings/call-forwarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok || typeof data.callForwardingEnabled !== 'boolean') {
        const reason = data.error ? `${data.error}. ` : '';
        throw new Error(
          `${reason}Call forwarding remains ${previousEnabled ? 'on' : 'off'}.`
        );
      }

      const canonicalNumber = normalizeE164Input(data.forwardToNumber);
      setEnabled(data.callForwardingEnabled);
      setPersistedEnabled(data.callForwardingEnabled);
      setPersistedForwardToNumber(canonicalNumber);
      if (!numberIsDirty) setForwardToNumber(canonicalNumber);

      setFeedback(
        data.callForwardingEnabled
          ? `Call forwarding is on. New calls will ring ${canonicalNumber} first. Make a quick test call to confirm it works.`
          : 'Call forwarding is off. New calls will use the missed-call follow-up flow.'
      );
    } catch (requestError) {
      setEnabled(previousEnabled);
      setError(
        forwardingFailureMessage(
          requestError,
          previousEnabled,
          'Could not update call forwarding'
        )
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleSaveNumber = async () => {
    if (busy || !numberIsDirty) return;
    setFeedback('');
    setError('');

    if (validationError) {
      setError(validationError);
      return;
    }

    setPendingAction('number');
    try {
      const res = await fetch('/api/settings/call-forwarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forwardToNumber: normalizedDraft || null }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok || typeof data.callForwardingEnabled !== 'boolean') {
        const reason = data.error ? `${data.error}. ` : '';
        throw new Error(
          `${reason}Call forwarding remains ${persistedEnabled ? 'on' : 'off'}.`
        );
      }

      const canonicalNumber = normalizeE164Input(data.forwardToNumber);
      setEnabled(data.callForwardingEnabled);
      setPersistedEnabled(data.callForwardingEnabled);
      setPersistedForwardToNumber(canonicalNumber);
      setForwardToNumber(canonicalNumber);

      if (data.callForwardingEnabled) {
        setFeedback(
          `Forwarding number updated to ${canonicalNumber}. Make a quick test call to confirm it works.`
        );
      } else if (canonicalNumber) {
        setFeedback('Forwarding number saved. Call forwarding is still off.');
      } else {
        setFeedback('Forwarding number removed. Call forwarding is still off.');
      }
    } catch (requestError) {
      setError(
        forwardingFailureMessage(
          requestError,
          persistedEnabled,
          'Could not save the forwarding number'
        )
      );
    } finally {
      setPendingAction(null);
    }
  };

  const visibleError = presentCallForwardingError(
    error || validationError,
    brand.name
  );

  return (
    <div id="call-forwarding" className={`${tile} scroll-mt-24 p-4`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="mt-0.5 rounded-lg bg-[var(--brand-primary-alt-wash)] p-2 dark:bg-[rgb(var(--brand-primary-alt-rgb)/.10)]">
            <PhoneForwarded className="h-5 w-5 text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]" aria-hidden />
          </div>
          <div>
            <h3 className={`font-semibold ${ink}`}>Call forwarding</h3>
            <p className={`mt-1 text-sm ${body}`}>
              Send inbound calls to your phone first. Missed calls still get the automatic follow-up text.
            </p>
          </div>
        </div>

        <label
          className={`inline-flex items-center gap-2 self-start ${
            busy || (!persistedEnabled && !canTurnOn)
              ? 'cursor-not-allowed opacity-60'
              : 'cursor-pointer'
          }`}
        >
          <span className="text-sm font-medium text-stone-700 dark:text-[#d7d7d9]">
            {pendingAction === 'toggle' ? `Turning ${enabled ? 'on' : 'off'}...` : enabled ? 'On' : 'Off'}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => void handleToggle(event.target.checked)}
            disabled={busy || (!persistedEnabled && !canTurnOn)}
            aria-describedby={enableHelpVisible ? 'call-forwarding-enable-help' : undefined}
            aria-busy={pendingAction === 'toggle'}
            className="h-5 w-5 rounded border-[#e3dacc] accent-[var(--brand-primary)] dark:accent-[var(--brand-primary-dark)] text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)] focus:ring-[rgb(var(--brand-primary-rgb)/.40)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.40)] disabled:cursor-not-allowed"
            aria-label="Enable call forwarding"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between gap-3">
            <label
              htmlFor="forward-to-number"
              className="block text-sm font-medium text-stone-700 dark:text-[#d7d7d9]"
            >
              Forward-to number
            </label>
            {numberIsDirty && (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                Unsaved number change
              </span>
            )}
          </div>
          <input
            id="forward-to-number"
            type="tel"
            inputMode="tel"
            value={forwardToNumber}
            onChange={(event) => {
              setForwardToNumber(event.target.value);
              setFeedback('');
              setError('');
            }}
            disabled={busy}
            aria-invalid={Boolean(visibleError)}
            aria-describedby={visibleError ? 'call-forwarding-error' : undefined}
            placeholder="+13175551234"
            className="w-full rounded-lg px-3 py-2 focus:outline-none bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSaveNumber()}
          disabled={busy || !numberIsDirty || Boolean(validationError)}
          className={`${primaryCtaInlineClass} self-end`}
        >
          {pendingAction === 'number' ? 'Saving...' : 'Save number'}
        </button>
      </div>

      {enableHelpVisible && !visibleError && (
        <p id="call-forwarding-enable-help" className={`mt-2 text-xs ${body}`}>
          Save a valid forwarding number before turning call forwarding on.
        </p>
      )}
      {visibleError && (
        <p
          id="call-forwarding-error"
          role="alert"
          className="mt-2 flex items-center gap-1.5 text-sm text-red-500"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {visibleError}
        </p>
      )}
      {feedback && !visibleError && (
        <p
          aria-live="polite"
          className="mt-2 flex items-start gap-1.5 text-sm text-green-600 dark:text-green-400"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {feedback}
        </p>
      )}
    </div>
  );
}
