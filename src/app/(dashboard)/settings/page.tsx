import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AISettingsForm from '@/components/settings/AISettingsForm';
import ServicesManager from '@/components/settings/ServicesManager';
import FAQManager from '@/components/settings/FAQManager';
import BusinessHoursEditor from '@/components/settings/BusinessHoursEditor';
import PhoneNumberSection from '@/components/settings/PhoneNumberSection';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .single();

  if (!business) redirect('/onboarding');

  const [
    { data: aiSettings },
    { data: services },
    { data: faqs },
    { data: businessHours },
    { data: twilioNumber },
  ] = await Promise.all([
    supabase.from('ai_settings').select('*').eq('business_id', business.id).single(),
    supabase.from('services').select('*').eq('business_id', business.id).order('name'),
    supabase.from('faqs').select('*').eq('business_id', business.id).order('question'),
    supabase.from('business_hours').select('*').eq('business_id', business.id).order('day_of_week'),
    supabase.from('twilio_numbers').select('*').eq('business_id', business.id).eq('is_active', true).single(),
  ]);

  if (!aiSettings) redirect('/onboarding');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
        <p className="mt-1 text-gray-600">Configure how your AI assistant behaves and communicates.</p>
      </div>

      {/* Phone Number */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Phone Number</h2>
        <p className="text-sm text-gray-500 mb-4">
          The phone number customers use to text your AI assistant.
        </p>
        <PhoneNumberSection
          phoneNumber={twilioNumber?.phone_number || null}
          twilioSid={twilioNumber?.twilio_sid || null}
          isActive={twilioNumber?.is_active || false}
        />
      </div>

      {/* AI Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <AISettingsForm settings={aiSettings} businessName={business.name} />
      </div>

      {/* Services */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Services</h2>
        <p className="text-sm text-gray-500 mb-4">Manage the services your business offers. Your AI will use this information when talking to customers.</p>
        <ServicesManager businessId={business.id} initialServices={services || []} />
      </div>

      {/* FAQs */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">FAQs</h2>
        <p className="text-sm text-gray-500 mb-4">Common questions and answers your AI can use to help customers.</p>
        <FAQManager businessId={business.id} initialFaqs={faqs || []} />
      </div>

      {/* Business Hours */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Business Hours</h2>
        <p className="text-sm text-gray-500 mb-4">Set when your business is open. Your AI will inform customers of your hours.</p>
        <BusinessHoursEditor businessId={business.id} initialHours={businessHours || []} />
      </div>
    </div>
  );
}
