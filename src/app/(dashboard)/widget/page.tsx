import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import WidgetPageClient from './WidgetPageClient';

export default async function WidgetPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('owner_id', user.id)
    .single();

  if (!business) redirect('/onboarding');

  let { data: widgetConfig } = await supabase
    .from('widget_configs')
    .select('*')
    .eq('business_id', business.id)
    .single();

  // Create default widget config if none exists
  if (!widgetConfig) {
    const { data: newConfig } = await supabase
      .from('widget_configs')
      .insert({
        business_id: business.id,
        brand_color: '#3B82F6',
        position: 'bottom_right',
        welcome_message: 'Hi there! 👋 How can we help you today?',
        show_logo: true,
        logo_url: null,
        lead_capture_enabled: true,
        lead_capture_timing: 'after_3_messages',
        is_active: false,
      })
      .select()
      .single();

    widgetConfig = newConfig;
  }

  if (!widgetConfig) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-[#f5f5f5]">Website Chat Widget</h1>
        <p className="mt-2 text-red-600">Failed to load widget configuration. Please try again.</p>
      </div>
    );
  }

  return (
    <WidgetPageClient
      config={widgetConfig}
      businessId={business.id}
      businessName={business.name}
    />
  );
}
