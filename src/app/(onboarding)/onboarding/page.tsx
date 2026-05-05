'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import StepProgress from '@/components/onboarding/StepProgress';
import BusinessInfoForm, { type ScrapedData } from '@/components/onboarding/BusinessInfoForm';
import BusinessHoursForm from '@/components/onboarding/BusinessHoursForm';
import ServicesAndFaqsForm from '@/components/onboarding/ServicesAndFaqsForm';
import AIPersonalityForm from '@/components/onboarding/AIPersonalityForm';
import ReviewAndLaunch from '@/components/onboarding/ReviewAndLaunch';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';
import type { BusinessType } from '@/types/database';
import { Phone } from 'lucide-react';
import { PulsingDot } from '@/components/ui/pulsing-dot';

interface BusinessInfoData {
  name: string;
  business_type: BusinessType;
  business_type_other?: string;
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
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<string | null>(null);
  const [smsConsentAgreed, setSmsConsentAgreed] = useState(false);

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
        business_type_other: business.business_type_other || '',
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

  // Check if a phone number was purchased when advancing from step 5
  const handlePhoneStepNext = async () => {
    const supabase = createClient();
    const { data: phoneNumberRow } = await supabase
      .from('phone_numbers')
      .select('phone_number')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .single();

    if (phoneNumberRow) {
      setSelectedPhoneNumber(phoneNumberRow.phone_number);
    }

    // Save SMS consent to database
    if (smsConsentAgreed) {
      await supabase.from('businesses').update({
        sms_consent_agreed: true,
        sms_consent_agreed_at: new Date().toISOString(),
      }).eq('id', businessId);
    }

    setStep(6);
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-12">
        <PulsingDot />
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">Loading your setup…</p>
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

        {step === 5 && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-100 dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(255,145,77,.22),rgba(255,255,255,.08))] border border-orange-200 dark:border-white/[0.10] mb-4">
                <Phone className="w-6 h-6 text-[#ff914d]" />
              </div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-[#f5f5f5]">Choose a phone number for your AI assistant</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-[#bdbdbf]">
                Customers will text this number and your AI will respond automatically
              </p>
            </div>

            <PhoneNumberSelector onConsentChange={setSmsConsentAgreed} />

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="py-2 px-6 border border-slate-200 dark:border-white/[0.12] text-slate-700 dark:text-[#bdbdbf] font-medium rounded-full hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPhoneNumber(null);
                    setStep(6);
                  }}
                  className="py-2 px-6 border border-slate-200 dark:border-white/[0.12] text-slate-700 dark:text-[#bdbdbf] font-medium rounded-full hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={handlePhoneStepNext}
                  disabled={!smsConsentAgreed}
                  className="py-2 px-6 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] font-medium rounded-full shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 dark:hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 6 && businessInfo && hoursData && servicesData && aiData && (
          <ReviewAndLaunch
            data={{
              businessInfo,
              businessHours: hoursData,
              servicesCount: servicesData.services.length,
              faqsCount: servicesData.faqs.filter((f) => f.question && f.answer).length,
              aiSettings: aiData,
              phoneNumber: selectedPhoneNumber,
            }}
            onEditStep={(s) => setStep(s)}
            onBack={() => setStep(5)}
          />
        )}
      </div>
    </div>
  );
}
