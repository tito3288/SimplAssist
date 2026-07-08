'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';

export default function OnboardingSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/home');
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className="inline-flex min-h-10 items-center gap-2 rounded-[20px] border border-slate-200 bg-white/70 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.12] dark:bg-white/[0.05] dark:text-[#bdbdbf] dark:hover:bg-white/[0.08] dark:hover:text-white"
    >
      <LogOut className="h-4 w-4" />
      {signingOut ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
