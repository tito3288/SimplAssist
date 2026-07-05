'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import type { BusinessEntityType } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { normalizeUsStateCode, US_STATES } from '@/lib/usStates';

const EIN_PATTERN = /^\d{2}-\d{7}$/;

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
  const [submitError, setSubmitError] = useState('');

  const {
    register,
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
    },
  });

  const onSubmit = async (data: BrandVerificationData) => {
    setSaving(true);
    setSubmitError('');
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
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
      };

      if (!response.ok) {
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Brand verification info</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#bdbdbf]">
          Carriers require this exact business identity before we can activate SMS for your account. Use the legal details that match your EIN.
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
