'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import StepProgress from '@/components/onboarding/StepProgress';
import BusinessInfoForm, { type ScrapedData } from '@/components/onboarding/BusinessInfoForm';
import BusinessHoursForm from '@/components/onboarding/BusinessHoursForm';
import ServicesAndFaqsForm from '@/components/onboarding/ServicesAndFaqsForm';
import AIPersonalityForm from '@/components/onboarding/AIPersonalityForm';
import ReviewAndLaunch from '@/components/onboarding/ReviewAndLaunch';
import type { BusinessType } from '@/types/database';

interface BusinessInfoData {
  name: string;
  business_type: BusinessType;
  website?: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface HoursData {
  day: string;
  is_closed: boolean;
  open_time: string;
  close_time: string;
}

interface ServicesData {
  services: { name: string; description?: string; price?: string }[];
  faqs: { question: string; answer: string }[];
}

interface AIData {
  tone: 'friendly' | 'professional' | 'balanced';
  business_voice: 'we' | 'business_name';
  language: 'en' | 'es' | 'both';
  response_delay_seconds: number;
  sms_greeting: string;
  web_greeting: string;
  guardrails?: string;
  booking_enabled: boolean;
  booking_mode?: 'collect_info' | 'schedule_direct';
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [businessId, setBusinessId] = useState('');
  const [loading, setLoading] = useState(true);

  // Step data
  const [businessInfo, setBusinessInfo] = useState<BusinessInfoData | null>(null);
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [hoursData, setHoursData] = useState<HoursData[] | null>(null);
  const [servicesData, setServicesData] = useState<ServicesData | null>(null);
  const [aiData, setAiData] = useState<AIData | null>(null);

  const fetchBusiness = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    if (business) {
      setBusinessId(business.id);
      setBusinessInfo({
        name: business.name || '',
        business_type: business.business_type || 'general',
        website: business.website_url || '',
        phone: business.phone_number || '',
        address: business.address || '',
        city: business.city || '',
        state: business.state || '',
        zip: business.zip || '',
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBusiness();
  }, [fetchBusiness]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin h-8 w-8 text-blue-600" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div>
      <StepProgress currentStep={step} />

      <div className="transition-opacity duration-200">
        {step === 1 && (
          <BusinessInfoForm
            businessId={businessId}
            initialData={businessInfo || undefined}
            onNext={(data, scraped) => {
              setBusinessInfo(data as BusinessInfoData);
              setScrapedData(scraped);
              setStep(2);
            }}
          />
        )}

        {step === 2 && (
          <BusinessHoursForm
            businessId={businessId}
            initialData={hoursData || undefined}
            onNext={(data) => {
              setHoursData(data);
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <ServicesAndFaqsForm
            businessId={businessId}
            businessType={(businessInfo?.business_type || 'general') as BusinessType}
            scrapedServices={scrapedData?.services}
            scrapedFaqs={scrapedData?.faqs}
            initialData={servicesData || undefined}
            onNext={(data) => {
              setServicesData(data);
              setStep(4);
            }}
            onBack={() => setStep(2)}
          />
        )}

        {step === 4 && (
          <AIPersonalityForm
            businessId={businessId}
            businessName={businessInfo?.name || 'Your Business'}
            initialData={aiData || undefined}
            onNext={(data) => {
              setAiData(data);
              setStep(5);
            }}
            onBack={() => setStep(3)}
          />
        )}

        {step === 5 && businessInfo && hoursData && servicesData && aiData && (
          <ReviewAndLaunch
            data={{
              businessInfo,
              businessHours: hoursData,
              servicesCount: servicesData.services.length,
              faqsCount: servicesData.faqs.filter((f) => f.question && f.answer).length,
              aiSettings: aiData,
            }}
            onEditStep={(s) => setStep(s)}
            onBack={() => setStep(4)}
          />
        )}
      </div>
    </div>
  );
}
