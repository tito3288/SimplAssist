'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUsStateName } from '@/lib/usStates';

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
  onEditStep: (step: number) => void;
  onBack: () => void;
}

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
  '1k_10k': '1,000 – 10,000 / month',
  '10k_100k': '10,000 – 100,000 / month',
  over_100k: 'Over 100,000 / month',
};

function maskEin(ein: string): string {
  if (ein.length !== 10) return ein;
  return `${ein.slice(0, 2)}-***-${ein.slice(-4)}`;
}

export default function ReviewAndLaunch({ data, onEditStep, onBack }: ReviewAndLaunchProps) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = async () => {
    setError(null);

    if (!data.phoneNumber) {
      onEditStep(6);
      return;
    }

    setLaunching(true);

    try {
      const res = await fetch('/api/onboarding/submit-registration', {
        method: 'POST',
      });
      const response = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(response.error || 'Could not submit SMS registration right now.');
        if (response.code === 'missing_phone_number') {
          onEditStep(6);
        }
        return;
      }

      router.push('/dashboard');
    } catch {
      setError('Could not submit SMS registration right now.');
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
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Review & Submit</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
          Submit your SMS registration for carrier review.
        </p>
      </div>

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
              <span className="capitalize text-slate-500 dark:text-[#bdbdbf]">{day.day}</span>
              <span className={day.is_closed ? 'text-slate-400 dark:text-[#666]' : 'text-slate-900 dark:text-[#f5f5f5]'}>
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

      {/* Brand Verification */}
      {data.brandVerification && (
        <Section title="Brand Verification" onEdit={() => onEditStep(5)}>
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
                  ? `${data.brandVerification.use_case_description.slice(0, 80)}…`
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
      <Section title="Phone Number" onEdit={() => onEditStep(6)}>
        {data.phoneNumber ? (
          <SummaryRow label="AI Phone Number" value={data.phoneNumber} />
        ) : (
          <div className="text-sm text-slate-500 dark:text-[#bdbdbf]">
            <p>No phone number selected</p>
            <p className="text-xs text-slate-400 dark:text-[#666] mt-1">
              Choose a SimpleAssist number before submitting SMS registration.
            </p>
          </div>
        )}
      </Section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="py-2 px-6 border border-slate-200 dark:border-white/[0.12] text-slate-700 dark:text-[#bdbdbf] font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06]"
        >
          Back
        </button>
        <button
          onClick={handleLaunch}
          disabled={launching}
          className="py-3 px-8 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] font-semibold rounded-lg shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 dark:hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:ring-offset-2 disabled:opacity-50 text-lg"
        >
          {launching
            ? 'Submitting...'
            : data.phoneNumber
              ? 'Submit SMS registration'
              : 'Choose number to submit'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] bg-white/50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium text-slate-900 dark:text-[#f5f5f5]">{title}</h3>
        <button
          onClick={onEdit}
          className="text-sm text-[#ff914d] hover:text-[#ffb07a] font-medium"
        >
          Edit
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500 dark:text-[#bdbdbf]">{label}</span>
      <span className="text-slate-900 dark:text-[#f5f5f5] font-medium">{value}</span>
    </div>
  );
}
