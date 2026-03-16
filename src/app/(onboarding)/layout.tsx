import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user already completed onboarding
  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .single();

  if (business && business.business_type !== 'general') {
    const { data: aiSettings } = await supabase
      .from('ai_settings')
      .select('id')
      .eq('business_id', business.id)
      .single();

    if (aiSettings) {
      redirect('/dashboard');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-[700px]">
        <div className="bg-white rounded-xl shadow-lg p-8">{children}</div>
      </div>
    </div>
  );
}
