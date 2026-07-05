'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock, Phone, RefreshCcw, AlertTriangle } from 'lucide-react';
import StepProgress from '@/components/onboarding/StepProgress';
import BusinessInfoForm from '@/components/onboarding/BusinessInfoForm';
import BusinessHoursForm from '@/components/onboarding/BusinessHoursForm';
import ServicesAndFaqsForm from '@/components/onboarding/ServicesAndFaqsForm';
import AIPersonalityForm from '@/components/onboarding/AIPersonalityForm';
import BrandVerificationForm from '@/components/onboarding/BrandVerificationForm';
import SmsUseCaseForm from '@/components/onboarding/SmsUseCaseForm';
import ReviewAndLaunch from '@/components/onboarding/ReviewAndLaunch';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  ONBOARDING_STEP_LABELS,
  onboardingStepNumber,
  type OnboardingState,
  type OnboardingStep,
} from '@/lib/onboarding/types';
import type { BusinessType } from '@/types/database';

type StateResponse = {
  state?: OnboardingState;
  error?: string;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingStep>('business_info');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    if (state?.dashboardReady && state.currentStep === 'complete') {
      router.prefetch('/dashboard');
    }
  }, [router, state]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-12">
        <PulsingDot />
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">Loading your setup...</p>
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="space-y-4 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
        <p className="text-sm text-red-600 dark:text-red-400">
          {loadError ?? 'Could not load your setup progress.'}
        </p>
        <Button type="button" onClick={() => refreshState()}>
          Try again
        </Button>
      </div>
    );
  }

  const currentStepNumber = onboardingStepNumber(step);

  return (
    <div>
      <StepProgress currentStep={currentStepNumber} />
      <ProgressNote state={state} refreshing={refreshing} step={step} />

      <div className="transition-opacity duration-200">
        {step === 'business_info' && (
          <BusinessInfoForm
            businessId={state.businessId}
            initialData={state.businessInfo}
            onNext={() => refreshState()}
          />
        )}

        {step === 'business_hours' && (
          <BusinessHoursForm
            businessId={state.businessId}
            initialData={state.businessHours.length > 0 ? state.businessHours : undefined}
            onNext={() => refreshState()}
            onBack={() => setStep('business_info')}
          />
        )}

        {step === 'services_faqs' && (
          <ServicesAndFaqsForm
            businessId={state.businessId}
            businessType={(state.businessInfo.business_type || 'general') as BusinessType}
            initialData={state.servicesAndFaqs.services.length > 0 ? state.servicesAndFaqs : undefined}
            onNext={() => refreshState()}
            onBack={() => setStep('business_hours')}
          />
        )}

        {step === 'ai_settings' && (
          <AIPersonalityForm
            businessId={state.businessId}
            businessName={state.businessInfo.name || 'Your Business'}
            initialData={state.aiSettings || undefined}
            onNext={() => refreshState()}
            onBack={() => setStep('services_faqs')}
          />
        )}

        {step === 'legal_verification' && (
          <BrandVerificationForm
            businessId={state.businessId}
            initialData={state.brandVerification || undefined}
            onNext={() => refreshState()}
            onBack={() => setStep('ai_settings')}
          />
        )}

        {step === 'sms_use_case' && (
          <SmsUseCaseForm
            businessId={state.businessId}
            initialData={state.brandVerification}
            onNext={() => refreshState()}
            onBack={() => setStep('legal_verification')}
          />
        )}

        {step === 'phone_number' && (
          <PhoneNumberStep
            state={state}
            onBack={() => setStep('sms_use_case')}
            onPurchased={() => refreshState()}
            onNext={() => refreshState()}
          />
        )}

        {step === 'review_submit' && (
          <ReviewAndLaunch
            data={{
              businessInfo: state.businessInfo,
              businessHours: state.businessHours,
              servicesCount: state.servicesAndFaqs.services.length,
              faqsCount: state.servicesAndFaqs.faqs.length,
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
            onEditStep={(targetStep) => setStep(numberToStep(targetStep))}
            onBack={() => setStep('phone_number')}
            onSubmitted={(nextState) => {
              if (nextState) setState(nextState);
              setStep('carrier_review');
              refreshState({ keepStep: true });
            }}
          />
        )}

        {step === 'carrier_review' && (
          <CarrierReviewStatus
            state={state}
            onRefresh={() => refreshState({ keepStep: true })}
            onRetry={(nextState) => {
              if (nextState) setState(nextState);
              refreshState({ keepStep: true });
            }}
            onDashboard={() => router.push('/dashboard')}
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
    <div className="mb-5 rounded-[18px] border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#bdbdbf]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {savedAt
            ? `Your progress is saved. Last saved at ${savedAt}.`
            : 'This step saves when you continue.'}
        </span>
        <span className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-[#888]">
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
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-100 dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(255,145,77,.22),rgba(255,255,255,.08))] border border-orange-200 dark:border-white/[0.10] mb-4">
          <Phone className="w-6 h-6 text-[#ff914d]" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Choose a phone number for your AI assistant</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-[#bdbdbf]">
          Customers can call or text this number. SMS activates after carrier approval.
        </p>
      </div>

      <PhoneNumberSelector
        initialPhoneNumber={state.phoneNumber}
        initialConsentAgreed={state.smsConsentAgreed}
        onNumberPurchased={onPurchased}
      />

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="py-2 px-6 border border-slate-200 dark:border-white/[0.12] text-slate-700 dark:text-[#bdbdbf] font-medium rounded-full hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!state.phoneNumber}
          className="py-2 px-6 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] font-medium rounded-full shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 dark:hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function CarrierReviewStatus({
  state,
  onRefresh,
  onRetry,
  onDashboard,
}: {
  state: OnboardingState;
  onRefresh: () => Promise<OnboardingState | null>;
  onRetry: (state: OnboardingState | null) => void;
  onDashboard: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const registration = state.registration;
  const title = registration.smsReady
    ? 'SMS is active'
    : registration.status === 'failed'
      ? 'Registration needs another try'
      : registration.brandStatus === 'rejected' || registration.campaignStatus === 'rejected'
        ? 'We need to update your registration'
        : 'Carrier review is underway';

  const copy = statusCopy(state);

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
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
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-orange-200 bg-orange-100 dark:border-white/[0.10] dark:bg-[linear-gradient(135deg,rgba(255,145,77,.22),rgba(255,255,255,.08))]">
          {registration.smsReady ? (
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          ) : registration.status === 'failed' || registration.brandStatus === 'rejected' || registration.campaignStatus === 'rejected' ? (
            <AlertTriangle className="h-6 w-6 text-[#ff914d]" />
          ) : (
            <Clock className="h-6 w-6 text-[#ff914d]" />
          )}
        </div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">{title}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-[#bdbdbf]">{copy}</p>
      </div>

      <div className="space-y-3 rounded-[22px] border border-slate-200 bg-white/60 p-4 dark:border-white/[0.10] dark:bg-white/[0.04]">
        <StatusLine label="Business verification" value={registration.brandStatus ?? 'not submitted'} />
        <StatusLine label="SMS campaign" value={registration.campaignStatus ?? 'not submitted'} />
        <StatusLine label="Phone number link" value={registration.assignmentStatus ?? 'not assigned'} />
        <StatusLine label="SMS sending" value={registration.smsReady ? 'active' : 'paused'} />
      </div>

      {(registration.error || retryError || registration.brandRejectionReason || registration.campaignRejectionReason || registration.assignmentFailureReason) && (
        <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {retryError ?? registration.error ?? registration.brandRejectionReason ?? registration.campaignRejectionReason ?? registration.assignmentFailureReason}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="secondary" onClick={onRefresh}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh status
        </Button>
        {registration.smsReady ? (
          <Button type="button" onClick={onDashboard}>
            Go to dashboard
          </Button>
        ) : registration.status === 'failed' ? (
          <Button type="button" onClick={handleRetry} loading={retrying}>
            Retry registration
          </Button>
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
      <span className="text-sm text-slate-600 dark:text-[#bdbdbf]">{label}</span>
      <Badge variant={variant}>{normalized}</Badge>
    </div>
  );
}

function statusCopy(state: OnboardingState): string {
  const registration = state.registration;

  if (registration.smsReady) {
    return 'Your number is approved and linked. Your AI assistant can now send and reply to customer texts.';
  }

  if (registration.status === 'failed') {
    return 'Something interrupted the registration submit. Any saved carrier IDs will be reused when you retry.';
  }

  if (registration.brandStatus === 'rejected') {
    return 'Carriers need updated business verification details before SMS can continue.';
  }

  if (registration.campaignStatus === 'rejected') {
    return 'Carriers need updated SMS campaign details before SMS can continue.';
  }

  if (registration.campaignStatus === 'approved' && registration.assignmentStatus !== 'assigned') {
    return 'Your campaign is approved. Telnyx is linking your phone number before SMS can go live.';
  }

  if (registration.brandStatus === 'approved') {
    return 'Business verification is approved. Your SMS campaign is now waiting on carrier review.';
  }

  return 'Business verification can take hours to a couple of days. We will keep this page updated as carriers respond.';
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
