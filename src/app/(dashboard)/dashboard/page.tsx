import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import DashboardOverview from '@/components/dashboard/DashboardOverview';

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
