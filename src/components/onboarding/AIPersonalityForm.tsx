'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AITone, Language } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaInlineClass, secondaryCtaClass } from '@/lib/glass';

const aiPersonalitySchema = z.object({
  tone: z.enum(['friendly', 'professional', 'balanced'] as const),
  business_voice: z.enum(['we', 'business_name'] as const),
  language: z.enum(['en', 'es', 'both'] as const),
  response_delay_seconds: z.number().min(0).max(60),
  web_greeting: z.string().min(1, 'Web chat greeting is required'),
  guardrails: z.string().optional(),
  booking_enabled: z.boolean(),
  booking_mode: z.enum(['collect_info', 'schedule_direct'] as const).optional(),
});

type AIPersonalityData = z.infer<typeof aiPersonalitySchema>;

interface AIPersonalityFormProps {
  businessId: string;
  businessName: string;
  initialData?: Partial<AIPersonalityData>;
  onNext: (data: AIPersonalityData) => void;
  onBack: () => void;
}

const TONE_OPTIONS: { value: AITone; label: string; description: string }[] = [
  { value: 'friendly', label: 'Friendly & Casual', description: 'Warm, approachable, uses casual language' },
  { value: 'professional', label: 'Professional & Polished', description: 'Formal, authoritative, business-like' },
  { value: 'balanced', label: 'Balanced', description: 'A mix of friendly and professional' },
];

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'both', label: 'Both' },
];

export default function AIPersonalityForm({
  businessId,
  businessName,
  initialData,
  onNext,
  onBack,
}: AIPersonalityFormProps) {
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const {
    register,
    control,
    handleSubmit,
    watch,
  } = useForm<AIPersonalityData>({
    resolver: zodResolver(aiPersonalitySchema),
    defaultValues: {
      tone: initialData?.tone || 'balanced',
      business_voice: initialData?.business_voice || 'we',
      language: initialData?.language || 'en',
      response_delay_seconds: initialData?.response_delay_seconds ?? 5,
      web_greeting: initialData?.web_greeting || `Hi! I'm ${businessName}'s assistant. Ask me anything about our services.`,
      guardrails: initialData?.guardrails || '',
      booking_enabled: initialData?.booking_enabled ?? false,
      booking_mode: initialData?.booking_mode || 'collect_info',
    },
  });

  const bookingEnabled = watch('booking_enabled');
  const responseDelay = watch('response_delay_seconds');
  const selectedTone = watch('tone');

  const onSubmit = async (data: AIPersonalityData) => {
    setSaving(true);
    setSubmitError('');
    try {
      const supabase = createClient();

      const guardrailLines = data.guardrails
        ? data.guardrails.split('\n').filter((line) => line.trim())
        : [];

      const { error } = await supabase.from('ai_settings').upsert({
        business_id: businessId,
        tone: data.tone,
        business_voice: data.business_voice,
        language: data.language,
        sms_response_delay_seconds: data.response_delay_seconds,
        guardrails: guardrailLines,
        booking_enabled: data.booking_enabled,
        booking_mode: data.booking_enabled ? data.booking_mode : 'collect_info',
      }, { onConflict: 'business_id' });
      if (error) throw error;

      // Save welcome message to widget config
      if (data.web_greeting?.trim()) {
        const { error: widgetError } = await supabase.from('widget_configs').upsert({
          business_id: businessId,
          welcome_message: data.web_greeting,
        }, { onConflict: 'business_id' });
        if (widgetError) {
          console.warn('Failed to save widget welcome message:', widgetError.message);
        }
      }

      const { error: markerError } = await supabase.from('businesses').update({
        onboarding_step: 'legal_verification',
        onboarding_last_saved_at: new Date().toISOString(),
      }).eq('id', businessId);
      if (markerError) {
        // Advisory resume marker only — the data write above succeeded, and
        // the server re-derives the step from saved data on next load.
        console.warn('Failed to update onboarding progress marker:', markerError.message);
      }

      onNext(data);
    } catch {
      setSubmitError('Could not save your AI settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getDelayLabel = (seconds: number) => {
    if (seconds === 0) return 'Instant';
    if (seconds < 60) return `${seconds} seconds`;
    return '1 minute';
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">Customize your AI assistant</h2>

      {/* Tone Selector */}
      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-2">Tone</label>
        <div className="grid grid-cols-3 gap-3">
          {TONE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`cursor-pointer p-4 border-2 rounded-lg text-center transition-colors ${
                selectedTone === opt.value
                  ? 'border-[#ea580c] ring-2 ring-[#ea580c]/25 bg-[#fdf1e7] dark:border-[#ff914d] dark:bg-[rgba(255,145,77,0.10)]'
                  : 'border-[#ece4d8] bg-[#faf7f2] hover:border-[#e3dacc] dark:border-white/[0.10] dark:bg-white/[0.04] dark:hover:border-white/[0.20]'
              }`}
            >
              <input
                type="radio"
                value={opt.value}
                {...register('tone')}
                className="sr-only"
              />
              <p className="font-medium text-sm text-stone-900 dark:text-[#f5f5f5]">{opt.label}</p>
              <p className="text-xs text-stone-500 dark:text-[#bdbdbf] mt-1">{opt.description}</p>
            </label>
          ))}
        </div>
      </div>

      {/* Business Voice */}
      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-2">Business Voice</label>
        <div className="flex gap-3">
          <label className={`flex-1 cursor-pointer p-3 border-2 rounded-lg text-center transition-colors ${
            watch('business_voice') === 'we' ? 'border-[#ea580c] ring-2 ring-[#ea580c]/25 bg-[#fdf1e7] dark:border-[#ff914d] dark:bg-[rgba(255,145,77,0.10)]' : 'border-[#ece4d8] bg-[#faf7f2] hover:border-[#e3dacc] dark:border-white/[0.10] dark:bg-white/[0.04] dark:hover:border-white/[0.20]'
          }`}>
            <input type="radio" value="we" {...register('business_voice')} className="sr-only" />
            <p className="font-medium text-sm text-stone-900 dark:text-[#f5f5f5]">&ldquo;We&rdquo;</p>
            <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">We can help you with...</p>
          </label>
          <label className={`flex-1 cursor-pointer p-3 border-2 rounded-lg text-center transition-colors ${
            watch('business_voice') === 'business_name' ? 'border-[#ea580c] ring-2 ring-[#ea580c]/25 bg-[#fdf1e7] dark:border-[#ff914d] dark:bg-[rgba(255,145,77,0.10)]' : 'border-[#ece4d8] bg-[#faf7f2] hover:border-[#e3dacc] dark:border-white/[0.10] dark:bg-white/[0.04] dark:hover:border-white/[0.20]'
          }`}>
            <input type="radio" value="business_name" {...register('business_voice')} className="sr-only" />
            <p className="font-medium text-sm text-stone-900 dark:text-[#f5f5f5]">&ldquo;{businessName}&rdquo;</p>
            <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">{businessName} can help...</p>
          </label>
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Language</label>
        <select
          {...register('language')}
          className="w-full px-3 py-2 rounded-lg bg-white text-stone-900 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30 focus:outline-none"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Response Delay */}
      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">
          SMS Response Delay: <span className="text-[#c2410c] dark:text-[#ff914d]">{getDelayLabel(responseDelay)}</span>
        </label>
        <Controller
          name="response_delay_seconds"
          control={control}
          render={({ field }) => (
            <input
              type="range"
              min={0}
              max={60}
              step={5}
              value={field.value}
              onChange={(e) => field.onChange(Number(e.target.value))}
              className="w-full h-2 bg-stone-200 dark:bg-white/[0.10] rounded-lg appearance-none cursor-pointer accent-[#ea580c] dark:accent-[#ff914d]"
            />
          )}
        />
        <div className="flex justify-between text-xs text-stone-400 dark:text-[#666] mt-1">
          <span>Instant</span>
          <span>1 minute</span>
        </div>
      </div>

      {/* Widget Welcome Message */}
      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Widget Welcome Message</label>
        <textarea
          {...register('web_greeting')}
          rows={2}
          placeholder="Welcome to our business! How can we help you today?"
          className="w-full px-3 py-2 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30 focus:outline-none resize-none"
        />
        <p className="text-xs text-stone-400 dark:text-[#666] mt-1">The first message visitors see when they open your chat widget.</p>
      </div>

      {/* Guardrails */}
      <div>
        <label className="block text-sm font-medium text-stone-700 dark:text-[#d4d4d8] mb-1">Guardrails</label>
        <textarea
          {...register('guardrails')}
          rows={3}
          placeholder={"Don't give quotes over $500\nDon't promise same-day service\nAlways suggest calling for emergencies"}
          className="w-full px-3 py-2 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30 focus:outline-none resize-none"
        />
        <p className="text-xs text-stone-400 dark:text-[#666] mt-1">One rule per line. These rules guide what your AI can and can&apos;t say.</p>
      </div>

      {/* Booking Toggle */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-stone-700 dark:text-[#d4d4d8]">Enable Appointment Booking</label>
          <Controller
            name="booking_enabled"
            control={control}
            render={({ field }) => (
              <button
                type="button"
                onClick={() => field.onChange(!field.value)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  field.value ? 'bg-[#ea580c] dark:bg-[#ff914d]' : 'bg-stone-200 dark:bg-white/[0.12]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    field.value ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          />
        </div>

        {bookingEnabled && (
          <div className="mt-3 pl-4 border-l-2 border-[#ea580c]/30 dark:border-[#ff914d]/30 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="collect_info" {...register('booking_mode')} className="accent-[#ea580c] dark:accent-[#ff914d]" />
              <div>
                <p className="text-sm font-medium text-stone-700 dark:text-[#d4d4d8]">Collect customer info</p>
                <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">AI gathers details, you confirm the booking</p>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="schedule_direct" {...register('booking_mode')} className="accent-[#ea580c] dark:accent-[#ff914d]" />
              <div>
                <p className="text-sm font-medium text-stone-700 dark:text-[#d4d4d8]">Direct scheduling</p>
                <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">AI books appointments directly on your calendar</p>
                <p className="text-xs text-[#c2410c] dark:text-[#ff914d] mt-1">After setup, connect your Google Calendar in Settings to enable direct booking.</p>
              </div>
            </label>
          </div>
        )}
      </div>

      {submitError && (
        <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
      )}

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className={secondaryCtaClass}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={saving}
          className={primaryCtaInlineClass}
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving...
            </>
          ) : (
            'Next'
          )}
        </button>
      </div>
    </form>
  );
}
