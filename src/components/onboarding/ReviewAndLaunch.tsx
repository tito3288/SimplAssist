'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ReviewData {
  businessInfo: {
    name: string;
    business_type: string;
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
    sms_greeting: string;
    web_greeting: string;
    booking_enabled: boolean;
    booking_mode?: string;
  };
  phoneNumber?: string | null;
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
};

export default function ReviewAndLaunch({ data, onEditStep, onBack }: ReviewAndLaunchProps) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);

  const handleLaunch = () => {
    setLaunching(true);
    router.push('/dashboard');
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
        <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Review & Launch</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">Everything looks good? Hit launch to get started.</p>
      </div>

      {/* Business Info */}
      <Section title="Business Info" onEdit={() => onEditStep(1)}>
        <SummaryRow label="Name" value={data.businessInfo.name} />
        <SummaryRow label="Type" value={BUSINESS_TYPE_LABELS[data.businessInfo.business_type] || data.businessInfo.business_type} />
        <SummaryRow label="Phone" value={data.businessInfo.phone} />
        <SummaryRow
          label="Address"
          value={`${data.businessInfo.address}, ${data.businessInfo.city}, ${data.businessInfo.state} ${data.businessInfo.zip}`}
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

      {/* Phone Number */}
      <Section title="Phone Number" onEdit={() => onEditStep(5)}>
        {data.phoneNumber ? (
          <SummaryRow label="AI Phone Number" value={data.phoneNumber} />
        ) : (
          <div className="text-sm text-slate-500 dark:text-[#bdbdbf]">
            <p>No phone number selected</p>
            <p className="text-xs text-slate-400 dark:text-[#666] mt-1">You can add one later from Settings</p>
          </div>
        )}
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
          {launching ? 'Launching...' : 'Launch SimplAssist'}
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
