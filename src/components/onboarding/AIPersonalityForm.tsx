'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AITone, BusinessVoice, Language, BookingMode } from '@/types/database';

const aiPersonalitySchema = z.object({
  tone: z.enum(['friendly', 'professional', 'balanced'] as const),
  business_voice: z.enum(['we', 'business_name'] as const),
  language: z.enum(['en', 'es', 'both'] as const),
  response_delay_seconds: z.number().min(0).max(60),
  sms_greeting: z.string().min(1, 'SMS greeting is required'),
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

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AIPersonalityData>({
    resolver: zodResolver(aiPersonalitySchema),
    defaultValues: {
      tone: initialData?.tone || 'balanced',
      business_voice: initialData?.business_voice || 'we',
      language: initialData?.language || 'en',
      response_delay_seconds: initialData?.response_delay_seconds ?? 5,
      sms_greeting: initialData?.sms_greeting || `Hey! Thanks for reaching out to ${businessName}. How can we help?`,
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
        sms_greeting: data.sms_greeting,
        web_chat_greeting: data.web_greeting,
        guardrails: guardrailLines,
        booking_enabled: data.booking_enabled,
        booking_mode: data.booking_enabled ? data.booking_mode : 'collect_info',
      });
      if (error) throw error;
      onNext(data);
    } catch {
      // Silently handle
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
      <h2 className="text-xl font-semibold text-gray-900">Customize your AI assistant</h2>

      {/* Tone Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tone</label>
        <div className="grid grid-cols-3 gap-3">
          {TONE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`cursor-pointer p-4 border-2 rounded-lg text-center transition-colors ${
                selectedTone === opt.value
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                value={opt.value}
                {...register('tone')}
                className="sr-only"
              />
              <p className="font-medium text-sm text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500 mt-1">{opt.description}</p>
            </label>
          ))}
        </div>
      </div>

      {/* Business Voice */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Business Voice</label>
        <div className="flex gap-3">
          <label className={`flex-1 cursor-pointer p-3 border-2 rounded-lg text-center transition-colors ${
            watch('business_voice') === 'we' ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" value="we" {...register('business_voice')} className="sr-only" />
            <p className="font-medium text-sm">&ldquo;We&rdquo;</p>
            <p className="text-xs text-gray-500">We can help you with...</p>
          </label>
          <label className={`flex-1 cursor-pointer p-3 border-2 rounded-lg text-center transition-colors ${
            watch('business_voice') === 'business_name' ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" value="business_name" {...register('business_voice')} className="sr-only" />
            <p className="font-medium text-sm">&ldquo;{businessName}&rdquo;</p>
            <p className="text-xs text-gray-500">{businessName} can help...</p>
          </label>
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
        <select
          {...register('language')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Response Delay */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          SMS Response Delay: <span className="text-blue-600">{getDelayLabel(responseDelay)}</span>
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
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          )}
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>Instant</span>
          <span>1 minute</span>
        </div>
      </div>

      {/* SMS Greeting */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">SMS Greeting</label>
        <textarea
          {...register('sms_greeting')}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
        {errors.sms_greeting && <p className="text-sm text-red-600 mt-1">{errors.sms_greeting.message}</p>}
      </div>

      {/* Web Chat Greeting */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Web Chat Greeting</label>
        <textarea
          {...register('web_greeting')}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
        {errors.web_greeting && <p className="text-sm text-red-600 mt-1">{errors.web_greeting.message}</p>}
      </div>

      {/* Guardrails */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Guardrails</label>
        <textarea
          {...register('guardrails')}
          rows={3}
          placeholder={"Don't give quotes over $500\nDon't promise same-day service\nAlways suggest calling for emergencies"}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">One rule per line. These rules guide what your AI can and can&apos;t say.</p>
      </div>

      {/* Booking Toggle */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Enable Appointment Booking</label>
          <Controller
            name="booking_enabled"
            control={control}
            render={({ field }) => (
              <button
                type="button"
                onClick={() => field.onChange(!field.value)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  field.value ? 'bg-blue-600' : 'bg-gray-300'
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
          <div className="mt-3 pl-4 border-l-2 border-blue-200 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="collect_info" {...register('booking_mode')} className="text-blue-600" />
              <div>
                <p className="text-sm font-medium text-gray-700">Collect customer info</p>
                <p className="text-xs text-gray-500">AI gathers details, you confirm the booking</p>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value="schedule_direct" {...register('booking_mode')} className="text-blue-600" />
              <div>
                <p className="text-sm font-medium text-gray-700">Direct scheduling</p>
                <p className="text-xs text-gray-500">AI books appointments directly on your calendar</p>
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="py-2 px-6 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={saving}
          className="py-2 px-6 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Next'}
        </button>
      </div>
    </form>
  );
}
