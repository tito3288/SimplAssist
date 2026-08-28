'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  createWebsiteScanRequestId,
  publishWebsiteScan,
  saveWebsiteScanReview,
  type WebsiteScan,
  type WebsiteScanReviewDraft,
} from '@/lib/website-scans/client';
import {
  ScanDraftDetailsEditor,
  SourceEvidence,
} from '@/components/website-scans/ScanDraftDetailsEditor';

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
  onBack?: () => void;
  websiteScan?: WebsiteScan & { draft: WebsiteScanReviewDraft };
  mode?: 'onboarding' | 'settings';
  onDiscardScan?: () => Promise<void> | void;
}

export default function ServicesAndFaqsForm({
  businessId,
  businessType,
  scrapedServices,
  scrapedFaqs,
  initialData,
  onNext,
  onBack,
  websiteScan,
  mode = 'onboarding',
  onDiscardScan,
}: ServicesAndFaqsFormProps) {
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reviewDraft, setReviewDraft] = useState<WebsiteScanReviewDraft | null>(() => {
    if (!websiteScan?.draft) return null;
    const metadata = websiteScan.draft.overviewMetadata;
    return metadata && metadata.selected === undefined
      ? {
          ...websiteScan.draft,
          overviewMetadata: { ...metadata, selected: !metadata.targetId },
        }
      : websiteScan.draft;
  });
  const lastSavedDraft = useRef('');
  const scanVersionRef = useRef(websiteScan?.version ?? 0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const publishIdempotencyRef = useRef({
    scanId: websiteScan?.id ?? '',
    key: createWebsiteScanRequestId(),
  });
  if (websiteScan && publishIdempotencyRef.current.scanId !== websiteScan.id) {
    publishIdempotencyRef.current = {
      scanId: websiteScan.id,
      key: createWebsiteScanRequestId(),
    };
  }
  const suggestedFaqs = SUGGESTED_FAQS[businessType] || SUGGESTED_FAQS.general;

  const defaults = useMemo(
    () =>
      buildServicesAndFaqsDefaults({
        initialData: websiteScan ? undefined : initialData,
        scrapedServices: websiteScan
          ? websiteScan.draft.services.map(({ name, description, price }) => ({ name, description, price }))
          : scrapedServices,
        scrapedFaqs: websiteScan
          ? websiteScan.draft.faqs.map(({ question, answer }) => ({ question, answer }))
          : scrapedFaqs,
        suggestedFaqs,
      }),
    [initialData, scrapedServices, scrapedFaqs, suggestedFaqs, websiteScan]
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ServicesAndFaqsData>({
    // A scan review publishes a delta over any already-approved knowledge,
    // so its floor is validated against the union below. A fresh onboarding
    // review still has no baseline and must supply the full 3+3 itself.
    resolver:
      websiteScan
        ? undefined
        : zodResolver(servicesAndFaqsSchema),
    defaultValues: {
      services:
        websiteScan && (mode === 'settings' || initialData)
          ? defaults.services.slice(0, websiteScan.draft.services.length)
          : defaults.services,
      faqs:
        websiteScan && (mode === 'settings' || initialData)
          ? defaults.faqs.slice(0, websiteScan.draft.faqs.length)
          : defaults.faqs,
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

  const removeServiceRow = (index: number) => {
    removeService(index);
    if (reviewDraft?.services[index]) {
      const services = [...reviewDraft.services];
      services.splice(index, 1);
      setReviewDraft({ ...reviewDraft, services });
    }
  };

  const removeFaqRow = (index: number) => {
    removeFaq(index);
    if (reviewDraft?.faqs[index]) {
      const faqs = [...reviewDraft.faqs];
      faqs.splice(index, 1);
      setReviewDraft({ ...reviewDraft, faqs });
    }
  };

  const watchedServices = useWatch({ control, name: 'services' }) ?? [];
  const watchedFaqs = useWatch({ control, name: 'faqs' }) ?? [];
  const selectedServices = reviewDraft
    ? watchedServices.filter((_, index) => reviewDraft.services[index]?.selected ?? true)
    : watchedServices;
  const selectedFaqs = reviewDraft
    ? watchedFaqs.filter((_, index) => reviewDraft.faqs[index]?.selected ?? true)
    : watchedFaqs;
  const qualityInput =
    websiteScan && initialData
      ? {
          services: [...initialData.services, ...selectedServices],
          faqs: [...initialData.faqs, ...selectedFaqs],
        }
      : { services: selectedServices, faqs: selectedFaqs };
  const quality = evaluateContentQuality(qualityInput);

  function currentReviewDraft(): WebsiteScanReviewDraft | null {
    if (!reviewDraft) return null;
    return {
      ...reviewDraft,
      services: watchedServices.map((service, index) => ({
        ...(reviewDraft.services[index] ?? {
          id: `manual-service-${index}`,
          selected: true,
        }),
        name: service.name,
        description: service.description,
        price: service.price,
      })),
      faqs: watchedFaqs.map((faq, index) => ({
        ...(reviewDraft.faqs[index] ?? {
          id: `manual-faq-${index}`,
          selected: true,
        }),
        question: faq.question,
        answer: faq.answer,
      })),
    };
  }

  const queueDraftSave = useCallback((snapshot: WebsiteScanReviewDraft) => {
    if (!websiteScan) return Promise.resolve();
    const serialized = JSON.stringify(snapshot);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (serialized === lastSavedDraft.current) return;
        setSaveStatus('saving');
        const saved = await saveWebsiteScanReview({
          scanId: websiteScan.id,
          expectedVersion: scanVersionRef.current,
          draft: snapshot,
        });
        scanVersionRef.current = saved.version;
        lastSavedDraft.current = serialized;
        setSaveStatus('saved');
      })
      .catch((error) => {
        setSaveStatus('error');
        throw error;
      });
    return saveQueueRef.current;
  }, [websiteScan]);

  useEffect(() => {
    if (!websiteScan || !reviewDraft) return;
    const snapshot = currentReviewDraft();
    if (!snapshot) return;
    if (!lastSavedDraft.current) {
      lastSavedDraft.current = JSON.stringify(websiteScan.draft);
    }

    const timeout = window.setTimeout(() => {
      void queueDraftSave(snapshot).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timeout);
    // The watched arrays are intentional dependencies: react-hook-form owns
    // those values while the rest of the scan draft lives in local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewDraft, watchedServices, watchedFaqs, websiteScan, queueDraftSave]);
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
      const selectedData = reviewDraft
        ? {
            services: data.services.filter((_, index) => reviewDraft.services[index]?.selected ?? true),
            faqs: data.faqs.filter((_, index) => reviewDraft.faqs[index]?.selected ?? true),
          }
        : data;
      const selectedQuality = evaluateContentQuality(
        websiteScan && initialData
          ? {
              services: [...initialData.services, ...selectedData.services],
              faqs: [...initialData.faqs, ...selectedData.faqs],
            }
          : selectedData
      );
      if (!selectedQuality.hasMinimumServices || !selectedQuality.hasMinimumFaqs) {
        setSubmitError(
          `Select at least ${MIN_VALID_SERVICES} distinct services and ${MIN_VALID_FAQS} answered FAQs before continuing.`
        );
        return;
      }
      const { cleanedData, rpcArguments } =
        prepareServicesAndFaqsSubmission(businessId, selectedData);

      if (websiteScan && reviewDraft) {
        const finalDraft: WebsiteScanReviewDraft = {
          ...reviewDraft,
          services: data.services.map((service, index) => ({
            ...(reviewDraft.services[index] ?? {
              id: `manual-service-${index}`,
              selected: true,
            }),
            name: service.name,
            description: service.description,
            price: service.price,
          })),
          faqs: data.faqs.map((faq, index) => ({
            ...(reviewDraft.faqs[index] ?? {
              id: `manual-faq-${index}`,
              selected: true,
            }),
            question: faq.question,
            answer: faq.answer,
          })),
        };
        await queueDraftSave(finalDraft);
        await publishWebsiteScan({
          scanId: websiteScan.id,
          expectedVersion: scanVersionRef.current,
          idempotencyKey: publishIdempotencyRef.current.key,
          draft: finalDraft,
        });
        onNext(cleanedData);
        return;
      }

      const supabase = createClient();

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
    } catch (cause) {
      setSubmitError(
        websiteScan && cause instanceof Error
          ? cause.message
          : 'Could not save your services and FAQs. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const discardScan = async () => {
    if (!onDiscardScan) return;
    setDiscarding(true);
    setSubmitError('');
    try {
      await onDiscardScan();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not discard this scan.');
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
          Assistant Knowledge
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          Review the information your assistant will use when helping customers.
          Nothing from a website scan is used until you approve it here.
        </p>
        {websiteScan && websiteScan.coverage !== 'complete' && (
          <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
            {websiteScan.coverage === 'insufficient'
              ? 'We found very little usable website content. Treat this draft as a starting point and fill in missing details manually.'
              : 'Some website pages could not be read. The draft is still usable, but please add anything important that is missing.'}
          </div>
        )}
        {websiteScan && (
          <p className="mt-2 text-xs text-stone-500" aria-live="polite">
            {saveStatus === 'saving' && 'Saving draft…'}
            {saveStatus === 'saved' && 'Draft saved.'}
            {saveStatus === 'error' && 'Draft could not be autosaved. Your edits remain on this page.'}
          </p>
        )}
      </div>

      {reviewDraft && (
        <ScanDraftDetailsEditor draft={reviewDraft} onChange={setReviewDraft} />
      )}

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
            const selected = reviewDraft?.services[index]?.selected ?? true;
            const serviceQualityRows =
              websiteScan && initialData
                ? [...initialData.services, ...watchedServices]
                : watchedServices;
            const serviceQualityIndex =
              websiteScan && initialData
                ? initialData.services.length + index
                : index;
            const notCountingReason = selected
              ? serviceNotCountingReason(
                  watchedServices[index],
                  serviceQualityIndex,
                  serviceQualityRows
                )
              : 'Not selected for your assistant.';

            return (
              <div key={field.id} className="p-3 border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg space-y-2">
                <input
                  type="hidden"
                  {...register(`services.${index}.source`)}
                />
                <div className="flex gap-2">
                  {reviewDraft?.services[index] && (
                    <input
                      type="checkbox"
                      checked={reviewDraft.services[index].selected}
                      onChange={(event) => {
                        const services = [...reviewDraft.services];
                        services[index] = { ...services[index], selected: event.target.checked };
                        setReviewDraft({ ...reviewDraft, services });
                      }}
                      aria-label={`Use ${watchedServices[index]?.name || `service ${index + 1}`}`}
                      className="mt-3 h-4 w-4 shrink-0 accent-[var(--brand-primary)]"
                    />
                  )}
                  <div className="flex-1">
                    <input
                      {...register(`services.${index}.name`)}
                      maxLength={120}
                      placeholder="Service name *"
                      aria-describedby={`service-${index}-quality`}
                      className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] focus:border-[var(--brand-primary)] dark:focus:border-[var(--brand-primary-dark)] text-sm"
                    />
                  </div>
                  <div className="w-28">
                    <input
                      {...register(`services.${index}.price`)}
                      maxLength={120}
                      placeholder="Price"
                      className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] focus:border-[var(--brand-primary)] dark:focus:border-[var(--brand-primary-dark)] text-sm"
                    />
                  </div>
                  {serviceFields.length > 1 && !reviewDraft?.services[index] && (
                    <button
                      type="button"
                      onClick={() => removeServiceRow(index)}
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
                  maxLength={1000}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] focus:border-[var(--brand-primary)] dark:focus:border-[var(--brand-primary-dark)] text-sm"
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
                {reviewDraft?.services[index]?.changeType && reviewDraft.services[index].changeType !== 'new' && (
                  <span className="text-xs font-medium text-stone-500">
                    {reviewDraft.services[index].changeType === 'changed' ? 'Website suggests an update' : 'Already approved'}
                  </span>
                )}
                <SourceEvidence evidence={reviewDraft?.services[index]?.evidence} />
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
          className="mt-3 text-sm text-[var(--brand-accent)] hover:text-[var(--brand-primary-active)] dark:text-[var(--brand-accent-dark)] dark:hover:text-[var(--brand-primary-soft-dark)] font-medium"
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
          <div className="mb-4 p-3 bg-[var(--brand-accent-soft)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/.12)] border border-[var(--brand-accent-soft-border)] dark:border-white/[0.10] rounded-lg">
            <p className="text-sm text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)] font-medium mb-2">Suggested FAQs for your business type:</p>
            <p className="text-xs text-[rgb(var(--brand-accent-rgb)/.80)] dark:text-[rgb(var(--brand-accent-dark-rgb)/.80)]">
              We&apos;ve pre-filled some common questions. Fill in the answers or remove any that don&apos;t apply.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {faqFields.map((field, index) => {
            const selected = reviewDraft?.faqs[index]?.selected ?? true;
            const faqQualityRows =
              websiteScan && initialData
                ? [...initialData.faqs, ...watchedFaqs]
                : watchedFaqs;
            const faqQualityIndex =
              websiteScan && initialData
                ? initialData.faqs.length + index
                : index;
            const notCountingReason = selected
              ? faqNotCountingReason(
                  watchedFaqs[index],
                  faqQualityIndex,
                  faqQualityRows
                )
              : 'Not selected for your assistant.';

            return (
              <div key={field.id} className="p-3 border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.04] rounded-lg space-y-2">
                <input
                  type="hidden"
                  {...register(`faqs.${index}.source`)}
                />
                <div className="flex gap-2">
                  {reviewDraft?.faqs[index] && (
                    <input
                      type="checkbox"
                      checked={reviewDraft.faqs[index].selected}
                      onChange={(event) => {
                        const faqs = [...reviewDraft.faqs];
                        faqs[index] = { ...faqs[index], selected: event.target.checked };
                        setReviewDraft({ ...reviewDraft, faqs });
                      }}
                      aria-label={`Use ${watchedFaqs[index]?.question || `FAQ ${index + 1}`}`}
                      className="mt-3 h-4 w-4 shrink-0 accent-[var(--brand-primary)]"
                    />
                  )}
                  <input
                    {...register(`faqs.${index}.question`)}
                    maxLength={300}
                    placeholder="Question"
                    aria-describedby={`faq-${index}-quality`}
                    className="flex-1 px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] focus:border-[var(--brand-primary)] dark:focus:border-[var(--brand-primary-dark)] text-sm"
                  />
                  {!reviewDraft?.faqs[index] && <button
                    type="button"
                    onClick={() => removeFaqRow(index)}
                    aria-label={`Remove FAQ ${index + 1}`}
                    className="text-red-400 dark:text-red-400/70 hover:text-red-600 dark:hover:text-red-400 px-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>}
                </div>
                <textarea
                  {...register(`faqs.${index}.answer`)}
                  placeholder="Answer"
                  rows={2}
                  maxLength={FAQ_ANSWER_MAX_LENGTH}
                  aria-describedby={`faq-${index}-quality`}
                  className="w-full px-3 py-2 border border-[#e3dacc] dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] focus:border-[var(--brand-primary)] dark:focus:border-[var(--brand-primary-dark)] text-sm resize-none"
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
                {reviewDraft?.faqs[index]?.changeType && reviewDraft.faqs[index].changeType !== 'new' && (
                  <span className="text-xs font-medium text-stone-500">
                    {reviewDraft.faqs[index].changeType === 'changed' ? 'Website suggests an update' : 'Already approved'}
                  </span>
                )}
                <SourceEvidence evidence={reviewDraft?.faqs[index]?.evidence} />
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
          className="mt-3 text-sm text-[var(--brand-accent)] hover:text-[var(--brand-primary-active)] dark:text-[var(--brand-accent-dark)] dark:hover:text-[var(--brand-primary-soft-dark)] font-medium"
        >
          + Add FAQ
        </button>
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
      )}

      <div className="flex justify-between pt-4">
        <div className="flex flex-wrap items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className={secondaryCtaClass}>
              Back
            </button>
          )}
          {websiteScan && onDiscardScan && (
            <button
              type="button"
              onClick={discardScan}
              disabled={discarding || saving}
              className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
            >
              {discarding ? 'Discarding…' : 'Discard this scan'}
            </button>
          )}
        </div>
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
            mode === 'settings' ? 'Approve & publish' : 'Approve & continue'
          )}
        </button>
      </div>
    </form>
  );
}
