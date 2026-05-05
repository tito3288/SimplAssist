import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AISettingsForm from '@/components/settings/AISettingsForm';
import ServicesManager from '@/components/settings/ServicesManager';
import FAQManager from '@/components/settings/FAQManager';
import BusinessHoursEditor from '@/components/settings/BusinessHoursEditor';
import PhoneNumberSection from '@/components/settings/PhoneNumberSection';
import BusinessEmailForm from '@/components/settings/BusinessEmailForm';
import TimezoneSelector from '@/components/settings/TimezoneSelector';
import { glassCard } from '@/lib/glass';
import DangerZone from '@/components/settings/DangerZone';

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
    { data: phoneNumberRow },
    { data: calendarToken },
  ] = await Promise.all([
    supabase.from('ai_settings').select('*').eq('business_id', business.id).single(),
    supabase.from('services').select('*').eq('business_id', business.id).order('name'),
    supabase.from('faqs').select('*').eq('business_id', business.id).order('question'),
    supabase.from('business_hours').select('*').eq('business_id', business.id).order('day_of_week'),
    supabase.from('phone_numbers').select('*').eq('business_id', business.id).eq('is_active', true).single(),
    supabase.from('google_calendar_tokens').select('*').eq('business_id', business.id).single(),
  ]);

  if (!aiSettings) redirect('/onboarding');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-[#f5f5f5]">Settings</h1>
        <p className="mt-1 text-slate-500 dark:text-[#bdbdbf]">Configure how your AI assistant behaves and communicates.</p>
      </div>

      {/* Phone Number */}
      <div className={`p-6 ${glassCard}`}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Phone Number</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">
          The phone number customers use to text your AI assistant.
        </p>
        <PhoneNumberSection
          phoneNumber={phoneNumberRow?.phone_number || null}
          isActive={phoneNumberRow?.is_active || false}
        />
      </div>

      {/* Business Email */}
      <div className={`p-6 ${glassCard}`}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Business Email</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">
          Contact email your AI can share with customers when it needs to escalate.
        </p>
        <BusinessEmailForm businessId={business.id} initialEmail={business.email} />
      </div>

      {/* AI Settings */}
      <div className={`p-6 ${glassCard}`}>
        <AISettingsForm
          settings={aiSettings}
          businessName={business.name}
          calendarEmail={calendarToken?.google_email ?? null}
          businessId={business.id}
        />
      </div>

      {/* Services */}
      <div className={`p-6 ${glassCard}`}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Services</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Manage the services your business offers. Your AI will use this information when talking to customers.</p>
        <ServicesManager businessId={business.id} initialServices={services || []} />
      </div>

      {/* FAQs */}
      <div className={`p-6 ${glassCard}`}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">FAQs</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Common questions and answers your AI can use to help customers.</p>
        <FAQManager businessId={business.id} initialFaqs={faqs || []} />
      </div>

      {/* Business Hours */}
      <div className={`p-6 ${glassCard}`}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Business Hours</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Set when your business is open. Your AI will inform customers of your hours.</p>

        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf] mb-2">
            Timezone
          </label>
          <TimezoneSelector businessId={business.id} initialTimezone={business.timezone} />
        </div>

        <BusinessHoursEditor businessId={business.id} initialHours={businessHours || []} />
      </div>

      {/* Danger Zone */}
      <DangerZone />
    </div>
  );
}
