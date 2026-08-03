'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { primaryCtaInlineClass } from '@/lib/glass';

interface BusinessEmailFormProps {
  businessId: string;
  initialEmail: string | null;
}

export default function BusinessEmailForm({ businessId, initialEmail }: BusinessEmailFormProps) {
  const [email, setEmail] = useState(initialEmail || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address');
      setSaving(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from('businesses')
        .update({ email: email || null })
        .eq('id', businessId);
      if (dbError) throw dbError;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to save email');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="info@yourbusiness.com"
          className="flex-1 px-3 py-2 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className={`${primaryCtaInlineClass} whitespace-nowrap`}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">
        Your AI will suggest this email when it can&apos;t fully help a customer.
      </p>
    </div>
  );
}
