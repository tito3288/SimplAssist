'use client';

import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { defaultOnboardingOptInDescription } from '@/lib/messaging/complianceCopy';
import { PulsingDot } from '@/components/ui/pulsing-dot';

const PLACEHOLDER_PATTERN = /\[.+?\]/;
const STOP_PATTERN = /\bstop\b/i;
const DEFAULT_OPT_IN_DESCRIPTION = defaultOnboardingOptInDescription();

const smsUseCaseSchema = z.object({
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
          .refine((value) => value.trim().length > 0, 'Sample message cannot be empty')
          .refine(
            (value) => !PLACEHOLDER_PATTERN.test(value),
            'Sample messages cannot contain placeholders like [Business Name] -- carriers reject these'
          ),
      })
    )
    .min(3, 'Provide at least 3 sample messages')
    .max(5, 'Provide at most 5 sample messages')
    .refine(
      (messages) => messages.some((message) => STOP_PATTERN.test(message.value)),
      'At least one sample message must include STOP opt-out wording'
    ),
  opt_in_description: z
    .string()
    .min(40, 'Describe how customers opt in (at least 40 characters)'),
});

export type SmsUseCaseData = z.infer<typeof smsUseCaseSchema>;

interface SmsUseCaseInitialData {
  use_case_description?: string;
  estimated_monthly_volume?: string;
  sample_messages?: string[];
  opt_in_description?: string;
}

interface SmsUseCaseFormProps {
  businessId: string;
  initialData?: SmsUseCaseInitialData | null;
  onNext: (data: SmsUseCaseData) => void;
  onBack: () => void;
}

const VOLUME_OPTIONS: { value: SmsUseCaseData['estimated_monthly_volume']; label: string }[] = [
  { value: 'under_1k', label: 'Under 1,000 messages / month' },
  { value: '1k_10k', label: '1,000 - 10,000 messages / month' },
  { value: '10k_100k', label: '10,000 - 100,000 messages / month' },
  { value: 'over_100k', label: 'Over 100,000 messages / month' },
];

const INPUT_CLASS =
  'w-full px-3 py-2 border border-slate-200 dark:border-white/[0.12] rounded-[22px] bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-slate-400 dark:placeholder:text-[#666] focus:outline-none focus:border-[#ff914d] focus:ring-2 focus:ring-[#ff914d]/30';

const LABEL_CLASS = 'block text-sm font-medium text-slate-700 dark:text-[#d4d4d8] mb-1';
const SECTION_HEADER_CLASS = 'text-base font-semibold text-slate-900 dark:text-[#f5f5f5]';

export default function SmsUseCaseForm({
  businessId,
  initialData,
  onNext,
  onBack,
}: SmsUseCaseFormProps) {
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const initialSampleMessages =
    initialData?.sample_messages && initialData.sample_messages.length >= 3
      ? initialData.sample_messages.map((value) => ({ value }))
      : [{ value: '' }, { value: '' }, { value: '' }];

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SmsUseCaseData>({
    resolver: zodResolver(smsUseCaseSchema),
    defaultValues: {
      use_case_description: initialData?.use_case_description || '',
      estimated_monthly_volume:
        (initialData?.estimated_monthly_volume as SmsUseCaseData['estimated_monthly_volume']) ||
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

  const onSubmit = async (data: SmsUseCaseData) => {
    setSaving(true);
    setSubmitError('');

    try {
      const response = await fetch('/api/onboarding/sms-use-case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          use_case_description: data.use_case_description,
          estimated_monthly_volume: data.estimated_monthly_volume,
          sample_messages: data.sample_messages.map((message) => message.value.trim()),
          opt_in_description: data.opt_in_description,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setSubmitError(payload.error ?? 'Could not save SMS use case details. Please try again.');
        return;
      }

      onNext(data);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Could not save SMS use case details. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">How your business will use SMS</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#bdbdbf]">
          Carriers review these examples before activating texting. Keep them limited to customer care, missed-call follow-up, and service coordination.
        </p>
      </div>

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
        </div>

        <div>
          <label className={LABEL_CLASS}>Estimated monthly message volume *</label>
          <select {...register('estimated_monthly_volume')} className={INPUT_CLASS} defaultValue="">
            <option value="" disabled>Select an estimate</option>
            {VOLUME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {errors.estimated_monthly_volume && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.estimated_monthly_volume.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className={SECTION_HEADER_CLASS}>Sample messages (3-5)</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          Write real examples with your actual business name. At least one sample must include STOP opt-out wording.
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

      <div className="space-y-3">
        <h3 className={SECTION_HEADER_CLASS}>Opt-in description</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          Tell carriers how customers agree to receive customer-care texts from your business. We drafted a default you can adjust.
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
        <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
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
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 py-2 px-6 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 dark:hover:brightness-110 font-medium rounded-[22px] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:ring-offset-2 disabled:opacity-50"
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
