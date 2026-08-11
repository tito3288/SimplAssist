'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Phone, RefreshCcw, AlertTriangle } from 'lucide-react';
import StepProgress from '@/components/onboarding/StepProgress';
import BusinessInfoForm, { type ScrapedData } from '@/components/onboarding/BusinessInfoForm';
import BusinessHoursForm from '@/components/onboarding/BusinessHoursForm';
import ServicesAndFaqsForm from '@/components/onboarding/ServicesAndFaqsForm';
import AIPersonalityForm from '@/components/onboarding/AIPersonalityForm';
import BrandVerificationForm from '@/components/onboarding/BrandVerificationForm';
import SmsUseCaseForm from '@/components/onboarding/SmsUseCaseForm';
import ReviewAndLaunch from '@/components/onboarding/ReviewAndLaunch';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';
import { useBrand } from '@/components/branding/BrandProvider';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_LABELS,
  onboardingStepNumber,
  type OnboardingState,
  type OnboardingStep,
} from '@/lib/onboarding/types';
import {
  inferRejectionStep,
  isRejectionRetryBlocked,
  mapReasonToFriendly,
  type RejectionKind,
} from '@/lib/onboarding/rejectionGuidance';
import { supportHref } from '@/lib/support/constants';
import { tile, statusWarning } from '@/lib/theme-v2/theme';
import { evaluateContentQuality } from '@/lib/contentQuality';
import { replaceDefaultBrandName } from '@/lib/branding/presentation';
import type { BusinessType } from '@/types/database';
import { completeGoalSaveNavigation } from '@/lib/goals/primaryGoal';

type StateResponse = {
  state?: OnboardingState;
  error?: string;
};

export default function OnboardingPage() {
  const brand = useBrand();
  const router = useRouter();
  const searchParams = useSearchParams();
  const finalizedSessionRef = useRef<string | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingStep>('business_info');
  const [loading, setLoading] = useState(true);
  const [finalizingCheckout, setFinalizingCheckout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Website-scan results carried from Business Info to the Hours and
  // Services & FAQs steps so they can pre-fill editable fields. Convenience
  // only — never saved or submitted on their own, and saved DB data always
  // wins.
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);

  const loadState = useCallback(async (options: { keepStep?: boolean } = {}) => {
    setLoadError(null);
    let response: Response;
    try {
      response = await fetch('/api/onboarding/state', { cache: 'no-store' });
    } catch {
      setLoadError('Could not load your setup progress.');
      return null;
    }

    const payload = (await response.json().catch(() => ({}))) as StateResponse;

    if (!response.ok || !payload.state) {
      setLoadError(payload.error ?? 'Could not load your setup progress.');
      return null;
    }

    setState(payload.state);
    if (!options.keepStep) {
      setStep(payload.state.currentStep === 'complete' ? 'carrier_review' : payload.state.currentStep);
    }
    return payload.state;
  }, []);

  const refreshState = useCallback(async (options: { keepStep?: boolean } = {}) => {
    setRefreshing(true);
    try {
      return await loadState(options);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadState]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  useEffect(() => {
    const checkout = searchParams.get('checkout');
    const sessionId = searchParams.get('session_id');
    if (
      checkout !== 'success' ||
      !sessionId ||
      finalizingCheckout ||
      finalizedSessionRef.current === sessionId
    ) {
      return;
    }

    finalizedSessionRef.current = sessionId;
    setFinalizingCheckout(true);
    fetch('/api/billing/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as StateResponse;
        if (payload.state) {
          setState(payload.state);
          setStep(payload.state.currentStep === 'complete' ? 'carrier_review' : payload.state.currentStep);
        } else {
          await refreshState();
        }
        router.replace('/onboarding');
      })
      .catch(() => {
        setLoadError('Checkout succeeded, but we could not finish setup automatically. Please refresh to continue.');
      })
      .finally(() => {
        setFinalizingCheckout(false);
      });
  }, [finalizingCheckout, refreshState, router, searchParams]);

  useEffect(() => {
    if (state?.dashboardReady && state.currentStep === 'complete') {
      router.prefetch('/dashboard');
    }
  }, [router, state]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-12">
        <PulsingDot />
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">Loading your setup...</p>
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="space-y-4 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
        <p className="text-sm text-red-600 dark:text-red-400">
          {replaceDefaultBrandName(
            loadError ?? 'Could not load your setup progress.',
            brand.name
          )}
        </p>
        <Button type="button" onClick={() => refreshState()}>
          Try again
        </Button>
      </div>
    );
  }

  const currentStepNumber = onboardingStepNumber(step);
  const contentQuality = evaluateContentQuality(state.servicesAndFaqs);

  return (
    <div>
      <StepProgress currentStep={currentStepNumber} />
      <ProgressNote state={state} refreshing={refreshing || finalizingCheckout} step={step} />

      <div className="transition-opacity duration-200">
        {step === 'business_info' && (
          <BusinessInfoForm
            businessId={state.businessId}
            initialData={state.businessInfo}
            onNext={(data, scraped) => {
              // Only a fresh scan updates the captured result. BusinessInfoForm
              // remounts with null scrapedData on back-navigation, so guarding
              // here keeps an earlier scan's prefill from being wiped when the
              // customer returns and continues without re-scanning.
              if (scraped) setScrapedData(scraped);
              setState((current) =>
                current
                  ? {
                      ...current,
                      businessInfo: { ...current.businessInfo, ...data },
                    }
                  : current
              );
              setStep(nextStepOf(step));
              refreshState({ keepStep: true });
            }}
          />
        )}

        {step === 'business_hours' && (
          <BusinessHoursForm
            businessId={state.businessId}
            initialData={state.businessHours.length > 0 ? state.businessHours : undefined}
            scannedData={scrapedData?.business_hours}
            onNext={(hours) => {
              setState((current) =>
                current
                  ? {
                      ...current,
                      businessHours: hours.map((row) => ({ ...row })),
                    }
                  : current
              );
              setStep(nextStepOf(step));
              refreshState({ keepStep: true });
            }}
            onBack={() => setStep('business_info')}
          />
        )}

        {step === 'services_faqs' && (
          <ServicesAndFaqsForm
            businessId={state.businessId}
            businessType={(state.businessInfo.business_type || 'general') as BusinessType}
            initialData={
              state.servicesAndFaqs.services.length > 0 ||
              state.servicesAndFaqs.faqs.length > 0
                ? state.servicesAndFaqs
                : undefined
            }
            scrapedServices={scrapedData?.services?.map((service) => ({
              name: service.name,
              description: service.description ?? undefined,
              price: service.price ?? undefined,
            }))}
            scrapedFaqs={scrapedData?.faqs}
            onNext={(data) => {
              setState((current) =>
                current
                  ? {
                      ...current,
                      servicesAndFaqs: {
                        services: data.services.map((row) => ({ ...row })),
                        faqs: data.faqs.map((row) => ({ ...row })),
                      },
                    }
                  : current
              );
              setStep(nextStepOf(step));
              refreshState({ keepStep: true });
            }}
            onBack={() => setStep('business_hours')}
          />
        )}

        {step === 'ai_settings' && (
          <AIPersonalityForm
            businessId={state.businessId}
            businessName={state.businessInfo.name || 'Your Business'}
            initialPrimaryGoal={state.primaryGoal}
            initialGoalUrl={state.goalUrl}
            initialData={state.aiSettings || undefined}
            onNext={() =>
              completeGoalSaveNavigation({
                refreshState,
                replace: (href) => router.replace(href),
                setStep,
              })
            }
            onBack={() => setStep('services_faqs')}
          />
        )}

        {step === 'legal_verification' && (
          <BrandVerificationForm
            businessId={state.businessId}
            initialData={state.brandVerification || undefined}
            onNext={() => { setStep(nextStepOf(step)); refreshState({ keepStep: true }); }}
            onBack={() => setStep('ai_settings')}
          />
        )}

        {step === 'sms_use_case' && (
          <div className="space-y-4">
            {state.registration.status === 'failed' && state.registration.error && (
              <div className={`rounded-[18px] px-4 py-3 text-sm ${statusWarning}`}>
                {replaceDefaultBrandName(
                  state.registration.error,
                  brand.name
                )}
              </div>
            )}
            <SmsUseCaseForm
              businessId={state.businessId}
              businessName={state.businessInfo.name || 'Your Business'}
              businessType={(state.businessInfo.business_type || 'general') as BusinessType}
              businessTypeOther={state.businessInfo.business_type_other}
              language={state.aiSettings?.language ?? 'en'}
              services={state.servicesAndFaqs.services}
              riskReview={state.registration.riskReview}
              initialData={state.brandVerification}
              onNext={() => { setStep(nextStepOf(step)); refreshState({ keepStep: true }); }}
              onBack={() => setStep('legal_verification')}
            />
          </div>
        )}

        {step === 'phone_number' && (
          <PhoneNumberStep
            state={state}
            onBack={() => setStep('sms_use_case')}
            onPurchased={() => refreshState()}
            onNext={() => { setStep(nextStepOf(step)); refreshState({ keepStep: true }); }}
          />
        )}

        {step === 'review_submit' && (
          <ReviewAndLaunch
            data={{
              businessInfo: state.businessInfo,
              businessHours: state.businessHours,
              servicesCount: contentQuality.validServiceCount,
              faqsCount: contentQuality.validFaqCount,
              aiSettings: state.aiSettings ?? {
                tone: 'balanced',
                business_voice: 'we',
                language: 'en',
                response_delay_seconds: 5,
                web_greeting: '',
                booking_enabled: false,
                booking_mode: 'collect_info',
              },
              phoneNumber: state.phoneNumber,
              brandVerification: state.brandVerification,
            }}
            billing={state.billing}
            registration={state.registration}
            pendingPhoneNumberFailureReason={state.pendingPhoneNumberFailureReason}
            onEditStep={(targetStep) => setStep(numberToStep(targetStep))}
            onBack={() => setStep('phone_number')}
            onSubmitted={(nextState) => {
              if (nextState) setState(nextState);
              setStep('carrier_review');
              refreshState({ keepStep: true });
            }}
            onLaunchBlocked={(nextState) => {
              if (!nextState) return;
              setState(nextState);
              setStep(nextState.currentStep === 'complete' ? 'carrier_review' : nextState.currentStep);
            }}
          />
        )}

        {step === 'carrier_review' && (
          <CarrierReviewStatus
            state={state}
            onStatusRefreshed={(nextState) => {
              setState(nextState);
              setStep('carrier_review');
            }}
            onRetry={(nextState) => {
              if (nextState) {
                setState(nextState);
                setStep(
                  nextState.currentStep === 'complete'
                    ? 'carrier_review'
                    : nextState.currentStep
                );
                return;
              }
              refreshState();
            }}
            onDashboard={() => router.push('/dashboard')}
            onFixStep={(targetStep) => setStep(targetStep)}
          />
        )}
      </div>
    </div>
  );
}

function ProgressNote({
  state,
  refreshing,
  step,
}: {
  state: OnboardingState;
  refreshing: boolean;
  step: OnboardingStep;
}) {
  const savedAt = state.lastSavedAt
    ? new Date(state.lastSavedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="mb-5 rounded-[18px] border border-[#ede5d9] bg-[#faf7f2] px-4 py-3 text-sm text-stone-600 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#bdbdbf]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {savedAt
            ? `Your progress is saved. Last saved at ${savedAt}.`
            : 'This step saves when you continue.'}
        </span>
        <span className="inline-flex items-center gap-2 text-xs text-stone-500 dark:text-[#888]">
          {refreshing && <PulsingDot inline />}
          Continue setup: {ONBOARDING_STEP_LABELS[step]}
        </span>
      </div>
    </div>
  );
}

function PhoneNumberStep({
  state,
  onBack,
  onPurchased,
  onNext,
}: {
  state: OnboardingState;
  onBack: () => void;
  onPurchased: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--brand-accent-soft)] dark:bg-transparent dark:bg-[linear-gradient(135deg,rgb(var(--brand-primary-dark-rgb)/.22),rgba(255,255,255,.08))] border border-[var(--brand-accent-soft-border)] dark:border-white/[0.10] mb-4">
          <Phone className="w-6 h-6 text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]" />
        </div>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">Choose a phone number for your AI assistant</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-[#bdbdbf]">
          Customers can call or text this number. SMS activates after carrier approval.
        </p>
      </div>

      <PhoneNumberSelector
        initialPhoneNumber={state.phoneNumber}
        initialConsentAgreed={state.smsConsentAgreed}
        initialFailureReason={state.pendingPhoneNumberFailureReason}
        onNumberPurchased={onPurchased}
      />

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="py-2 px-6 border border-[#e7e0d4] dark:border-white/[0.12] text-stone-700 dark:text-[#bdbdbf] font-medium rounded-full hover:bg-[#faf6ef] dark:hover:bg-white/[0.06] transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!state.phoneNumber}
          className="py-2 px-6 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-active)] dark:bg-[var(--brand-primary-dark)] dark:text-[#16100b] dark:hover:bg-[var(--brand-primary-hover-dark)] text-white font-medium rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// A real anchor (to the /support hub) styled to match Button's
// primary/secondary variants — this is a navigation, not an action, so a
// link beats a scripted button.
const SUPPORT_LINK_BASE =
  'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--brand-primary)] dark:focus:ring-[var(--brand-primary-dark)]';
const SUPPORT_LINK_PRIMARY =
  'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-active)] dark:bg-[var(--brand-primary-dark)] dark:text-[#16100b] dark:hover:bg-[var(--brand-primary-hover-dark)]';
const SUPPORT_LINK_SECONDARY =
  'bg-white text-stone-700 border border-[#e7e0d4] hover:bg-[#faf6ef] hover:border-[#d9d0c1] dark:bg-white/[0.07] dark:text-white dark:border-white/[0.12] dark:hover:bg-white/[0.11]';

function CarrierReviewStatus({
  state,
  onStatusRefreshed,
  onRetry,
  onDashboard,
  onFixStep,
}: {
  state: OnboardingState;
  onStatusRefreshed: (state: OnboardingState) => void;
  onRetry: (state: OnboardingState | null) => void;
  onDashboard: () => void;
  onFixStep: (step: OnboardingStep) => void;
}) {
  const brand = useBrand();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [statusRefreshError, setStatusRefreshError] = useState<string | null>(
    null
  );
  const [statusRefreshNotice, setStatusRefreshNotice] = useState<string | null>(
    null
  );
  const operationInFlightRef = useRef<'retry' | 'refresh' | null>(null);
  const registration = state.registration;

  // Carrier rejection with a retryable status: offer a routed edit path.
  // Best-effort keyword inference; the full raw reason stays visible below
  // regardless of where we route.
  const rejectionKind: RejectionKind | null =
    registration.brandStatus === 'rejected'
      ? 'brand'
      : registration.campaignStatus === 'rejected'
        ? 'campaign'
        : null;
  // Only the carrier's own words feed classification and the friendly copy:
  // registration.error can hold newer internal messages (risk holds, submit
  // failures) that must never be diagnosed or labeled as carrier wording.
  const carrierReason = rejectionKind
    ? rejectionKind === 'brand'
      ? registration.brandRejectionReason
      : registration.campaignRejectionReason
    : null;
  // Mirrors the server's stale-submitting claim window
  // (registrationAttempt.ts): a pipeline that died mid-claim strands the row
  // in 'submitting' with no webhook coming, but it is claimable again — so
  // Retry must be offered here or the customer is stuck on Refresh forever.
  const staleSubmitting =
    registration.status === 'submitting' &&
    (!registration.startedAt ||
      Date.now() - new Date(registration.startedAt).getTime() > 15 * 60 * 1000);
  // A rejection stays actionable in the 'submitted' state too. Before brand
  // recovery shipped, a retry after a brand rejection re-submitted without
  // re-filing the brand, stranding rows on submitted + brand_status
  // 'rejected' with no webhook ever coming. The pipeline now archives and
  // re-files rejected brands (archiveAndClearRejectedBrand), so that state
  // can no longer be produced — but pre-recovery rows can still sit in it
  // until the one-time backfill moves them to 'failed', so keep the
  // fix/support controls there (Retry itself is only offered where a claim
  // can succeed — 'failed' or stale 'submitting' — and never for carrier
  // rejections of either kind; see retryBlocked below).
  const rejectionActionable =
    rejectionKind !== null &&
    !registration.smsReady &&
    (registration.status === 'failed' ||
      registration.status === 'submitted' ||
      staleSubmitting);
  // The registration forms are locked server-side (a 409 from the brand-
  // verification and sms-use-case routes) whenever a submitted registration
  // is still with the carrier — only the 'failed' state stays editable, the
  // designed retry-recovery path. This mirrors that guard exactly
  // (riskReview.registrationStarted is the same predicate the API uses), so
  // we never route to a fix form the save would reject: offer it only where
  // the form is open; the locked states rely on support (and Retry where a
  // claim can succeed).
  const formsLocked =
    registration.riskReview.registrationStarted &&
    registration.status !== 'failed';
  const fixStep =
    rejectionActionable && rejectionKind && !formsLocked
      ? inferRejectionStep(rejectionKind, carrierReason)
      : null;
  const friendlyReason = rejectionKind
    ? mapReasonToFriendly(rejectionKind, carrierReason)
    : null;
  // Every friendly explanation assumes the customer can edit something to fix
  // it ("resubmit", "update your details"). While the forms are locked none
  // of that is possible, so drop it and let the banner fall to its honest
  // "carrier's wording + contact support" branch — the lock notice above
  // already explains why editing is closed.
  const displayFriendlyReason = formsLocked ? null : friendlyReason;
  // Carrier rejections never offer Retry: a blind retry resubmits unchanged
  // data and every resubmission costs money — a campaign rejection recreates
  // the campaign (new review fee + upfront monthly charges) and deactivating
  // it destroys the Mission Control appeal option; a brand rejection
  // re-files the brand AND rebuilds its campaign, same campaign charges on
  // top. The recovery paths are Fix & resubmit (edit, then resubmit through
  // Review & Submit once something actually changed) and support. Retry
  // survives only for technical failures — nothing was rejected, nothing
  // gets recreated, resubmitting is free.
  const retryBlocked = isRejectionRetryBlocked(
    registration.brandStatus,
    registration.campaignStatus
  );
  // With Retry withheld on every rejection, support is the guaranteed
  // action: whatever the class, the customer can always reach us. Fix &
  // resubmit still renders alongside where the rejection maps to a form the
  // customer owns.
  const needsSupport = rejectionActionable;
  const supportLink = supportHref('number_registration');
  // When both brand and campaign are rejected, brand wins the headline slot;
  // the campaign's own carrier verdict still has to stay visible.
  const secondaryCarrierReason =
    rejectionKind === 'brand' &&
    registration.campaignStatus === 'rejected' &&
    registration.campaignRejectionReason &&
    registration.campaignRejectionReason !== carrierReason
      ? registration.campaignRejectionReason
      : null;
  // The webhook usually copies the rejection reason into registration.error,
  // and a failed retry returns the same message it persists; render each
  // distinct string once.
  const extraError =
    registration.error &&
    registration.error !== carrierReason &&
    registration.error !== retryError &&
    registration.error !== secondaryCarrierReason
      ? registration.error
      : null;
  const assignmentNote =
    registration.assignmentFailureReason &&
    registration.assignmentFailureReason !== registration.error &&
    registration.assignmentFailureReason !== retryError
      ? registration.assignmentFailureReason
      : null;
  const title = registration.smsReady
    ? 'SMS is active'
    : registration.holdReason === 'held_no_ein'
      ? 'Add your EIN to continue'
    : registration.brandStatus === 'rejected' || registration.campaignStatus === 'rejected'
      ? 'We need to update your registration'
      : registration.status === 'failed'
        ? 'Registration needs another try'
        : 'Carrier review is underway';

  const copy = statusCopy(state);

  async function handleRetry() {
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = 'retry';
    setRetrying(true);
    setRetryError(null);
    setStatusRefreshError(null);
    setStatusRefreshNotice(null);
    try {
      const response = await fetch('/api/onboarding/retry-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: state.businessId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        state?: OnboardingState;
      };

      if (!response.ok) {
        setRetryError(payload.error ?? 'Could not retry registration right now.');
        onRetry(payload.state ?? null);
        return;
      }

      onRetry(payload.state ?? null);
    } catch {
      setRetryError('Could not retry registration right now.');
    } finally {
      operationInFlightRef.current = null;
      setRetrying(false);
    }
  }

  async function handleStatusRefresh() {
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = 'refresh';
    setStatusRefreshing(true);
    setStatusRefreshError(null);
    setStatusRefreshNotice(null);
    setRetryError(null);

    try {
      const response = await fetch('/api/onboarding/refresh-status', {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        state?: OnboardingState;
      };

      if (payload.state) {
        onStatusRefreshed(payload.state);
      }

      if (!response.ok) {
        setStatusRefreshError(
          payload.error ?? 'Could not refresh carrier status right now.'
        );
        return;
      }

      setStatusRefreshNotice(
        payload.message ?? 'Carrier status is already up to date.'
      );
    } catch {
      setStatusRefreshError('Could not refresh carrier status right now.');
    } finally {
      operationInFlightRef.current = null;
      setStatusRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--brand-accent-soft-border)] bg-[var(--brand-accent-soft)] dark:border-white/[0.10] dark:bg-[linear-gradient(135deg,rgb(var(--brand-primary-dark-rgb)/.22),rgba(255,255,255,.08))]">
          {registration.smsReady ? (
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          ) : registration.status === 'failed' || registration.brandStatus === 'rejected' || registration.campaignStatus === 'rejected' ? (
            <AlertTriangle className="h-6 w-6 text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]" />
          ) : (
            <Clock className="h-6 w-6 text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]" />
          )}
        </div>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">{title}</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-[#bdbdbf]">{copy}</p>
        {registration.riskReview.registrationStarted &&
          registration.status !== 'failed' &&
          !registration.smsReady && (
            <p className="mt-2 text-sm text-stone-500 dark:text-[#bdbdbf]">
              Business and compliance details are locked until review completes.{' '}
              <a href={supportLink} className="font-medium underline">
                Contact support
              </a>{' '}
              if you need to change them.
            </p>
          )}
      </div>

      <div className={`space-y-3 p-4 ${tile}`}>
        <StatusLine label="Business verification" value={registration.brandStatus ?? 'not submitted'} />
        <StatusLine label="SMS campaign" value={registration.campaignStatus ?? 'not submitted'} />
        <StatusLine label="Phone number link" value={registration.assignmentStatus ?? 'not assigned'} />
        <StatusLine label="SMS sending" value={registration.smsReady ? 'active' : 'paused'} />
      </div>

      {(retryError || (rejectionKind && carrierReason) || secondaryCarrierReason || extraError || assignmentNote) && (
        <div className={`space-y-2 rounded-[18px] px-4 py-3 text-sm ${statusWarning}`}>
          {retryError && (
            <p>{replaceDefaultBrandName(retryError, brand.name)}</p>
          )}
          {rejectionKind && carrierReason && (
            displayFriendlyReason ? (
              <>
                <p>{displayFriendlyReason}</p>
                <p className="text-xs">
                  Carrier&apos;s exact wording: {carrierReason}
                </p>
              </>
            ) : (
              <>
                <p>{carrierReason}</p>
                <p className="text-xs">
                  Not sure what this means?{' '}
                  <a href={supportLink} className="font-medium underline">
                    Contact support
                  </a>{' '}
                  and we&apos;ll help you sort it out.
                </p>
              </>
            )
          )}
          {secondaryCarrierReason && (
            // Self-contained label (no "also"): in some reachable states this
            // is the banner's only line. Small print only under a headline.
            <p className={rejectionKind && carrierReason ? 'text-xs' : undefined}>
              SMS campaign rejection: {secondaryCarrierReason}
            </p>
          )}
          {extraError && (
            <p>{replaceDefaultBrandName(extraError, brand.name)}</p>
          )}
          {assignmentNote && (
            <p>{replaceDefaultBrandName(assignmentNote, brand.name)}</p>
          )}
        </div>
      )}

      {statusRefreshError && (
        <div
          role="alert"
          className={`rounded-[18px] px-4 py-3 text-sm ${statusWarning}`}
        >
          {replaceDefaultBrandName(statusRefreshError, brand.name)}
        </div>
      )}

      {statusRefreshNotice && (
        <p
          role="status"
          className="text-sm text-stone-600 dark:text-[#bdbdbf]"
        >
          {replaceDefaultBrandName(statusRefreshNotice, brand.name)}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={handleStatusRefresh}
          loading={statusRefreshing}
          disabled={retrying}
          aria-busy={statusRefreshing}
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh status
        </Button>
        {registration.smsReady ? (
          <Button type="button" onClick={onDashboard}>
            Go to dashboard
          </Button>
        ) : registration.holdReason === 'held_no_ein' ? null : registration.status === 'failed' ||
          staleSubmitting ||
          fixStep ||
          needsSupport ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            {fixStep && (
              <Button type="button" onClick={() => onFixStep(fixStep)}>
                {/* fixStep is gated to the unlocked 'failed' state, so this
                    always leads to a form the save will accept. */}
                Fix &amp; resubmit
              </Button>
            )}
            {needsSupport && (
              <a
                href={supportLink}
                className={`${SUPPORT_LINK_BASE} ${fixStep ? SUPPORT_LINK_SECONDARY : SUPPORT_LINK_PRIMARY}`}
              >
                Contact support
              </a>
            )}
            {(registration.status === 'failed' || staleSubmitting) &&
              !retryBlocked && (
              <Button
                type="button"
                variant={fixStep || needsSupport ? 'secondary' : 'primary'}
                onClick={handleRetry}
                loading={retrying}
                disabled={statusRefreshing}
                aria-busy={retrying}
              >
                Retry registration
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  const normalized = value.replace(/_/g, ' ');
  const variant: 'success' | 'warning' | 'error' | 'default' =
    value === 'approved' || value === 'assigned' || value === 'active'
      ? 'success'
      : value === 'rejected' || value === 'failed'
        ? 'error'
        : value === 'pending' || value === 'submitting'
          ? 'warning'
          : 'default';

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-stone-600 dark:text-[#bdbdbf]">{label}</span>
      <Badge variant={variant}>{normalized}</Badge>
    </div>
  );
}

function statusCopy(state: OnboardingState): string {
  const registration = state.registration;

  if (registration.smsReady) {
    return 'Your number is approved and linked. Your AI assistant can now send and reply to customer texts.';
  }

  if (registration.holdReason === 'held_no_ein') {
    return 'SMS setup is paused until you add an EIN in Business Verification.';
  }

  // Rejection copy outranks the generic failed copy: carrier rejections also
  // set status to 'failed' (webhook mapping), and "something interrupted the
  // submit" would misdescribe a rejection.
  if (registration.brandStatus === 'rejected') {
    return 'Carriers need updated business verification details before SMS can continue.';
  }

  if (registration.campaignStatus === 'rejected') {
    return 'Carriers need updated SMS campaign details before SMS can continue.';
  }

  if (registration.status === 'failed') {
    return 'Something interrupted the registration submit. Any saved carrier IDs will be reused when you retry.';
  }

  if (registration.campaignStatus === 'approved' && registration.assignmentStatus !== 'assigned') {
    return 'Your campaign is approved. Telnyx is linking your phone number before SMS can go live.';
  }

  if (registration.brandStatus === 'approved') {
    return 'Business verification is approved. Your SMS campaign is now waiting on carrier review.';
  }

  return 'Business verification can take hours to a couple of days. We will keep this page updated as carriers respond.';
}

/**
 * Successor in the canonical wizard order, clamped at the final step.
 * Used by plain Next so the UI advances exactly one step; the server-derived
 * resume position applies only on load and after Stripe/purchase snaps
 * (docs/onboarding-resume-position-bug.md).
 */
function nextStepOf(step: OnboardingStep): OnboardingStep {
  const idx = ONBOARDING_STEPS.indexOf(step);
  if (idx === -1) return step;
  return ONBOARDING_STEPS[Math.min(idx + 1, ONBOARDING_STEPS.length - 1)];
}

function numberToStep(step: number): OnboardingStep {
  switch (step) {
    case 1:
      return 'business_info';
    case 2:
      return 'business_hours';
    case 3:
      return 'services_faqs';
    case 4:
      return 'ai_settings';
    case 5:
      return 'legal_verification';
    case 6:
      return 'sms_use_case';
    case 7:
      return 'phone_number';
    case 8:
      return 'review_submit';
    default:
      return 'carrier_review';
  }
}
