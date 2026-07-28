import { redirect } from 'next/navigation';
import AISettingsForm from '@/components/settings/AISettingsForm';
import ServicesManager from '@/components/settings/ServicesManager';
import FAQManager from '@/components/settings/FAQManager';
import BusinessHoursEditor from '@/components/settings/BusinessHoursEditor';
import PhoneNumberSection from '@/components/settings/PhoneNumberSection';
import BusinessEmailForm from '@/components/settings/BusinessEmailForm';
import TimezoneSelector from '@/components/settings/TimezoneSelector';
import CompliancePanel from '@/components/settings/CompliancePanel';
import { card } from '@/lib/theme-v2/theme';
import DangerZone from '@/components/settings/DangerZone';
import { LockedFeatureCard } from '@/components/entitlements/LockedFeatureCard';
import { canUseFeature } from '@/lib/billing/entitlements';
import { getDashboardEntitledContext } from '@/lib/dashboard/context';

export default async function SettingsPage() {
  const context = await getDashboardEntitledContext();
  if (context.status === 'unauthenticated') redirect('/login');
  if (context.status !== 'resolved') redirect('/onboarding');

  const { supabase, business, entitlements } = context;
  const canCustomizeAi = canUseFeature(entitlements, 'ai_customization');
  const canUseCalendar = canUseFeature(entitlements, 'calendar');
  const canUseGuardrails = canUseFeature(entitlements, 'advanced_guardrails');

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
        <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">Settings</h1>
        <p className="mt-1 text-stone-500 dark:text-[#bdbdbf]">Configure how your AI assistant behaves and communicates.</p>
      </div>

      {/* Phone Number */}
      <div className={`p-6 ${card}`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Phone Number</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">
          The phone number customers use to text your AI assistant.
        </p>
        <PhoneNumberSection
          phoneNumber={phoneNumberRow?.phone_number || null}
          isActive={phoneNumberRow?.is_active || false}
          callForwardingEnabled={business.call_forwarding_enabled ?? false}
          forwardToNumber={business.forward_to_number ?? null}
        />
      </div>

      {/* Business Email */}
      <div className={`p-6 ${card}`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Business Email</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">
          Contact email your AI can share with customers when it needs to escalate.
        </p>
        <BusinessEmailForm businessId={business.id} initialEmail={business.email} />
      </div>

      {/* Compliance (Phase 6) — privacy/terms URLs submitted to Telnyx */}
      <div className={`p-6 ${card}`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Compliance</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">
          Where your privacy policy and terms of service live. Carriers (T-Mobile, AT&amp;T, Verizon) check these when reviewing your SMS campaign.
        </p>
        <CompliancePanel
          slug={business.slug}
          business={{
            name: business.name,
            phone_number: business.phone_number,
            sms_phone_number: phoneNumberRow?.phone_number ?? null,
            email: business.email,
            address: business.address,
            city: business.city,
            state: business.state,
            zip: business.zip,
            opt_in_description: business.opt_in_description,
            language: aiSettings.language,
          }}
          initialMode={business.privacy_terms_mode ?? 'hosted'}
          initialPrivacyUrl={business.privacy_url_override}
          initialTermsUrl={business.terms_url_override}
        />
      </div>

      {/* AI Settings */}
      <div className={`p-6 ${card}`}>
        <AISettingsForm
          settings={aiSettings}
          businessName={business.name}
          calendarEmail={calendarToken?.google_email ?? null}
          businessId={business.id}
          canCustomizeAi={canCustomizeAi}
          canUseCalendar={canUseCalendar}
          canUseGuardrails={canUseGuardrails}
          planActive={entitlements.active}
        />
      </div>

      {/* Services */}
      <div className={`p-6 ${card}`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Services</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Manage the services your business offers. Your AI will use this information when talking to customers.</p>
        {canCustomizeAi ? (
          <ServicesManager businessId={business.id} initialServices={services || []} />
        ) : (
          <LockedFeatureCard
            compact
            title="Service customization is paused"
            description={entitlements.active
              ? "Growth lets your AI use your service catalog when answering customers."
              : "Reactivate your subscription to use your saved service catalog in AI conversations."}
            requiredPlan={entitlements.active ? "Growth" : null}
            preservedDetail={`${services?.length ?? 0} saved service${services?.length === 1 ? '' : 's'} will remain available after upgrading.`}
          />
        )}
      </div>

      {/* FAQs */}
      <div className={`p-6 ${card}`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">FAQs</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Common questions and answers your AI can use to help customers.</p>
        {canCustomizeAi ? (
          <FAQManager businessId={business.id} initialFaqs={faqs || []} />
        ) : (
          <LockedFeatureCard
            compact
            title="FAQ customization is paused"
            description={entitlements.active
              ? "Growth lets your AI answer from your saved business FAQs."
              : "Reactivate your subscription to use your saved FAQs in AI conversations."}
            requiredPlan={entitlements.active ? "Growth" : null}
            preservedDetail={`${faqs?.length ?? 0} saved FAQ${faqs?.length === 1 ? '' : 's'} will remain available after upgrading.`}
          />
        )}
      </div>

      {/* Business Hours */}
      <div className={`p-6 ${card}`}>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Business Hours</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Set when your business is open. Your AI will inform customers of your hours.</p>

        <div className="mb-6">
          <label className="block text-sm font-medium text-stone-700 dark:text-[#bdbdbf] mb-2">
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
