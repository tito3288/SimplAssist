'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BusinessType } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { normalizeUsStateCode, US_STATES } from '@/lib/usStates';
import { primaryCtaInlineClass } from '@/lib/glass';
import {
  getBusinessInfoScanPrefill,
  type OnboardingScanData,
} from '@/lib/onboarding/scanPrefill';
import {
  hasCarrierRejection,
  REJECTION_SUPPORT_MESSAGE,
} from '@/lib/onboarding/rejectionGuidance';

const businessInfoSchema = z.object({
  name: z.string().min(1, 'Business name is required'),
  business_type: z.enum([
    'plumber', 'dentist', 'restaurant', 'car_wash', 'salon', 'hvac', 'auto_shop',
    'real_estate', 'legal', 'financial', 'insurance', 'retail', 'general', 'other',
  ] as const),
  business_type_other: z.string().optional(),
  website: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  phone: z.string().min(10, 'Enter a valid phone number'),
  email: z.string().email('Enter a valid email address').min(1, 'Business email is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z
    .string()
    .min(1, 'State is required')
    .refine((value) => Boolean(normalizeUsStateCode(value)), 'Select a valid state'),
  zip: z.string().min(5, 'Enter a valid zip code'),
}).refine((data) => {
  if (data.business_type === 'other') {
    return !!data.business_type_other?.trim();
  }
  return true;
}, {
  message: 'Please specify your business type',
  path: ['business_type_other'],
});

type BusinessInfoData = z.infer<typeof businessInfoSchema>;

export type ScrapedData = OnboardingScanData;

interface BusinessInfoFormProps {
  businessId: string;
  initialData?: Partial<BusinessInfoData>;
  onNext: (data: BusinessInfoData, scrapedData: ScrapedData | null) => void;
}

type RegistrationLockSnapshot = {
  status?: string;
  brandStatus?: string | null;
  campaignStatus?: string | null;
  smsReady?: boolean;
  riskReview?: { registrationStarted?: boolean };
};

export const REGISTRATION_STATE_UNAVAILABLE_MESSAGE =
  'We could not verify your registration status. Refresh the page and try again, or contact support.';

export function businessInfoRegistrationLockMessage(
  registration: RegistrationLockSnapshot | null | undefined
): string | null {
  if (
    !registration?.smsReady &&
    hasCarrierRejection(
      registration?.brandStatus,
      registration?.campaignStatus
    )
  ) {
    return REJECTION_SUPPORT_MESSAGE;
  }

  if (
    registration?.riskReview?.registrationStarted &&
    registration.status !== 'failed'
  ) {
    return 'Your registration is in carrier review — these details are locked until review completes.';
  }

  return null;
}

export function businessInfoRegistrationGateMessage(args: {
  responseOk: boolean;
  registration: RegistrationLockSnapshot | null | undefined;
}): string | null {
  if (!args.responseOk || !args.registration) {
    return REGISTRATION_STATE_UNAVAILABLE_MESSAGE;
  }
  return businessInfoRegistrationLockMessage(args.registration);
}

const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: 'plumber', label: 'Plumber' },
  { value: 'dentist', label: 'Dentist' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'car_wash', label: 'Car Wash' },
  { value: 'salon', label: 'Salon' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'auto_shop', label: 'Auto Shop' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'legal', label: 'Legal Services' },
  { value: 'financial', label: 'Financial Services' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'retail', label: 'Retail' },
  { value: 'general', label: 'General' },
  { value: 'other', label: 'Other' },
];

export default function BusinessInfoForm({ businessId, initialData, onNext }: BusinessInfoFormProps) {
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);

  const {
    register,
    getValues,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BusinessInfoData>({
    resolver: zodResolver(businessInfoSchema),
    defaultValues: {
      name: initialData?.name === 'My Business' ? '' : (initialData?.name || ''),
      business_type: initialData?.business_type || 'general',
      business_type_other: initialData?.business_type_other || '',
      website: initialData?.website || '',
      phone: initialData?.phone || '',
      email: initialData?.email || '',
      address: initialData?.address || '',
      city: initialData?.city || '',
      state: normalizeUsStateCode(initialData?.state) || '',
      zip: initialData?.zip || '',
    },
  });

  const businessTypeValue = watch('business_type');

  const websiteValue = watch('website');

  const handleScanWebsite = async () => {
    if (!websiteValue) return;
    setScanning(true);
    setScanError('');
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteValue }),
      });
      if (!res.ok) throw new Error('Failed to scan website');
      const data = (await res.json()) as ScrapedData;
      const current = getValues();
      const prefill = getBusinessInfoScanPrefill(
        {
          name: current.name,
          phone: current.phone,
          address: current.address,
          city: current.city,
          state: current.state,
          zip: current.zip,
        },
        data
      );

      for (const [field, value] of Object.entries(prefill) as [
        keyof typeof prefill,
        string,
      ][]) {
        setValue(field, value, { shouldDirty: true, shouldValidate: true });
      }
      setScrapedData(data);
    } catch {
      setScanError('Could not scan website. You can continue by entering your information manually.');
    } finally {
      setScanning(false);
    }
  };

  const onSubmit = async (data: BusinessInfoData) => {
    setSaving(true);
    setSubmitError('');
    try {
      // Submit-time lock check: business identity feeds the Telnyx brand,
      // which can't be updated once a registration is awaiting carrier
      // review. Step routing normally prevents reaching this form in that
      // state, but a stale open tab bypasses it — re-check fresh state here.
      // Carrier rejections stay locked even when the registration status is
      // 'failed': support must review the existing provider resource before
      // anything is changed. This form writes through the authenticated
      // Supabase client, so the fresh lock read must fail closed.
      try {
        const stateRes = await fetch('/api/onboarding/state', { cache: 'no-store' });
        const statePayload = (await stateRes.json().catch(() => ({}))) as {
          state?: { registration?: RegistrationLockSnapshot };
        };
        const lockMessage = businessInfoRegistrationGateMessage({
          responseOk: stateRes.ok,
          registration: statePayload.state?.registration,
        });
        if (lockMessage) {
          setSubmitError(lockMessage);
          return;
        }
      } catch {
        setSubmitError(REGISTRATION_STATE_UNAVAILABLE_MESSAGE);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase
        .from('businesses')
        .update({
          name: data.name,
          business_type: data.business_type,
          business_type_other: data.business_type === 'other' ? data.business_type_other || null : null,
          website_url: data.website || null,
          phone_number: data.phone,
          email: data.email || null,
          address: data.address,
          city: data.city,
          state: normalizeUsStateCode(data.state),
          zip: data.zip,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          onboarding_step: 'business_hours',
          onboarding_last_saved_at: new Date().toISOString(),
        })
        .eq('id', businessId);
      if (error) throw error;
      onNext(data, scrapedData);
    } catch {
      setSubmitError('Could not save your business information. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">Tell us about your business</h2>

      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Business Name *</label>
        <input
          {...register('name')}
          placeholder="e.g. Joe's Barber Shop"
          className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        />
        {errors.name && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Business Type *</label>
        <select
          {...register('business_type')}
          className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        >
          {BUSINESS_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {businessTypeValue === 'other' && (
          <div className="mt-2">
            <input
              {...register('business_type_other')}
              placeholder="e.g. Marketing Agency"
              className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
            />
            {errors.business_type_other && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.business_type_other.message}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Website URL (optional)</label>
        <div className="flex gap-2">
          <input
            {...register('website')}
            placeholder="https://www.example.com"
            className="flex-1 px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
          />
          {websiteValue && (
            <button
              type="button"
              onClick={handleScanWebsite}
              disabled={scanning}
              className="px-4 py-2 bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] border border-[var(--brand-accent-soft-border)] hover:bg-[var(--brand-tint)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/.12)] dark:text-[var(--brand-accent-dark)] dark:border-white/[0.10] dark:hover:bg-[rgb(var(--brand-primary-dark-rgb)/.18)] font-medium rounded-full disabled:opacity-50 whitespace-nowrap"
            >
              {scanning ? (
                <span className="flex items-center gap-2.5">
                  <PulsingDot inline />
                  Scanning...
                </span>
              ) : (
                'Scan Website'
              )}
            </button>
          )}
        </div>
        {scanError && <p className="text-sm text-amber-600 mt-1">{scanError}</p>}
        {scrapedData && (
          <p className="text-sm text-green-600 dark:text-green-400 mt-1">
            Website scanned! Found {scrapedData.services?.length || 0} services and {scrapedData.faqs?.length || 0} FAQs.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Phone Number *</label>
        <input
          {...register('phone')}
          placeholder="(555) 123-4567"
          className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        />
        {errors.phone && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.phone.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Business Email *</label>
        <input
          {...register('email')}
          type="email"
          placeholder="info@yourbusiness.com"
          className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        />
        {errors.email && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.email.message}</p>}
        <p className="text-xs text-stone-500 dark:text-[#bdbdbf] mt-1">The AI will suggest this email when it can&apos;t fully help a customer.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Address *</label>
        <input
          {...register('address')}
          className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        />
        {errors.address && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.address.message}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">City *</label>
          <input
            {...register('city')}
            className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
          />
          {errors.city && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.city.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">State *</label>
          <select
            {...register('state')}
            className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
            defaultValue=""
          >
            <option value="" disabled>Select state</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>{name} ({code})</option>
            ))}
          </select>
          {errors.state && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.state.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Zip *</label>
          <input
            {...register('zip')}
            className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
          />
          {errors.zip && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.zip.message}</p>}
        </div>
      </div>

      {submitError && (
        <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
      )}

      <div className="flex justify-end pt-4">
        <button
          type="submit"
          disabled={saving || scanning}
          className={primaryCtaInlineClass}
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving...
            </>
          ) : (
            'Next'
          )}
        </button>
      </div>
    </form>
  );
}
