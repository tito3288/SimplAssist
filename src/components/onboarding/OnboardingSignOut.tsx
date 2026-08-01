'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/client';
import { secondaryCtaCompactClass } from '@/lib/glass';

export default function OnboardingSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createBrowserClient();
    // Global scope (default) is deliberate: the customer's remote-revocation
    // lever. Only the dedicated admin identity could be harmed by it, and it
    // must never sign into the customer app.
    await supabase.auth.signOut();
    router.refresh();
    router.push('/');
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={`${secondaryCtaCompactClass} min-h-10 gap-2`}
    >
      <LogOut className="h-4 w-4" />
      {signingOut ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
