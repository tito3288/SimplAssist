"use client";

import { useEffect, useState } from "react";
import { PlanSelectionOption } from "@/components/onboarding/PlanSelectionOption";
import { getUsStateName } from '@/lib/usStates';
import { SETUP_FEE_CENTS, SUBSCRIPTION_PLANS } from '@/lib/stripe/config';
import {
  availablePlanOrFallback,
  paidPlanForOnboardingRetry,
} from "@/lib/billing/planAvailability";
import type { OnboardingState } from '@/lib/onboarding/types';
import type { SubscriptionPlan } from '@/types/database';
import { primaryCtaInlineClass, secondaryCtaClass } from "@/lib/glass";
import { SETUP_FEE_EXPLAINER_PATH } from "@/lib/support/constants";
import { tile, statusSuccess, statusWarning, statusDanger, statusNeutral } from "@/lib/theme-v2/theme";
import { cn } from "@/lib/utils";

const RECOMMENDED_PLAN: SubscriptionPlan = 'sms_and_chat';
const SETUP_FEE = SETUP_FEE_CENTS / 100;

interface ReviewData {
  businessInfo: {
    name: string;
    business_type: string;
    business_type_other?: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    website?: string;
  };
  businessHours: {
    day: string;
    is_closed: boolean;
    open_time: string;
    close_time: string;
  }[];
  servicesCount: number;
  faqsCount: number;
  aiSettings: {
    tone: string;
    business_voice: string;
    language: string;
    response_delay_seconds: number;
    web_greeting: string;
    booking_enabled: boolean;
    booking_mode?: string;
  };
  phoneNumber?: string | null;
  brandVerification?: {
    legal_business_name?: string;
    business_entity_type?: string | null;
    ein?: string;
    authorized_rep_name?: string;
    authorized_rep_email?: string;
    use_case_description?: string;
    estimated_monthly_volume?: string;
    sample_messages?: string[];
  } | null;
}

interface ReviewAndLaunchProps {
  data: ReviewData;
  billing: OnboardingState["billing"];
  registration: OnboardingState["registration"];
  pendingPhoneNumberFailureReason: string | null;
  onEditStep: (step: number) => void;
  onBack: () => void;
  onSubmitted: (state: OnboardingState | null) => void;
  onLaunchBlocked: (state: OnboardingState | null) => void;
}

type PaidLaunchHold = {
  message: string;
  action: "none" | "choose_number" | "add_ein" | "retry";
  buttonLabel?: string;
  helper?: string;
};

const TONE_LABELS: Record<string, string> = {
  friendly: 'Friendly & Casual',
  professional: 'Professional & Polished',
  balanced: 'Balanced',
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  both: 'English & Spanish',
};

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  plumber: 'Plumber',
  dentist: 'Dentist',
  restaurant: 'Restaurant',
  car_wash: 'Car Wash',
  salon: 'Salon',
  hvac: 'HVAC',
  auto_shop: 'Auto Shop',
  real_estate: 'Real Estate',
  legal: 'Legal Services',
  financial: 'Financial Services',
  insurance: 'Insurance',
  retail: 'Retail',
  general: 'General',
  other: 'Other',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  llc: 'LLC',
  c_corp: 'C-Corporation',
  s_corp: 'S-Corporation',
  partnership: 'Partnership',
  nonprofit: 'Nonprofit',
  sole_proprietor: 'Sole Proprietor',
};

const VOLUME_LABELS: Record<string, string> = {
  under_1k: 'Under 1,000 / month',
  '1k_10k': '1,000 - 10,000 / month',
  '10k_100k': '10,000 - 100,000 / month',
  over_100k: 'Over 100,000 / month',
};

function maskEin(ein: string): string {
  if (ein.length !== 10) return ein;
  return `${ein.slice(0, 2)}-***-${ein.slice(-4)}`;
}

export default function ReviewAndLaunch({
  data,
  billing,
  registration,
  pendingPhoneNumberFailureReason,
  onEditStep,
  onBack,
  onSubmitted,
  onLaunchBlocked,
}: ReviewAndLaunchProps) {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(
    availablePlanOrFallback(billing.plan, RECOMMENDED_PLAN)
  );
  const paidPlanKey = paidPlanForOnboardingRetry(
    billing.plan,
    billing.status
  );
  const isPaidSubscription = Boolean(paidPlanKey);
  const paidPlan = paidPlanKey ? SUBSCRIPTION_PLANS[paidPlanKey] : null;
  const launchHold = isPaidSubscription
    ? classifyPaidLaunchHold(registration, pendingPhoneNumberFailureReason)
    : null;
  const primaryButtonLabel = primaryLaunchButtonLabel({
    data,
    isPaidSubscription,
    launchHold,
    launching,
  });
  const showPrimaryButton = !launchHold || launchHold.action !== 'none';

  useEffect(() => {
    setSelectedPlan((currentPlan) =>
      availablePlanOrFallback(
        billing.plan ?? currentPlan,
        RECOMMENDED_PLAN
      )
    );
  }, [billing.plan]);

  const handleLaunch = async () => {
    setError(null);

    if (!data.phoneNumber) {
      onEditStep(7);
      return;
    }

    setLaunching(true);

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: paidPlanKey ?? selectedPlan, mode: 'onboarding' }),
      });
      const response = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        code?: string;
        inProgress?: boolean;
        state?: OnboardingState | null;
        url?: string;
      };

      if (!res.ok) {
        setError(response.error || 'Could not start checkout right now.');
        if (response.state) {
          onLaunchBlocked(response.state);
        }
        return;
      }

      if (response.success) {
        onSubmitted(response.state ?? null);
        return;
      }

      if (response.url) {
        window.location.href = response.url;
        return;
      }

      setError('Could not start checkout right now.');
    } catch {
      setError('Could not start checkout right now.');
    } finally {
      setLaunching(false);
    }
  };

  const formatTime = (time: string) => {
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
          {isPaidSubscription ? 'Review & Setup Status' : 'Review & Pay'}
        </h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">
          {isPaidSubscription
            ? 'Payment is complete. We will finish SMS setup from here without charging you again.'
            : 'Choose your plan and pay before we submit your SMS registration for carrier review.'}
        </p>
      </div>

      <Section title={isPaidSubscription ? 'Paid Plan' : 'Plan & Setup Fee'}>
        {isPaidSubscription && paidPlan ? (
          <div className="space-y-3">
            <div className={cn("rounded-lg p-3 text-sm", statusSuccess)}>
              <p className="font-medium">{paidPlan.name}</p>
              <p className="mt-1">
                ${paidPlan.price}/month · {paidPlan.includedSmsParts.toLocaleString()} included SMS parts/month
              </p>
              <p className="mt-1 text-xs">
                Status: {billing.status}. Setup fee {billing.setupFeePaidAt ? 'paid' : 'not recorded'}.
              </p>
            </div>
            {launchHold && (
              <div className={cn("rounded-lg p-3 text-sm", statusWarning)}>
                <p className="font-medium">SMS setup is paused</p>
                <p className="mt-1">{launchHold.message}</p>
                {launchHold.helper && (
                  <p className="mt-2 text-xs">{launchHold.helper}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <fieldset className="space-y-3">
              <legend className="sr-only">Choose a SimplAssist plan</legend>

              {(Object.entries(SUBSCRIPTION_PLANS) as [SubscriptionPlan, (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan]][]).map(([key, plan]) => {
                const selected = selectedPlan === key;
                const recommended = key === RECOMMENDED_PLAN;

                return (
                  <PlanSelectionOption
                    key={key}
                    inputName="subscription-plan"
                    planKey={key}
                    plan={plan}
                    selected={selected}
                    recommended={recommended}
                    onSelect={setSelectedPlan}
                  />
                );
              })}
            </fieldset>
            <div className={cn("rounded-[16px] p-3 text-xs", statusNeutral)}>
              <p className="font-medium text-stone-800 dark:text-[#f5f5f5]">${SETUP_FEE} one-time setup and SMS activation fee</p>
              <p className="mt-1 leading-relaxed">
                This covers your business&apos;s registration with AT&amp;T, T-Mobile, Verizon, Cricket, Metro, Visible, Mint, Boost, and every other U.S. carrier via The Campaign Registry, plus phone number activation and the compliance pages carriers require — so your messages are delivered reliably instead of filtered as spam.
              </p>
              <a
                href={SETUP_FEE_EXPLAINER_PATH}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block font-medium underline underline-offset-2 hover:text-[#ea580c] dark:hover:text-[#ff914d]"
              >
                Learn more about this fee →
              </a>
            </div>
          </div>
        )}
      </Section>

      {/* Business Info */}
      <Section title="Business Info" onEdit={() => onEditStep(1)}>
        <SummaryRow label="Name" value={data.businessInfo.name} />
        <SummaryRow label="Type" value={
              data.businessInfo.business_type === 'other'
                ? (data.businessInfo.business_type_other || 'Other')
                : (BUSINESS_TYPE_LABELS[data.businessInfo.business_type] || data.businessInfo.business_type)
            } />
        <SummaryRow label="Phone" value={data.businessInfo.phone} />
        <SummaryRow
          label="Address"
          value={`${data.businessInfo.address}, ${data.businessInfo.city}, ${getUsStateName(data.businessInfo.state)} ${data.businessInfo.zip}`}
        />
        {data.businessInfo.website && <SummaryRow label="Website" value={data.businessInfo.website} />}
      </Section>

      {/* Business Hours */}
      <Section title="Business Hours" onEdit={() => onEditStep(2)}>
        <div className="space-y-1">
          {data.businessHours.map((day) => (
            <div key={day.day} className="flex justify-between text-sm">
              <span className="capitalize text-stone-500 dark:text-[#bdbdbf]">{day.day}</span>
              <span className={day.is_closed ? 'text-stone-400 dark:text-[#666]' : 'text-stone-900 dark:text-[#f5f5f5]'}>
                {day.is_closed ? 'Closed' : `${formatTime(day.open_time)} - ${formatTime(day.close_time)}`}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Services & FAQs */}
      <Section title="Services & FAQs" onEdit={() => onEditStep(3)}>
        <SummaryRow label="Services" value={`${data.servicesCount} service${data.servicesCount !== 1 ? 's' : ''}`} />
        <SummaryRow label="FAQs" value={`${data.faqsCount} FAQ${data.faqsCount !== 1 ? 's' : ''}`} />
      </Section>

      {/* AI Settings */}
      <Section title="AI Personality" onEdit={() => onEditStep(4)}>
        <SummaryRow label="Tone" value={TONE_LABELS[data.aiSettings.tone] || data.aiSettings.tone} />
        <SummaryRow label="Voice" value={data.aiSettings.business_voice === 'we' ? '"We"' : 'Business name'} />
        <SummaryRow label="Language" value={LANGUAGE_LABELS[data.aiSettings.language] || data.aiSettings.language} />
        <SummaryRow
          label="Response Delay"
          value={data.aiSettings.response_delay_seconds === 0 ? 'Instant' : `${data.aiSettings.response_delay_seconds}s`}
        />
        <SummaryRow label="Booking" value={data.aiSettings.booking_enabled ? 'Enabled' : 'Disabled'} />
      </Section>

      {/* Legal Verification */}
      {data.brandVerification && (
        <Section title="Business Verification" onEdit={() => onEditStep(5)}>
          {data.brandVerification.legal_business_name && (
            <SummaryRow label="Legal name" value={data.brandVerification.legal_business_name} />
          )}
          {data.brandVerification.business_entity_type && (
            <SummaryRow
              label="Entity type"
              value={
                ENTITY_TYPE_LABELS[data.brandVerification.business_entity_type] ||
                data.brandVerification.business_entity_type
              }
            />
          )}
          {data.brandVerification.ein && (
            <SummaryRow label="EIN" value={maskEin(data.brandVerification.ein)} />
          )}
          {data.brandVerification.authorized_rep_name && (
            <SummaryRow
              label="Representative"
              value={
                data.brandVerification.authorized_rep_email
                  ? `${data.brandVerification.authorized_rep_name} (${data.brandVerification.authorized_rep_email})`
                  : data.brandVerification.authorized_rep_name
              }
            />
          )}
        </Section>
      )}

      {/* SMS Use Case */}
      {data.brandVerification && (
        <Section title="SMS Use Case" onEdit={() => onEditStep(6)}>
          {data.brandVerification.estimated_monthly_volume && (
            <SummaryRow
              label="Est. volume"
              value={
                VOLUME_LABELS[data.brandVerification.estimated_monthly_volume] ||
                data.brandVerification.estimated_monthly_volume
              }
            />
          )}
          {data.brandVerification.use_case_description && (
            <SummaryRow
              label="Use case"
              value={
                data.brandVerification.use_case_description.length > 80
                  ? `${data.brandVerification.use_case_description.slice(0, 80)}...`
                  : data.brandVerification.use_case_description
              }
            />
          )}
          {data.brandVerification.sample_messages && (
            <SummaryRow
              label="Sample messages"
              value={`${data.brandVerification.sample_messages.length} provided`}
            />
          )}
        </Section>
      )}

      {/* Phone Number */}
      <Section title="Phone Number" onEdit={() => onEditStep(7)}>
        {data.phoneNumber ? (
          <SummaryRow label="AI Phone Number" value={data.phoneNumber} />
        ) : (
          <div className="text-sm text-stone-500 dark:text-[#bdbdbf]">
            <p>No phone number selected</p>
            <p className="text-xs text-stone-400 dark:text-[#666] mt-1">
              Choose a SimplAssist number before submitting SMS registration.
            </p>
          </div>
        )}
      </Section>

      {error && (
        <div className={cn("rounded-lg px-4 py-3 text-sm", statusDanger)}>
          {error}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className={secondaryCtaClass}
        >
          Back
        </button>
        {showPrimaryButton && (
          <button
            onClick={
              launchHold?.action === 'choose_number'
                ? () => onEditStep(7)
                : launchHold?.action === 'add_ein'
                  ? () => onEditStep(5)
                : handleLaunch
            }
            disabled={launching && launchHold?.action !== 'choose_number' && launchHold?.action !== 'add_ein'}
            className={`${primaryCtaInlineClass} py-3 px-8 text-lg font-semibold`}
          >
            {primaryButtonLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function classifyPaidLaunchHold(
  registration: OnboardingState["registration"],
  pendingPhoneNumberFailureReason: string | null
): PaidLaunchHold | null {
  if (registration.holdReason === "held_no_ein" || isNoEinHold(registration.error)) {
    return {
      message: "Add your EIN before SMS setup can continue.",
      action: "add_ein",
      buttonLabel: "Add your EIN",
      helper: "You won't be charged again.",
    };
  }

  if (pendingPhoneNumberFailureReason || isNumberUnavailable(registration.error)) {
    return {
      message:
        "The number you selected is no longer available. Choose a new number to continue.",
      action: "choose_number",
      buttonLabel: "Choose a new number",
    };
  }

  if (isSubmissionDisabled(registration.error)) {
    return {
      message: "SMS setup is paused. Contact SimplAssist support to continue.",
      action: "none",
    };
  }

  if (
    registration.riskReview.status === "pending_review" ||
    registration.riskReview.status === "blocked" ||
    isRiskReviewHold(registration.error)
  ) {
    return {
      message:
        "We're reviewing your setup before submitting to carriers. No action needed. We'll email you.",
      action: "none",
    };
  }

  if (registration.status !== "failed") {
    return null;
  }

  return {
    message:
      registration.error ??
      "SMS setup could not finish automatically. You can continue setup when ready.",
    action: "retry",
    buttonLabel: "Continue SMS setup",
    helper: "You won't be charged again.",
  };
}

function primaryLaunchButtonLabel(args: {
  data: ReviewData;
  isPaidSubscription: boolean;
  launchHold: PaidLaunchHold | null;
  launching: boolean;
}): string {
  const { data, isPaidSubscription, launchHold, launching } = args;
  if (launchHold?.buttonLabel) return launchHold.buttonLabel;
  if (launching) {
    return isPaidSubscription ? "Checking setup..." : "Opening checkout...";
  }
  if (!data.phoneNumber) return "Choose number to submit";
  return isPaidSubscription ? "Continue SMS setup" : "Pay & submit SMS registration";
}

function isSubmissionDisabled(message: string | null): boolean {
  return /sms registration is disabled|submission disabled|telnyx submission disabled/i.test(
    message ?? ""
  );
}

function isNumberUnavailable(message: string | null): boolean {
  return /number.*(no longer available|unavailable|taken)|choose another number/i.test(
    message ?? ""
  );
}

function isRiskReviewHold(message: string | null): boolean {
  return /sms use-case review|a2p.*review|reviewing your setup|manual review/i.test(
    message ?? ""
  );
}

function isNoEinHold(message: string | null): boolean {
  return /held_no_ein|add your ein|before .*ein/i.test(message ?? "");
}

function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <div className={cn("p-4", tile)}>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium text-stone-900 dark:text-[#f5f5f5]">{title}</h3>
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] font-medium"
          >
            Edit
          </button>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-stone-500 dark:text-[#bdbdbf]">{label}</span>
      <span className="text-stone-900 dark:text-[#f5f5f5] font-medium">{value}</span>
    </div>
  );
}
