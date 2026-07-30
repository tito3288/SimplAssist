'use client';

import { useMemo, useState } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/lib/supabase/client';
import type { BusinessType } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaInlineClass, secondaryCtaClass } from '@/lib/glass';
import {
  FAQ_ANSWER_MAX_LENGTH,
  MIN_VALID_FAQS,
  MIN_VALID_SERVICES,
  evaluateContentQuality,
  isValidFaq,
  isValidService,
  normalizeKnowledgeKey,
} from '@/lib/contentQuality';
import {
  buildServicesAndFaqsDefaults,
  type ServicesAndFaqsValues,
} from '@/lib/onboarding/servicesAndFaqsDefaults';
import {
  prepareServicesAndFaqsSubmission,
  servicesAndFaqsSchema,
  type ServicesAndFaqsData,
} from '@/lib/onboarding/servicesAndFaqsSubmission';

export type { ServicesAndFaqsData } from '@/lib/onboarding/servicesAndFaqsSubmission';

function serviceNotCountingReason(
  service: ServicesAndFaqsData['services'][number] | undefined,
  index: number,
  services: ServicesAndFaqsData['services']
): string | null {
  if (!service || !isValidService(service)) {
    return 'Add a service name for this entry to count.';
  }

  const key = normalizeKnowledgeKey(service.name);
  const duplicatesEarlierValidRow = services
    .slice(0, index)
    .some(
      (candidate) =>
        isValidService(candidate) &&
        normalizeKnowledgeKey(candidate.name) === key
    );

  return duplicatesEarlierValidRow
    ? 'This duplicate service does not count toward the minimum.'
    : null;
}

function faqNotCountingReason(
  faq: ServicesAndFaqsData['faqs'][number] | undefined,
  index: number,
  faqs: ServicesAndFaqsData['faqs']
): string | null {
  if (!faq) return 'Add both a question and answer for this FAQ to count.';

  const question = faq.question.trim();
  const answer = faq.answer.trim();
  if (!question && !answer) {
    return 'Add both a question and answer for this FAQ to count.';
  }
  if (!question) return 'Add a question for this FAQ to count.';
  if (!answer) return 'Add an answer for this FAQ to count.';
  if (faq.answer.length > FAQ_ANSWER_MAX_LENGTH) {
    return `Shorten this answer to ${FAQ_ANSWER_MAX_LENGTH} characters or less for it to count.`;
  }

  const key = normalizeKnowledgeKey(question);
  const duplicatesEarlierValidRow = faqs
    .slice(0, index)
    .some(
      (candidate) =>
        isValidFaq(candidate) &&
        normalizeKnowledgeKey(candidate.question) === key
    );

  return duplicatesEarlierValidRow
    ? 'This duplicate FAQ does not count toward the minimum.'
    : null;
}

const SUGGESTED_FAQS: Record<string, { question: string; answer: string }[]> = {
  plumber: [
    { question: 'Do you offer emergency service?', answer: '' },
    { question: 'What areas do you serve?', answer: '' },
    { question: 'Do you provide free estimates?', answer: '' },
  ],
  dentist: [
    { question: 'Do you accept insurance?', answer: '' },
    { question: 'Do you offer emergency appointments?', answer: '' },
    { question: 'What payment options do you accept?', answer: '' },
  ],
  restaurant: [
    { question: 'Do you offer delivery?', answer: '' },
    { question: 'Can I make a reservation?', answer: '' },
    { question: 'Do you cater events?', answer: '' },
  ],
  car_wash: [
    { question: 'Do you offer detailing services?', answer: '' },
    { question: 'Do you have monthly memberships?', answer: '' },
    { question: 'What are your hours?', answer: '' },
  ],
  salon: [
    { question: 'Do I need an appointment?', answer: '' },
    { question: 'What products do you use?', answer: '' },
    { question: 'Do you offer gift cards?', answer: '' },
  ],
  hvac: [
    { question: 'Do you offer emergency service?', answer: '' },
    { question: 'Do you provide free estimates?', answer: '' },
    { question: 'What brands do you service?', answer: '' },
  ],
  auto_shop: [
    { question: 'Do you offer free diagnostics?', answer: '' },
    { question: 'Do you work on all makes and models?', answer: '' },
    { question: 'Do you provide loaner vehicles?', answer: '' },
  ],
  real_estate: [
    { question: 'What areas do you serve?', answer: '' },
    { question: 'Do you help buyers and sellers?', answer: '' },
    { question: 'How can I schedule a consultation?', answer: '' },
  ],
  legal: [
    { question: 'What practice areas do you handle?', answer: '' },
    { question: 'Do you offer consultations?', answer: '' },
    { question: 'What should I bring to an appointment?', answer: '' },
  ],
  financial: [
    { question: 'What services do you provide?', answer: '' },
    { question: 'Do you offer consultations?', answer: '' },
    { question: 'How can I get started?', answer: '' },
  ],
  insurance: [
    { question: 'What types of coverage do you offer?', answer: '' },
    { question: 'Can I request a quote?', answer: '' },
    { question: 'How do I update my policy?', answer: '' },
  ],
  retail: [
    { question: 'What products do you carry?', answer: '' },
    { question: 'Do you offer pickup or delivery?', answer: '' },
    { question: 'What is your return policy?', answer: '' },
  ],
  general: [
    { question: 'What are your hours of operation?', answer: '' },
    { question: 'How can I contact you?', answer: '' },
    { question: 'Where are you located?', answer: '' },
  ],
};

interface ServicesAndFaqsFormProps {
  businessId: string;
  businessType: BusinessType;
  scrapedServices?: { name: string; description?: string; price?: string }[];
  scrapedFaqs?: { question: string; answer: string }[];
  initialData?: ServicesAndFaqsValues;
  onNext: (data: ServicesAndFaqsData) => void;
  onBack: () => void;
}

export default function ServicesAndFaqsForm({
  businessId,
  businessType,
  scrapedServices,
  scrapedFaqs,
  initialData,
  onNext,
  onBack,
}: ServicesAndFaqsFormProps) {
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const suggestedFaqs = SUGGESTED_FAQS[businessType] || SUGGESTED_FAQS.general;

  const defaults = useMemo(
    () =>
      buildServicesAndFaqsDefaults({
        initialData,
        scrapedServices,
        scrapedFaqs,
        suggestedFaqs,
      }),
    [initialData, scrapedServices, scrapedFaqs, suggestedFaqs]
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ServicesAndFaqsData>({
    resolver: zodResolver(servicesAndFaqsSchema),
    defaultValues: {
      services: defaults.services,
      faqs: defaults.faqs,
    },
  });

  const {
    fields: serviceFields,
    append: appendService,
    remove: removeService,
  } = useFieldArray({ control, name: 'services' });

  const {
    fields: faqFields,
    append: appendFaq,
    remove: removeFaq,
  } = useFieldArray({ control, name: 'faqs' });

  const watchedServices = useWatch({ control, name: 'services' }) ?? [];
  const watchedFaqs = useWatch({ control, name: 'faqs' }) ?? [];
  const quality = evaluateContentQuality({
    services: watchedServices,
    faqs: watchedFaqs,
  });
  const servicesError = errors.services as
    | (typeof errors.services & { root?: { message?: unknown } })
    | undefined;
  const faqsError = errors.faqs as
    | (typeof errors.faqs & { root?: { message?: unknown } })
    | undefined;
  const servicesErrorMessage =
    typeof servicesError?.message === 'string'
      ? servicesError.message
      : typeof servicesError?.root?.message === 'string'
        ? servicesError.root.message
        : null;
  const faqsErrorMessage =
    typeof faqsError?.message === 'string'
      ? faqsError.message
      : typeof faqsError?.root?.message === 'string'
        ? faqsError.root.message
        : null;

  const onSubmit = async (data: ServicesAndFaqsData) => {
    setSaving(true);
    setSubmitError('');
    try {
      const supabase = createClient();
      const { cleanedData, rpcArguments } =
        prepareServicesAndFaqsSubmission(businessId, data);

      // Atomic replace via the provenance-aware RPC: both tables are replaced
      // in one transaction, so a mid-save failure can never lose existing
      // rows. Arrays are always passed explicitly (even when empty) —
      // PostgREST resolves the function by its named arguments.
      const { error } = await supabase.rpc(
        'replace_services_and_faqs',
        rpcArguments
      );
      if (error) throw error;

      const { error: markerError } = await supabase.from('businesses').update({
        onboarding_step: 'ai_settings',
        onboarding_last_saved_at: new Date().toISOString(),
      }).eq('id', businessId);
      if (markerError) {
        // Advisory resume marker only — the data write above succeeded, and
        // the server re-derives the step from saved data on next load.
        console.warn('Failed to update onboarding progress marker:', markerError.message);
      }

      onNext(cleanedData);
    } catch {
      setSubmitError('Could not save your services and FAQs. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div
        role="note"
        aria-labelledby="knowledge-quality-title"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100"
      >
        <p id="knowledge-quality-title" className="text-sm font-semibold">
          Give your AI enough information to help customers
        </p>
        <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">
          Add at least {MIN_VALID_SERVICES} distinct services and answer at least{' '}
          {MIN_VALID_FAQS} distinct FAQs. Your AI can only answer from the
          information you provide here.
        </p>
      </div>

      {/* Services Section */}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
            Services
          </h2>
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              quality.hasMinimumServices
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200'
            }`}
          >
            {Math.min(quality.validServiceCount, MIN_VALID_SERVICES)} of{' '}
            {MIN_VALID_SERVICES} ready
          </span>
        </div>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">
          Add the services your business offers.
        </p>

        <div className="space-y-3">
          {serviceFields.map((field, index) => {
            const notCountingReason = serviceNotCountingReason(
              watchedServices[index],
              index,
              watchedServices
            );

            return (
              <div key={field.id} className="p-3 border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg space-y-2">
                <input
                  type="hidden"
                  {...register(`services.${index}.source`)}
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      {...register(`services.${index}.name`)}
                      placeholder="Service name *"
                      aria-describedby={`service-${index}-quality`}
                      className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm"
                    />
                  </div>
                  <div className="w-28">
                    <input
                      {...register(`services.${index}.price`)}
                      placeholder="Price"
                      className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm"
                    />
                  </div>
                  {serviceFields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeService(index)}
                      aria-label={`Remove service ${index + 1}`}
                      className="text-red-400 dark:text-red-400/70 hover:text-red-600 dark:hover:text-red-400 px-2"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
                <input
                  {...register(`services.${index}.description`)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm"
                />
                <p
                  id={`service-${index}-quality`}
                  className={`text-xs ${
                    notCountingReason
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {notCountingReason ?? 'Counts toward your service minimum.'}
                </p>
              </div>
            );
          })}
        </div>

        {servicesErrorMessage && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-2">
            {servicesErrorMessage}
          </p>
        )}

        <button
          type="button"
          onClick={() =>
            appendService({
              name: '',
              description: '',
              price: '',
              source: 'manual',
            })
          }
          className="mt-3 text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] font-medium"
        >
          + Add Service
        </button>
      </div>

      {/* FAQs Section */}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
            FAQs
          </h2>
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              quality.hasMinimumFaqs
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200'
            }`}
          >
            {Math.min(quality.validFaqCount, MIN_VALID_FAQS)} of{' '}
            {MIN_VALID_FAQS} ready
          </span>
        </div>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-2">
          Common questions your customers ask.
        </p>

        {defaults.usedSuggestedFaqs && (
          <div className="mb-4 p-3 bg-[#fdf1e7] dark:bg-[rgba(255,145,77,.12)] border border-[#f5dcc4] dark:border-white/[0.10] rounded-lg">
            <p className="text-sm text-[#c2410c] dark:text-[#ff914d] font-medium mb-2">Suggested FAQs for your business type:</p>
            <p className="text-xs text-[#c2410c]/80 dark:text-[#ff914d]/80">
              We&apos;ve pre-filled some common questions. Fill in the answers or remove any that don&apos;t apply.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {faqFields.map((field, index) => {
            const notCountingReason = faqNotCountingReason(
              watchedFaqs[index],
              index,
              watchedFaqs
            );

            return (
              <div key={field.id} className="p-3 border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg space-y-2">
                <input
                  type="hidden"
                  {...register(`faqs.${index}.source`)}
                />
                <div className="flex gap-2">
                  <input
                    {...register(`faqs.${index}.question`)}
                    placeholder="Question"
                    aria-describedby={`faq-${index}-quality`}
                    className="flex-1 px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeFaq(index)}
                    aria-label={`Remove FAQ ${index + 1}`}
                    className="text-red-400 dark:text-red-400/70 hover:text-red-600 dark:hover:text-red-400 px-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <textarea
                  {...register(`faqs.${index}.answer`)}
                  placeholder="Answer"
                  rows={2}
                  maxLength={FAQ_ANSWER_MAX_LENGTH}
                  aria-describedby={`faq-${index}-quality`}
                  className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm resize-none"
                />
                <p
                  id={`faq-${index}-quality`}
                  className={`text-xs ${
                    notCountingReason
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {notCountingReason ?? 'Counts toward your FAQ minimum.'}
                </p>
              </div>
            );
          })}
        </div>

        {faqsErrorMessage && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-2">
            {faqsErrorMessage}
          </p>
        )}

        <button
          type="button"
          onClick={() =>
            appendFaq({ question: '', answer: '', source: 'manual' })
          }
          className="mt-3 text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] font-medium"
        >
          + Add FAQ
        </button>
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
      )}

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className={secondaryCtaClass}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={saving}
          className={primaryCtaInlineClass}
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving...
            </>
          ) : (
            'Save & continue'
          )}
        </button>
      </div>
    </form>
  );
}
