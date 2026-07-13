'use client';

import { Phone } from 'lucide-react';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';
import CallForwardingForm from '@/components/settings/CallForwardingForm';
import { cn } from '@/lib/utils';
import { statusSuccess, ink, body, inlineLink } from '@/lib/theme-v2/theme';

interface PhoneNumberSectionProps {
  phoneNumber: string | null;
  isActive: boolean;
  callForwardingEnabled: boolean;
  forwardToNumber: string | null;
}

export default function PhoneNumberSection({
  phoneNumber,
  isActive,
  callForwardingEnabled,
  forwardToNumber,
}: PhoneNumberSectionProps) {
  if (phoneNumber && isActive) {
    return (
      <div className="space-y-3">
        <div className={cn("flex items-center gap-4 p-4 rounded-lg", statusSuccess)}>
          <div className="p-2 rounded-lg bg-green-100 dark:bg-green-500/20">
            <Phone className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <p className={cn("text-lg font-bold", ink)}>{phoneNumber}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", statusSuccess)}>
                Active
              </span>
              <span className={cn("text-xs", body)}>Receiving messages 24/7</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-stone-400 dark:text-[#666]">
          Need to change your number? Contact{' '}
          <a href="mailto:bryan@simplassist.com" className={cn(inlineLink, "underline")}>
            bryan@simplassist.com
          </a>
        </p>
        <CallForwardingForm
          initialEnabled={callForwardingEnabled}
          initialForwardToNumber={forwardToNumber}
          smsPhoneNumber={phoneNumber}
        />
      </div>
    );
  }

  return <PhoneNumberSelector />;
}
