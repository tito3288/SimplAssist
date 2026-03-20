'use client';

import { useState } from 'react';
import { Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';

interface PhoneNumberSectionProps {
  phoneNumber: string | null;
  twilioSid: string | null;
  isActive: boolean;
}

export default function PhoneNumberSection({ phoneNumber, twilioSid, isActive }: PhoneNumberSectionProps) {
  const router = useRouter();
  const [releasing, setReleasing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    if (!twilioSid) return;
    setReleasing(true);
    setError(null);

    try {
      const res = await fetch('/api/twilio/numbers/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twilioSid }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to release number');
        return;
      }

      router.refresh();
    } catch {
      setError('Failed to release number');
    } finally {
      setReleasing(false);
      setShowConfirm(false);
    }
  }

  if (phoneNumber && isActive) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 p-4 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg">
          <div className="p-2 rounded-lg bg-green-100 dark:bg-green-500/20">
            <Phone className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-slate-900 dark:text-[#f5f5f5]">{phoneNumber}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300">
                Active
              </span>
              <span className="text-xs text-slate-500 dark:text-[#bdbdbf]">Receiving messages 24/7</span>
            </div>
          </div>
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 dark:border-red-500/30 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              Release Number
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">Are you sure?</span>
              <button
                onClick={handleRelease}
                disabled={releasing}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {releasing ? 'Releasing...' : 'Yes, release'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-[#bdbdbf] border border-slate-200 dark:border-white/[0.12] rounded-md hover:bg-slate-50 dark:hover:bg-white/[0.04]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return <PhoneNumberSelector />;
}
