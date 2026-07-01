'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import type { BusinessEntityType } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { normalizeUsStateCode, US_STATES } from '@/lib/usStates';

const PLACEHOLDER_PATTERN = /\[.+?\]/;
const EIN_PATTERN = /^\d{2}-\d{7}$/;

const DEFAULT_OPT_IN_DESCRIPTION =
  'Customers opt in by texting this business number or by calling the business and requesting a text response. This business uses SMS for customer care, including answering questions, missed-call follow-ups, and service coordination. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to opt out. The SMS privacy policy is available on the business privacy page.';

function hasFirstAndLastName(value: string): boolean {
  return value.trim().split(/\s+/).length >= 2;
}

const brandVerificationSchema = z.object({
  legal_business_name: z.string().min(1, 'Legal business name is required'),
  business_entity_type: z.enum(['llc', 'c_corp', 's_corp', 'nonprofit', 'partnership'] as const, {
    message: 'Select an entity type',
  }),
  business_registration_state: z
    .string()
    .min(2, 'Select the state of registration')
    .refine((value) => Boolean(normalizeUsStateCode(value)), 'Select a valid state'),
  ein: z
    .string()
    .min(1, 'EIN is required')
    .regex(EIN_PATTERN, 'EIN must be in the format XX-XXXXXXX'),
  authorized_rep_name: z
    .string()
    .min(1, 'Representative name is required')
    .refine(
      hasFirstAndLastName,
      'Enter the authorized representative\'s first and last name'
    ),
  authorized_rep_title: z.string().min(1, 'Representative title is required'),
  authorized_rep_email: z.string().email('Enter a valid email address'),
  authorized_rep_phone: z.string().min(10, 'Enter a valid phone number'),
  use_case_description: z
    .string()
    .min(40, 'Describe the use case in at least 40 characters'),
  estimated_monthly_volume: z.enum(['under_1k', '1k_10k', '10k_100k', 'over_100k'] as const, {
    message: 'Select an estimated volume',
  }),
  sample_messages: z
    .array(
      z.object({
        value: z
          .string()
          .min(1, 'Sample message cannot be empty')
          .refine(
            (v) => v.trim().length > 0,
            'Sample message cannot be empty'
          )
          .refine(
            (v) => !PLACEHOLDER_PATTERN.test(v),
            'Sample messages cannot contain placeholders like [Business Name] -- TCR rejects these'
          ),
      })
    )
    .min(3, 'Provide at least 3 sample messages')
    .max(5, 'Provide at most 5 sample messages'),
  opt_in_description: z
    .string()
    .min(40, 'Describe how customers opt in (at least 40 characters)'),
});

type BrandVerificationData = z.infer<typeof brandVerificationSchema>;

export interface BrandVerificationInitialData {
  legal_business_name?: string;
  business_entity_type?: BusinessEntityType | null;
  business_registration_state?: string;
  ein?: string;
  authorized_rep_name?: string;
  authorized_rep_title?: string;
  authorized_rep_email?: string;
  authorized_rep_phone?: string;
  use_case_description?: string;
  estimated_monthly_volume?: string;
  sample_messages?: string[];
  opt_in_description?: string;
}

interface BrandVerificationFormProps {
  businessId: string;
  initialData?: BrandVerificationInitialData;
  onNext: (data: BrandVerificationData) => void;
  onBack: () => void;
}

const ENTITY_TYPE_OPTIONS: { value: Exclude<BusinessEntityType, 'sole_proprietor'>; label: string }[] = [
  { value: 'llc', label: 'LLC' },
  { value: 'c_corp', label: 'C-Corporation' },
  { value: 's_corp', label: 'S-Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'nonprofit', label: 'Nonprofit' },
];

const VOLUME_OPTIONS: { value: BrandVerificationData['estimated_monthly_volume']; label: string }[] = [
  { value: 'under_1k', label: 'Under 1,000 messages / month' },
  { value: '1k_10k', label: '1,000 – 10,000 messages / month' },
  { value: '10k_100k', label: '10,000 – 100,000 messages / month' },
  { value: 'over_100k', label: 'Over 100,000 messages / month' },
];

const INPUT_CLASS =
  'w-full px-3 py-2 border border-slate-200 dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-slate-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[#ff914d] focus:ring-2 focus:ring-[#ff914d]/30';

const LABEL_CLASS = 'block text-sm font-medium text-slate-700 dark:text-[#d4d4d8] mb-1';

const SECTION_HEADER_CLASS = 'text-base font-semibold text-slate-900 dark:text-[#f5f5f5]';

export default function BrandVerificationForm({
  businessId,
  initialData,
  onNext,
  onBack,
}: BrandVerificationFormProps) {
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // After a hard-fail registration response, the user can hit "Try again" to
  // replay registration without re-submitting the form. We keep the validated
  // payload so the retry can hand it back to the parent on success.
  const [pendingRetryData, setPendingRetryData] =
    useState<BrandVerificationData | null>(null);

  const initialSampleMessages =
    initialData?.sample_messages && initialData.sample_messages.length >= 3
      ? initialData.sample_messages.map((value) => ({ value }))
      : [{ value: '' }, { value: '' }, { value: '' }];

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<BrandVerificationData>({
    resolver: zodResolver(brandVerificationSchema),
    defaultValues: {
      legal_business_name: initialData?.legal_business_name || '',
      business_entity_type:
        initialData?.business_entity_type && initialData.business_entity_type !== 'sole_proprietor'
          ? initialData.business_entity_type
          : undefined,
      business_registration_state: normalizeUsStateCode(initialData?.business_registration_state) || '',
      ein: initialData?.ein || '',
      authorized_rep_name: initialData?.authorized_rep_name || '',
      authorized_rep_title: initialData?.authorized_rep_title || '',
      authorized_rep_email: initialData?.authorized_rep_email || '',
      authorized_rep_phone: initialData?.authorized_rep_phone || '',
      use_case_description: initialData?.use_case_description || '',
      estimated_monthly_volume:
        (initialData?.estimated_monthly_volume as BrandVerificationData['estimated_monthly_volume']) ||
        undefined,
      sample_messages: initialSampleMessages,
      opt_in_description: initialData?.opt_in_description || DEFAULT_OPT_IN_DESCRIPTION,
    },
  });

  const {
    fields: sampleFields,
    append: appendSample,
    remove: removeSample,
  } = useFieldArray({ control, name: 'sample_messages' });

  const onSubmit = async (data: BrandVerificationData) => {
    setSaving(true);
    setSubmitError('');
    setPendingRetryData(null);
    try {
      const response = await fetch('/api/onboarding/brand-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          legal_business_name: data.legal_business_name,
          business_entity_type: data.business_entity_type,
          business_registration_state: normalizeUsStateCode(data.business_registration_state),
          ein: data.ein,
          authorized_rep_name: data.authorized_rep_name,
          authorized_rep_title: data.authorized_rep_title,
          authorized_rep_email: data.authorized_rep_email,
          authorized_rep_phone: data.authorized_rep_phone,
          use_case_description: data.use_case_description,
          estimated_monthly_volume: data.estimated_monthly_volume,
          sample_messages: data.sample_messages.map((m) => m.value.trim()),
          opt_in_description: data.opt_in_description,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
      };

      if (!response.ok) {
        // 500 from the brand-verification route signals registration failed
        // server-side after compliance fields were persisted. Surface the
        // canonical message and let the user retry without re-submitting.
        if (response.status === 500) {
          setPendingRetryData(data);
        }
        setSubmitError(
          payload.error ?? 'Could not save brand verification info. Please try again.'
        );
        return;
      }

      onNext(data);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Could not save brand verification info. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const onRetry = async () => {
    if (!pendingRetryData) return;
    setRetrying(true);
    setSubmitError('');
    try {
      const response = await fetch('/api/onboarding/retry-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
      };

      if (!response.ok) {
        setSubmitError(
          payload.error ??
            'Could not register your business with carriers. Please try again or contact support.'
        );
        return;
      }

      const data = pendingRetryData;
      setPendingRetryData(null);
      onNext(data);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Could not register your business with carriers. Please try again or contact support.'
      );
    } finally {
      setRetrying(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Brand verification info</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#bdbdbf]">
          Carriers (AT&amp;T, T-Mobile, Verizon) require this information before we can send SMS on your behalf. We register your brand with The Campaign Registry using these details.
        </p>
      </div>

      {/* Legal entity */}
      <div className="space-y-4">
        <h3 className={SECTION_HEADER_CLASS}>Legal entity</h3>

        <div>
          <label className={LABEL_CLASS}>Legal business name *</label>
          <input
            {...register('legal_business_name')}
            placeholder="As registered with the IRS (e.g. Joe's Plumbing LLC)"
            className={INPUT_CLASS}
          />
          {errors.legal_business_name && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.legal_business_name.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Entity type *</label>
            <select {...register('business_entity_type')} className={INPUT_CLASS} defaultValue="">
              <option value="" disabled>Select an entity type</option>
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {errors.business_entity_type && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.business_entity_type.message}</p>
            )}
          </div>

          <div>
            <label className={LABEL_CLASS}>State of registration *</label>
            <select {...register('business_registration_state')} className={INPUT_CLASS} defaultValue="">
              <option value="" disabled>Select a state</option>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
            </select>
            {errors.business_registration_state && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.business_registration_state.message}</p>
            )}
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>EIN (federal Tax ID) *</label>
          <input
            {...register('ein')}
            placeholder="XX-XXXXXXX"
            inputMode="numeric"
            autoComplete="off"
            className={INPUT_CLASS}
          />
          {errors.ein && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.ein.message}</p>}
          <p className="text-xs text-slate-500 dark:text-[#bdbdbf] mt-1">
            Don&apos;t have an EIN? You can get one free from the IRS in about 15 minutes. Sole Proprietor flow coming soon.
          </p>
        </div>
      </div>

      {/* Authorized representative */}
      <div className="space-y-4">
        <h3 className={SECTION_HEADER_CLASS}>Authorized representative</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          The person at your business authorized to register with messaging carriers.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Full name *</label>
            <input {...register('authorized_rep_name')} className={INPUT_CLASS} />
            {errors.authorized_rep_name && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.authorized_rep_name.message}</p>
            )}
            <p className="text-xs text-slate-500 dark:text-[#bdbdbf] mt-1">
              Full legal name of the authorized representative.
            </p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Title *</label>
            <input
              {...register('authorized_rep_title')}
              placeholder="e.g. Owner, CEO, Manager"
              className={INPUT_CLASS}
            />
            {errors.authorized_rep_title && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.authorized_rep_title.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Email *</label>
            <input {...register('authorized_rep_email')} type="email" className={INPUT_CLASS} />
            {errors.authorized_rep_email && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.authorized_rep_email.message}</p>
            )}
          </div>
          <div>
            <label className={LABEL_CLASS}>Phone *</label>
            <input
              {...register('authorized_rep_phone')}
              placeholder="(555) 123-4567"
              className={INPUT_CLASS}
            />
            {errors.authorized_rep_phone && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.authorized_rep_phone.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Use case */}
      <div className="space-y-4">
        <h3 className={SECTION_HEADER_CLASS}>Use case</h3>

        <div>
          <label className={LABEL_CLASS}>Describe how you&apos;ll use SMS *</label>
          <textarea
            {...register('use_case_description')}
            rows={4}
            placeholder="e.g. Reply to customer inquiries, send missed-call follow-ups, and coordinate service requests."
            className={INPUT_CLASS}
          />
          {errors.use_case_description && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.use_case_description.message}</p>
          )}
          <p className="text-xs text-slate-500 dark:text-[#bdbdbf] mt-1">
            At least 40 characters. Carriers read this directly when reviewing your campaign.
          </p>
        </div>

        <div>
          <label className={LABEL_CLASS}>Estimated monthly message volume *</label>
          <select {...register('estimated_monthly_volume')} className={INPUT_CLASS} defaultValue="">
            <option value="" disabled>Select an estimate</option>
            {VOLUME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errors.estimated_monthly_volume && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.estimated_monthly_volume.message}</p>
          )}
        </div>
      </div>

      {/* Sample messages */}
      <div className="space-y-3">
        <h3 className={SECTION_HEADER_CLASS}>Sample messages (3-5)</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          Real examples of messages you&apos;ll send. Carriers reject placeholders like <code className="text-xs">[Business Name]</code> -- write out the actual business name and details.
        </p>

        <div className="space-y-3">
          {sampleFields.map((field, index) => (
            <div key={field.id} className="p-3 border border-slate-200 dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg">
              <div className="flex gap-2">
                <textarea
                  {...register(`sample_messages.${index}.value`)}
                  rows={2}
                  placeholder={`Sample message ${index + 1}`}
                  className="flex-1 px-3 py-2 border border-slate-200 dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-slate-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d] text-sm resize-none"
                />
                {sampleFields.length > 3 && (
                  <button
                    type="button"
                    onClick={() => removeSample(index)}
                    className="text-red-400 dark:text-red-400/70 hover:text-red-600 dark:hover:text-red-400 px-2"
                    aria-label={`Remove sample message ${index + 1}`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
              {errors.sample_messages?.[index]?.value && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {errors.sample_messages[index]?.value?.message}
                </p>
              )}
            </div>
          ))}
        </div>

        {errors.sample_messages && typeof errors.sample_messages.message === 'string' && (
          <p className="text-sm text-red-600 dark:text-red-400">{errors.sample_messages.message}</p>
        )}

        {sampleFields.length < 5 && (
          <button
            type="button"
            onClick={() => appendSample({ value: '' })}
            className="text-sm text-[#ff914d] hover:text-[#ffb07a] font-medium"
          >
            + Add sample message
          </button>
        )}
      </div>

      {/* Consent / opt-in */}
      <div className="space-y-3">
        <h3 className={SECTION_HEADER_CLASS}>Opt-in description</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          Tell carriers how your customers agree to receive SMS from your business. We&apos;ve drafted a default below -- edit if needed.
        </p>
        <textarea
          {...register('opt_in_description')}
          rows={4}
          className={INPUT_CLASS}
        />
        {errors.opt_in_description && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.opt_in_description.message}</p>
        )}
      </div>

      {submitError && (
        <div className="space-y-2">
          <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
          {pendingRetryData && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center justify-center gap-2 py-2 px-4 border border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-300 font-medium rounded-[22px] hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
            >
              {retrying ? (
                <>
                  <PulsingDot inline />
                  Retrying…
                </>
              ) : (
                'Try again'
              )}
            </button>
          )}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="py-2 px-6 border border-slate-200 dark:border-white/[0.12] text-slate-700 dark:text-[#bdbdbf] font-medium rounded-[22px] hover:bg-slate-100 dark:hover:bg-white/[0.06]"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={saving || retrying}
          className="inline-flex items-center justify-center gap-2 py-2 px-6 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 dark:hover:brightness-110 font-medium rounded-[22px] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:ring-offset-2 disabled:opacity-50"
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
    </form>
  );
}
