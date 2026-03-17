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
        <h2 className="text-xl font-semibold text-gray-900">Review & Launch</h2>
        <p className="text-sm text-gray-500">Everything looks good? Hit launch to get started.</p>
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
              <span className="capitalize text-gray-600">{day.day}</span>
              <span className={day.is_closed ? 'text-gray-400' : 'text-gray-900'}>
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
          <div className="text-sm text-gray-500">
            <p>No phone number selected</p>
            <p className="text-xs text-gray-400 mt-1">You can add one later from Settings</p>
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
          className="py-2 px-6 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={handleLaunch}
          disabled={launching}
          className="py-3 px-8 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 text-lg"
        >
          {launching ? 'Launching...' : 'Launch SimplAssist'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium text-gray-900">{title}</h3>
        <button
          onClick={onEdit}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
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
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}
