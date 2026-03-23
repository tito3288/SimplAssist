'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { X } from 'lucide-react';
import type { AISettings } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import GoogleCalendarConnect from './GoogleCalendarConnect';

const aiSettingsSchema = z.object({
  tone: z.enum(['friendly', 'professional', 'balanced'] as const),
  business_voice: z.enum(['we', 'business_name'] as const),
  language: z.enum(['en', 'es', 'both'] as const),
  sms_response_delay_seconds: z.number().min(0).max(60),
  sms_greeting: z.string().min(1, 'SMS greeting is required'),
  web_chat_greeting: z.string().min(1, 'Web chat greeting is required'),
  guardrails_text: z.string().optional(),
  booking_enabled: z.boolean(),
  booking_mode: z.enum(['collect_info', 'schedule_direct'] as const),
});

type AISettingsData = z.infer<typeof aiSettingsSchema>;

const TONE_OPTIONS = [
  { value: 'friendly' as const, label: 'Friendly & Casual', description: 'Warm, approachable, uses casual language' },
  { value: 'professional' as const, label: 'Professional & Polished', description: 'Formal, authoritative, business-like' },
  { value: 'balanced' as const, label: 'Balanced', description: 'A mix of friendly and professional' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en' as const, label: 'English' },
  { value: 'es' as const, label: 'Spanish' },
  { value: 'both' as const, label: 'Both' },
];

interface AISettingsFormProps {
  settings: AISettings;
  businessName: string;
  calendarEmail?: string | null;
  businessId?: string;
}

export default function AISettingsForm({ settings, businessName, calendarEmail = null, businessId }: AISettingsFormProps) {
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [guardrails, setGuardrails] = useState<string[]>(settings.guardrails || []);

  const defaultSmsGreeting = `Hey! Thanks for reaching out to ${businessName}. How can we help?`;
  const defaultWebGreeting = `Hi! I'm ${businessName}'s assistant. Ask me anything about our services.`;

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AISettingsData>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: {
      tone: settings.tone,
      business_voice: settings.business_voice,
      language: settings.language,
      sms_response_delay_seconds: settings.sms_response_delay_seconds,
      sms_greeting: settings.sms_greeting,
      web_chat_greeting: settings.web_chat_greeting,
      guardrails_text: '',
      booking_enabled: settings.booking_enabled,
      booking_mode: settings.booking_mode,
    },
  });

  const bookingEnabled = watch('booking_enabled');
  const bookingMode = watch('booking_mode');
  const responseDelay = watch('sms_response_delay_seconds');
  const selectedTone = watch('tone');
  const smsGreeting = watch('sms_greeting');
  const webGreeting = watch('web_chat_greeting');

  const addGuardrail = (text: string) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      setGuardrails((prev) => [...prev, ...lines]);
      setValue('guardrails_text', '');
    }
  };

  const removeGuardrail = (index: number) => {
    setGuardrails((prev) => prev.filter((_, i) => i !== index));
  };

  const getDelayLabel = (seconds: number) => {
    if (seconds === 0) return 'Instant';
    if (seconds < 60) return `${seconds} seconds`;
    return '1 minute';
  };

  const onSubmit = async (data: AISettingsData) => {
    setSaving(true);
    setSuccess(false);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('ai_settings')
        .update({
          tone: data.tone,
          business_voice: data.business_voice,
          language: data.language,
          sms_response_delay_seconds: data.sms_response_delay_seconds,
          sms_greeting: data.sms_greeting,
          web_chat_greeting: data.web_chat_greeting,
          guardrails: guardrails,
          booking_enabled: data.booking_enabled,
          booking_mode: data.booking_enabled ? data.booking_mode : 'collect_info',
        })
        .eq('id', settings.id);
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      // Handle silently
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Section 1: Tone & Voice */}
      <section>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Tone & Voice</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">How your AI assistant communicates with customers.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf] mb-2">Tone</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TONE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`cursor-pointer p-4 border-2 rounded-lg text-center transition-colors ${
                    selectedTone === opt.value
                      ? 'border-[#ff914d] bg-orange-50 dark:bg-white/[0.08]'
                      : 'border-slate-200 dark:border-white/[0.12] hover:border-slate-300 dark:hover:border-white/[0.20]'
                  }`}
                >
                  <input type="radio" value={opt.value} {...register('tone')} className="sr-only" />
                  <p className="font-medium text-sm text-slate-900 dark:text-[#f5f5f5]">{opt.label}</p>
                  <p className="text-xs text-slate-500 dark:text-[#bdbdbf] mt-1">{opt.description}</p>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf] mb-2">Business Voice</label>
            <div className="flex gap-3">
              <label
                className={`flex-1 cursor-pointer p-3 border-2 rounded-lg text-center transition-colors ${
                  watch('business_voice') === 'we' ? 'border-[#ff914d] bg-orange-50 dark:bg-white/[0.08]' : 'border-slate-200 dark:border-white/[0.12] hover:border-slate-300 dark:hover:border-white/[0.20]'
                }`}
              >
                <input type="radio" value="we" {...register('business_voice')} className="sr-only" />
                <p className="font-medium text-sm text-slate-900 dark:text-[#f5f5f5]">&ldquo;We&rdquo;</p>
                <p className="text-xs text-slate-500 dark:text-[#bdbdbf]">We can help you with...</p>
              </label>
              <label
                className={`flex-1 cursor-pointer p-3 border-2 rounded-lg text-center transition-colors ${
                  watch('business_voice') === 'business_name' ? 'border-[#ff914d] bg-orange-50 dark:bg-white/[0.08]' : 'border-slate-200 dark:border-white/[0.12] hover:border-slate-300 dark:hover:border-white/[0.20]'
                }`}
              >
                <input type="radio" value="business_name" {...register('business_voice')} className="sr-only" />
                <p className="font-medium text-sm text-slate-900 dark:text-[#f5f5f5]">&ldquo;{businessName}&rdquo;</p>
                <p className="text-xs text-slate-500 dark:text-[#bdbdbf]">{businessName} can help...</p>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf] mb-1">Language</label>
            <select
              {...register('language')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Section 2: Greetings */}
      <section>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Greetings</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">The first message customers see when they reach out.</p>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf]">SMS Greeting</label>
              <span className="text-xs text-slate-400 dark:text-[#666]">{smsGreeting.length} characters</span>
            </div>
            <textarea
              {...register('sms_greeting')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d] resize-none"
            />
            {errors.sms_greeting && <p className="text-sm text-red-600 mt-1">{errors.sms_greeting.message}</p>}
            <button
              type="button"
              onClick={() => setValue('sms_greeting', defaultSmsGreeting)}
              className="text-xs text-[#ff914d] hover:text-[#e07a3a] mt-1"
            >
              Reset to default
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf]">Web Chat Greeting</label>
              <span className="text-xs text-slate-400 dark:text-[#666]">{webGreeting.length} characters</span>
            </div>
            <textarea
              {...register('web_chat_greeting')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d] resize-none"
            />
            {errors.web_chat_greeting && <p className="text-sm text-red-600 mt-1">{errors.web_chat_greeting.message}</p>}
            <button
              type="button"
              onClick={() => setValue('web_chat_greeting', defaultWebGreeting)}
              className="text-xs text-[#ff914d] hover:text-[#e07a3a] mt-1"
            >
              Reset to default
            </button>
          </div>
        </div>
      </section>

      {/* Section 3: Response Behavior */}
      <section>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Response Behavior</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Control how quickly your AI responds to SMS messages.</p>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-[#bdbdbf] mb-1">
            SMS Response Delay: <span className="text-[#ff914d]">{getDelayLabel(responseDelay)}</span>
          </label>
          <Controller
            name="sms_response_delay_seconds"
            control={control}
            render={({ field }) => (
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={field.value}
                onChange={(e) => field.onChange(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-white/[0.10] rounded-lg appearance-none cursor-pointer accent-[#ff914d]"
              />
            )}
          />
          <div className="flex justify-between text-xs text-slate-400 dark:text-[#666] mt-1">
            <span>Instant</span>
            <span>1 minute</span>
          </div>
        </div>
      </section>

      {/* Section 4: Booking */}
      <section>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Booking</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Let your AI handle appointment scheduling.</p>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700 dark:text-[#bdbdbf]">Enable Appointment Booking</label>
          <Controller
            name="booking_enabled"
            control={control}
            render={({ field }) => (
              <button
                type="button"
                onClick={() => field.onChange(!field.value)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  field.value ? 'bg-[#ff914d]' : 'bg-gray-300 dark:bg-white/[0.12]'
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
          <>
            <div className="mt-3 pl-4 border-l-2 border-[#ff914d]/30 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="collect_info" {...register('booking_mode')} className="text-[#ff914d] accent-[#ff914d]" />
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-[#bdbdbf]">Collect customer info</p>
                  <p className="text-xs text-slate-500 dark:text-[#666]">AI gathers details, you confirm the booking</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="schedule_direct" {...register('booking_mode')} className="text-[#ff914d] accent-[#ff914d]" />
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-[#bdbdbf]">Direct scheduling</p>
                  <p className="text-xs text-slate-500 dark:text-[#666]">AI books appointments directly on your calendar</p>
                </div>
              </label>
            </div>

            {/* Google Calendar Connection - inline, only when Direct scheduling selected */}
            {businessId && bookingMode === 'schedule_direct' && (
              <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/[0.08]">
                <p className="text-sm font-medium text-slate-900 dark:text-[#f5f5f5] mb-2">Google Calendar</p>
                <GoogleCalendarConnect
                  businessId={businessId}
                  connectedEmail={calendarEmail ?? null}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* Section 5: Guardrails */}
      <section>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Guardrails</h3>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Rules that guide what your AI can and can&apos;t say.</p>

        {guardrails.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {guardrails.map((rule, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-white/[0.08] text-slate-700 dark:text-[#bdbdbf] text-sm rounded-full"
              >
                {rule}
                <button
                  type="button"
                  onClick={() => removeGuardrail(index)}
                  className="text-slate-400 dark:text-[#666] hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          {...register('guardrails_text')}
          rows={3}
          placeholder={"Don't give quotes over $500\nDon't promise same-day service\nAlways suggest calling for emergencies"}
          className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d] resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const target = e.target as HTMLTextAreaElement;
              if (target.value.trim()) {
                addGuardrail(target.value);
              }
            }
          }}
        />
        <p className="text-xs text-slate-400 dark:text-[#666] mt-1">Type a rule and press Enter, or add multiple rules (one per line).</p>
        <button
          type="button"
          onClick={() => {
            const text = watch('guardrails_text');
            if (text?.trim()) addGuardrail(text);
          }}
          className="text-xs text-[#ff914d] hover:text-[#e07a3a] mt-1"
        >
          + Add rules
        </button>
      </section>

      {/* Save */}
      <div className="flex items-center gap-4 pt-4 border-t dark:border-white/[0.10]">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 py-2 px-6 bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] font-medium rounded-lg shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 dark:hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving…
            </>
          ) : (
            'Save Settings'
          )}
        </button>
        {success && (
          <span className="text-sm text-green-600 dark:text-green-400 font-medium">Settings saved successfully!</span>
        )}
      </div>
    </form>
  );
}
