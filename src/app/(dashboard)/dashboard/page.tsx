import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import DashboardOverview from '@/components/dashboard/DashboardOverview';
import { glassCard } from '@/lib/glass';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .single();

  if (!business) redirect('/onboarding');

  // Calculate date for "this week" queries
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoISO = weekAgo.toISOString();

  const [
    { count: totalConversations },
    { count: activeConversations },
    { count: totalContacts },
    { count: messagesThisWeek },
    { data: recentConversationsRaw },
    { data: hotLeads },
    { data: twilioNumber },
    { data: aiSettings },
    { data: calendarToken },
  ] = await Promise.all([
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('business_id', business.id),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('business_id', business.id).eq('status', 'active'),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('business_id', business.id),
    supabase.from('messages').select('*', { count: 'exact', head: true }).eq('business_id', business.id).gte('created_at', weekAgoISO),
    supabase
      .from('conversations')
      .select('*, contact:contacts(name, phone_number)')
      .eq('business_id', business.id)
      .order('last_message_at', { ascending: false })
      .limit(5),
    supabase
      .from('contacts')
      .select('*')
      .eq('business_id', business.id)
      .gte('lead_score', 7)
      .order('lead_score', { ascending: false })
      .limit(10),
    supabase
      .from('twilio_numbers')
      .select('phone_number, is_active')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .single(),
    supabase.from('ai_settings').select('booking_enabled, booking_mode').eq('business_id', business.id).single(),
    supabase.from('google_calendar_tokens').select('id').eq('business_id', business.id).single(),
  ]);

  // Fetch last message for each recent conversation
  const recentConversations = await Promise.all(
    (recentConversationsRaw || []).map(async (conv) => {
      const { data: messages } = await supabase
        .from('messages')
        .select('content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1);
      return {
        ...conv,
        lastMessage: messages?.[0]?.content || undefined,
      };
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-[#f5f5f5]">Dashboard</h1>
        <p className="mt-1 text-slate-500 dark:text-[#bdbdbf]">Overview of your business activity.</p>
      </div>

      {/* Calendar connection warning */}
      {!calendarToken && (
        <div className={`p-4 ${glassCard} border-amber-500/30 dark:border-amber-500/30`}>
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)] flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-[#f5f5f5]">
                Google Calendar not connected
              </p>
              <p className="text-xs text-slate-500 dark:text-[#bdbdbf] mt-0.5">
                Connect your Google Calendar to let your AI check availability and book appointments for customers automatically.
              </p>
            </div>
            <Link
              href="/settings"
              className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
            >
              Connect Now
            </Link>
          </div>
        </div>
      )}

      <DashboardOverview
        stats={{
          totalConversations: totalConversations || 0,
          activeConversations: activeConversations || 0,
          totalContacts: totalContacts || 0,
          messagesThisWeek: messagesThisWeek || 0,
        }}
        recentConversations={recentConversations}
        hotLeads={hotLeads || []}
        phoneNumber={twilioNumber?.phone_number || null}
      />
    </div>
  );
}
