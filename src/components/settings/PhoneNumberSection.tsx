'use client';

import { Phone } from 'lucide-react';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';

interface PhoneNumberSectionProps {
  phoneNumber: string | null;
  twilioSid: string | null;
  isActive: boolean;
}

export default function PhoneNumberSection({ phoneNumber, isActive }: PhoneNumberSectionProps) {
  if (phoneNumber && isActive) {
    return (
      <div className="space-y-3">
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
        </div>
        <p className="text-xs text-slate-400 dark:text-[#666]">
          Need to change your number? Contact{' '}
          <a href="mailto:bryan@simplassist.com" className="text-[#ff914d] hover:text-[#ffb07a] underline">
            bryan@simplassist.com
          </a>
        </p>
      </div>
    );
  }

  return <PhoneNumberSelector />;
}
