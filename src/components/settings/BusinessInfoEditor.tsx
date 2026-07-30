'use client';

import { useState } from 'react';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaInlineClass } from '@/lib/glass';
import {
  persistBusinessInfoSettings,
  type BusinessInfoSettingsErrors,
  type BusinessInfoSettingsInput,
  validateBusinessInfoSettings,
} from '@/lib/settings/businessInfo';
import { createClient } from '@/lib/supabase/client';
import { normalizeUsStateCode, US_STATES } from '@/lib/usStates';

interface BusinessInfoEditorProps {
  businessId: string;
  initialPhoneNumber: string | null;
  initialAddress: string | null;
  initialCity: string | null;
  initialState: string | null;
  initialZip: string | null;
}

const inputClassName =
  'w-full px-3 py-2 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30';

export default function BusinessInfoEditor({
  businessId,
  initialPhoneNumber,
  initialAddress,
  initialCity,
  initialState,
  initialZip,
}: BusinessInfoEditorProps) {
  const [values, setValues] = useState<BusinessInfoSettingsInput>({
    phoneNumber: initialPhoneNumber ?? '',
    address: initialAddress ?? '',
    city: initialCity ?? '',
    state: normalizeUsStateCode(initialState) ?? '',
    zip: initialZip ?? '',
  });
  const [errors, setErrors] = useState<BusinessInfoSettingsErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const updateValue = (
    field: keyof BusinessInfoSettingsInput,
    value: string
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors({});
    setSaved(false);
    setSubmitError('');
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    setSubmitError('');

    const validation = validateBusinessInfoSettings(values);
    if (!validation.success) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      await persistBusinessInfoSettings(
        createClient(),
        businessId,
        validation.payload
      );
      setValues(validation.values);
      setSaved(true);
    } catch {
      setSubmitError(
        'Could not save your business contact information. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label
          htmlFor="business-contact-phone"
          className="block text-sm font-medium text-stone-700 dark:text-[#bdbdbf] mb-1"
        >
          Business Contact Phone
        </label>
        <input
          id="business-contact-phone"
          type="tel"
          value={values.phoneNumber}
          onChange={(event) => updateValue('phoneNumber', event.target.value)}
          placeholder="(555) 123-4567"
          className={inputClassName}
          aria-invalid={Boolean(errors.phoneNumber)}
          aria-describedby={
            errors.phoneNumber
              ? 'business-contact-phone-error'
              : 'business-contact-phone-help'
          }
        />
        {errors.phoneNumber ? (
          <p
            id="business-contact-phone-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
          >
            {errors.phoneNumber}
          </p>
        ) : (
          <p
            id="business-contact-phone-help"
            className="mt-1 text-xs text-stone-500 dark:text-[#bdbdbf]"
          >
            The number customers use to contact your business. This is separate
            from your SimplAssist texting number.
          </p>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-stone-700 dark:text-[#bdbdbf]">
          Business Address
        </legend>
        <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">
          Enter a complete address, or leave all address fields blank.
        </p>

        <div>
          <label htmlFor="business-address" className="sr-only">
            Street address
          </label>
          <input
            id="business-address"
            value={values.address}
            onChange={(event) => updateValue('address', event.target.value)}
            placeholder="Street address"
            className={inputClassName}
            aria-invalid={Boolean(errors.address)}
          />
          {errors.address && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {errors.address}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="business-city" className="sr-only">
              City
            </label>
            <input
              id="business-city"
              value={values.city}
              onChange={(event) => updateValue('city', event.target.value)}
              placeholder="City"
              className={inputClassName}
              aria-invalid={Boolean(errors.city)}
            />
            {errors.city && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.city}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="business-state" className="sr-only">
              State
            </label>
            <select
              id="business-state"
              value={values.state}
              onChange={(event) => updateValue('state', event.target.value)}
              className={inputClassName}
              aria-invalid={Boolean(errors.state)}
            >
              <option value="">State</option>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            {errors.state && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.state}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="business-zip" className="sr-only">
              ZIP code
            </label>
            <input
              id="business-zip"
              value={values.zip}
              onChange={(event) => updateValue('zip', event.target.value)}
              placeholder="ZIP code"
              className={inputClassName}
              aria-invalid={Boolean(errors.zip)}
            />
            {errors.zip && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {errors.zip}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={saving}
          className={primaryCtaInlineClass}
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving…
            </>
          ) : (
            'Save Contact & Address'
          )}
        </button>
        {saved && (
          <span className="text-sm font-medium text-green-600 dark:text-green-400">
            Business information saved!
          </span>
        )}
        {submitError && (
          <span className="text-sm text-red-600 dark:text-red-400">
            {submitError}
          </span>
        )}
      </div>
    </form>
  );
}
