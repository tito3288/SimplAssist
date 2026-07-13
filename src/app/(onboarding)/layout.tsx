import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOnboardingStateForOwner } from '@/lib/onboarding/state';
import { card, pageShell, fontStack, lightAmbient, darkAmbient } from '@/lib/theme-v2/theme';
import { ThemeToggleV2 } from '@/lib/theme-v2/ui';
import OnboardingSignOut from '@/components/onboarding/OnboardingSignOut';

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
      className={`${pageShell} isolate overflow-x-hidden flex flex-col items-center justify-center p-4 sm:p-6`}
      style={{ fontFamily: fontStack }}
    >
      {/* Light-mode ambient gradient */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 dark:hidden"
        style={{ background: lightAmbient }}
      />
      {/* Dark-mode ambient gradient */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{ background: darkAmbient }}
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
        <div className="mb-4 flex items-center justify-end gap-2">
          <OnboardingSignOut />
          <ThemeToggleV2 />
        </div>
        <div className={`p-6 sm:p-8 ${card}`}>{children}</div>
      </div>
    </div>
  );
}
