import { redirect } from 'next/navigation';
import WidgetPageClient from './WidgetPageClient';
import { canUseFeature } from '@/lib/billing/entitlements';
import { LockedFeatureCard } from '@/components/entitlements/LockedFeatureCard';
import { getDashboardEntitledContext } from '@/lib/dashboard/context';
import { requireWorkspacePageAccess } from '@/lib/customer/workspaceRouteResponse.server';
import { resolveConnectedBusinessPartner } from '@/lib/branding/businessPartner.server';
import { getCanonicalAppOrigin } from '@/lib/branding/defaultBrand';
import { normalizeHostHeader } from '@/lib/branding/hostname';

export default async function WidgetPage() {
  await requireWorkspacePageAccess();
  const context = await getDashboardEntitledContext();
  if (context.status === 'unauthenticated') redirect('/login');
  if (context.status !== 'resolved') redirect('/onboarding');

  const { supabase, business, entitlements } = context;
  const planActive = entitlements.active;
  if (!canUseFeature(entitlements, 'web_chat')) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">Website Chat Widget</h1>
          <p className="mt-1 text-stone-500 dark:text-[#bdbdbf]">
            Capture website visitors and continue the conversation with AI.
          </p>
        </div>
        <LockedFeatureCard
          title={planActive ? "Website chat is available on Growth" : "Website chat is paused"}
          description={
            planActive
              ? "Upgrade to install the widget, capture web leads, and customize its branding."
              : "Reactivate your subscription to make your saved website chat widget available again."
          }
          requiredPlan={planActive ? "Growth" : null}
          preservedDetail="Any widget configuration you already saved is preserved while this feature is paused."
        />
      </div>
    );
  }

  let { data: widgetConfig } = await supabase
    .from('widget_configs')
    .select('*')
    .eq('business_id', business.id)
    .single();

  // Create default widget config if none exists
  if (!widgetConfig) {
    const initialAllowedHostnames = allowedHostnamesFromWebsiteUrl(
      business.website_url,
    );
    const { data: newConfig } = await supabase
      .from('widget_configs')
      .insert({
        business_id: business.id,
        brand_color: '#3B82F6',
        position: 'bottom_right',
        welcome_message: 'Hi there! 👋 How can we help you today?',
        proactive_invitation_enabled: true,
        show_logo: true,
        logo_url: null,
        lead_capture_enabled: true,
        lead_capture_timing: 'after_3_messages',
        quick_replies: ['Book a free consultation', 'What services do you offer?', 'What areas do you cover?'],
        allowed_hostnames: initialAllowedHostnames,
        is_active: initialAllowedHostnames.length > 0,
      })
      .select()
      .single();

    widgetConfig = newConfig;
  }

  if (!widgetConfig) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">Website Chat Widget</h1>
        <p className="mt-2 text-red-600">Failed to load widget configuration. Please try again.</p>
      </div>
    );
  }

  const connectedPartner = await resolveConnectedBusinessPartner(business.id);
  const scriptOrigin =
    connectedPartner?.publicOrigin ?? getCanonicalAppOrigin();

  return (
    <WidgetPageClient
      config={widgetConfig}
      businessId={business.id}
      businessName={business.name}
      scriptOrigin={scriptOrigin}
    />
  );
}

function allowedHostnamesFromWebsiteUrl(value: string | null): string[] {
  const candidate = value?.trim();
  if (!candidate) return [];

  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    );
  } catch {
    return [];
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password
  ) {
    return [];
  }
  const hostname = normalizeHostHeader(parsed.hostname);
  return hostname ? [hostname] : [];
}
