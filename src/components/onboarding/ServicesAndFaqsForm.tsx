'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BusinessType } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaInlineClass, secondaryCtaClass } from '@/lib/glass';

// Cap FAQ answers so a pasted or scan-prefilled answer can't bloat the AI
// prompt context. The DB column is unbounded `text` and nothing external
// (incl. Telnyx, which never receives FAQs) limits it, so this is a product
// cap. One constant drives both the input maxLength and the zod rule so they
// can't drift.
const FAQ_ANSWER_MAX_LENGTH = 2000;

const servicesAndFaqsSchema = z.object({
  services: z
    .array(
      z.object({
        name: z.string().min(1, 'Service name is required'),
        description: z.string().optional(),
        price: z.string().optional(),
      })
    )
    .min(1, 'Add at least one service'),
  faqs: z.array(
    z.object({
      question: z.string().min(1, 'Question is required'),
      answer: z
        .string()
        .min(1, 'Answer is required')
        .max(FAQ_ANSWER_MAX_LENGTH, `Answer must be ${FAQ_ANSWER_MAX_LENGTH} characters or less`),
    })
  ),
});

type ServicesAndFaqsData = z.infer<typeof servicesAndFaqsSchema>;

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
  initialData?: ServicesAndFaqsData;
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

  // Prefill precedence: saved data (initialData) always wins, so the
  // customer's own entries are never overwritten. A website scan pre-fills
  // (as editable fields) only when there's no saved data; otherwise the empty
  // template / suggested FAQs. Empty scraped arrays are treated as absent so a
  // scan that found nothing never leaves the customer with zero rows.
  const defaultServices = initialData?.services ||
    (scrapedServices?.length
      ? scrapedServices.map((s) => ({ name: s.name, description: s.description || '', price: s.price || '' }))
      : undefined) ||
    [{ name: '', description: '', price: '' }];

  const defaultFaqs = initialData?.faqs ||
    (scrapedFaqs?.length ? scrapedFaqs : undefined) ||
    SUGGESTED_FAQS[businessType] ||
    SUGGESTED_FAQS.general;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ServicesAndFaqsData>({
    resolver: zodResolver(servicesAndFaqsSchema),
    defaultValues: {
      services: defaultServices,
      faqs: defaultFaqs,
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

  const onSubmit = async (data: ServicesAndFaqsData) => {
    setSaving(true);
    setSubmitError('');
    try {
      const supabase = createClient();

      // Atomic replace via RPC (migration 023): both tables are replaced in
      // one transaction, so a mid-save failure can never lose existing rows.
      // Arrays are always passed explicitly (even when empty) — PostgREST
      // resolves the function by its named arguments.
      const answeredFaqs = data.faqs.filter((f) => f.question && f.answer);
      const { error } = await supabase.rpc('replace_services_and_faqs', {
        p_business_id: businessId,
        p_services: data.services.map((s) => ({
          name: s.name,
          description: s.description || null,
          price: s.price || null,
        })),
        p_faqs: answeredFaqs.map((f) => ({
          question: f.question,
          answer: f.answer,
          source: 'manual' as const,
        })),
      });
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

      onNext(data);
    } catch {
      setSubmitError('Could not save your services and FAQs. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const suggestedFaqs = SUGGESTED_FAQS[businessType] || SUGGESTED_FAQS.general;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Services Section */}
      <div>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Services</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Add the services your business offers.</p>

        <div className="space-y-3">
          {serviceFields.map((field, index) => (
            <div key={field.id} className="p-3 border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    {...register(`services.${index}.name`)}
                    placeholder="Service name *"
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
            </div>
          ))}
        </div>

        {errors.services && typeof errors.services.message === 'string' && (
          <p className="text-sm text-red-600 mt-1">{errors.services.message}</p>
        )}

        <button
          type="button"
          onClick={() => appendService({ name: '', description: '', price: '' })}
          className="mt-3 text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] font-medium"
        >
          + Add Service
        </button>
      </div>

      {/* FAQs Section */}
      <div>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">FAQs</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-2">Common questions your customers ask.</p>

        {!initialData && !scrapedFaqs?.length && suggestedFaqs.length > 0 && (
          <div className="mb-4 p-3 bg-[#fdf1e7] dark:bg-[rgba(255,145,77,.12)] border border-[#f5dcc4] dark:border-white/[0.10] rounded-lg">
            <p className="text-sm text-[#c2410c] dark:text-[#ff914d] font-medium mb-2">Suggested FAQs for your business type:</p>
            <p className="text-xs text-[#c2410c]/80 dark:text-[#ff914d]/80">
              We&apos;ve pre-filled some common questions. Fill in the answers or remove any that don&apos;t apply.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {faqFields.map((field, index) => (
            <div key={field.id} className="p-3 border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg space-y-2">
              <div className="flex gap-2">
                <input
                  {...register(`faqs.${index}.question`)}
                  placeholder="Question"
                  className="flex-1 px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeFaq(index)}
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
                className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30 focus:border-[#ea580c] dark:focus:border-[#ff914d] text-sm resize-none"
              />
              {errors.faqs?.[index]?.answer && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {errors.faqs[index]?.answer?.message}
                </p>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => appendFaq({ question: '', answer: '' })}
          className="mt-3 text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] font-medium"
        >
          + Add FAQ
        </button>
      </div>

      {submitError && (
        <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
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
            'Next'
          )}
        </button>
      </div>
    </form>
  );
}
