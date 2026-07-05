import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOnboardingStateForOwner } from '@/lib/onboarding/state';
import { glassCard } from '@/lib/glass';
import { ThemeToggle } from '@/components/theme-toggle';

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

  const { data: business } = await supabase
    .from('businesses')
    .select('id, deleted_at')
    .eq('owner_id', user.id)
    .single();

  if (business?.deleted_at) {
    redirect('/account-deleted');
  }

  const onboardingState = await getOnboardingStateForOwner(user.id);
  if (onboardingState?.dashboardReady) {
    redirect('/dashboard');
  }

  return (
    <div
      className="
        relative min-h-screen overflow-x-hidden
        flex flex-col items-center justify-center p-4 sm:p-6
        bg-gradient-to-b from-slate-50 via-white to-slate-100
        dark:bg-none dark:bg-[#050505]
      "
    >
      {/* Dark-mode ambient gradient */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{
          background:
            "radial-gradient(circle at 85% 8%, rgba(255,145,77,.20), transparent 28%), radial-gradient(circle at 10% 35%, rgba(255,145,77,.10), transparent 22%), linear-gradient(180deg, #080808 0%, #050505 45%, #0a0a0c 100%)",
        }}
      />

      {/* Orange orbs */}
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-25 dark:opacity-40"
        style={{
          width: 520,
          height: 520,
          background: "rgba(255,145,77,.22)",
          top: -120,
          right: -160,
          filter: "blur(64px)",
        }}
      />
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-18 dark:opacity-35"
        style={{
          width: 280,
          height: 280,
          background: "rgba(255,145,77,.16)",
          left: -100,
          bottom: "12%",
          filter: "blur(56px)",
        }}
      />

      <div className="relative z-[1] w-full max-w-[720px]">
        <div className="mb-4 flex justify-end">
          <ThemeToggle />
        </div>
        <div className={`p-6 sm:p-8 ${glassCard}`}>{children}</div>
      </div>
    </div>
  );
}
