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
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-orange-500/40"
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
      <p className="text-xs text-slate-500 dark:text-[#bdbdbf]">
        Your AI will suggest this email when it can&apos;t fully help a customer.
      </p>
    </div>
  );
}
