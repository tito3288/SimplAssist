'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { createBrowserClient } from '@/lib/supabase/client';
import type { WidgetConfig, WidgetPosition, LeadCaptureTiming } from '@/types/database';
import { cn } from '@/lib/utils';
import {
  Save,
  Check,
  RotateCcw,
} from 'lucide-react';
import { PulsingDot } from '@/components/ui/pulsing-dot';

const PRESET_COLORS = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#22C55E' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Teal', value: '#14B8A6' },
];

const DEFAULT_WELCOME_MESSAGE =
  'Hi there! 👋 How can we help you today?';

interface FormValues {
  brand_color: string;
  position: WidgetPosition;
  show_logo: boolean;
  logo_url: string;
  welcome_message: string;
  lead_capture_enabled: boolean;
  lead_capture_timing: LeadCaptureTiming;
  is_active: boolean;
}

interface WidgetConfigFormProps {
  config: WidgetConfig;
  onSaved?: () => void;
}

export default function WidgetConfigForm({ config, onSaved }: WidgetConfigFormProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
  } = useForm<FormValues>({
    defaultValues: {
      brand_color: config.brand_color,
      position: config.position,
      show_logo: config.show_logo,
      logo_url: config.logo_url || '',
      welcome_message: config.welcome_message,
      lead_capture_enabled: config.lead_capture_enabled,
      lead_capture_timing: config.lead_capture_timing,
      is_active: config.is_active,
    },
  });

  const brandColor = watch('brand_color');
  const showLogo = watch('show_logo');
  const position = watch('position');
  const welcomeMessage = watch('welcome_message');
  const leadCaptureEnabled = watch('lead_capture_enabled');
  const isActive = watch('is_active');

  const onSubmit = async (data: FormValues) => {
    setSaving(true);
    setSaved(false);
    const supabase = createBrowserClient();

    const { error } = await supabase
      .from('widget_configs')
      .update({
        brand_color: data.brand_color,
        position: data.position,
        show_logo: data.show_logo,
        logo_url: data.logo_url || null,
        welcome_message: data.welcome_message,
        lead_capture_enabled: data.lead_capture_enabled,
        lead_capture_timing: data.lead_capture_timing,
        is_active: data.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id);

    setSaving(false);

    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaved?.();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Section 1: Appearance */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Appearance</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Customize how the chat widget looks on your website.</p>

        <div className="space-y-5">
          {/* Brand color */}
          <div>
            <label className="block text-sm font-medium text-slate-900 dark:text-[#f5f5f5] mb-2">Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                {...register('brand_color')}
                className="h-10 w-10 rounded border border-slate-200 dark:border-white/[0.12] cursor-pointer p-0.5"
              />
              <div className="flex gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.name}
                    onClick={() => setValue('brand_color', color.value)}
                    className={cn(
                      'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                      brandColor === color.value ? 'border-slate-900 dark:border-[#f5f5f5] scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color.value }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="block text-sm font-medium text-slate-900 dark:text-[#f5f5f5] mb-2">Widget Position</label>
            <div className="grid grid-cols-2 gap-3">
              {(['bottom_right', 'bottom_left'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setValue('position', pos)}
                  className={cn(
                    'relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors',
                    position === pos
                      ? 'border-[#ff914d] bg-orange-50 dark:bg-[#ff914d]/10'
                      : 'border-slate-200 dark:border-white/[0.10] hover:border-slate-300 dark:hover:border-white/[0.20]'
                  )}
                >
                  <div className="h-16 w-24 rounded border border-slate-200 dark:border-white/[0.10] bg-white dark:bg-white/[0.06] relative">
                    <div
                      className={cn(
                        'absolute bottom-1 h-4 w-4 rounded-full',
                        pos === 'bottom_right' ? 'right-1' : 'left-1'
                      )}
                      style={{ backgroundColor: brandColor }}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-900 dark:text-[#f5f5f5]">
                    {pos === 'bottom_right' ? 'Bottom Right' : 'Bottom Left'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Show logo toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-900 dark:text-[#f5f5f5]">Show Logo</label>
            <button
              type="button"
              onClick={() => setValue('show_logo', !showLogo)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer',
                showLogo ? 'bg-[#ff914d]' : 'bg-gray-200 dark:bg-white/[0.10]'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform',
                  showLogo ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Logo URL */}
          {showLogo && (
            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-[#f5f5f5] mb-1">Logo URL</label>
              <input
                type="url"
                {...register('logo_url')}
                placeholder="https://example.com/logo.png"
                className="w-full rounded-lg border border-slate-200 dark:bg-white/[0.06] dark:border-white/[0.12] dark:text-[#f5f5f5] dark:placeholder:text-[#666] px-3 py-2 text-sm focus:border-[#ff914d] focus:ring-1 focus:ring-[#ff914d] outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Welcome Message */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Welcome Message</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">The first message visitors see when they open the chat.</p>

        <div className="relative">
          <textarea
            {...register('welcome_message')}
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-slate-200 dark:bg-white/[0.06] dark:border-white/[0.12] dark:text-[#f5f5f5] dark:placeholder:text-[#666] px-3 py-2 text-sm focus:border-[#ff914d] focus:ring-1 focus:ring-[#ff914d] outline-none resize-none"
          />
          <div className="flex items-center justify-between mt-1">
            <button
              type="button"
              onClick={() => setValue('welcome_message', DEFAULT_WELCOME_MESSAGE)}
              className="text-xs text-slate-500 dark:text-[#bdbdbf] hover:text-slate-700 dark:hover:text-[#f5f5f5] flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
            <span className="text-xs text-slate-500 dark:text-[#bdbdbf]">{welcomeMessage.length}/500</span>
          </div>
        </div>
      </div>

      {/* Section 3: Lead Capture */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Lead Capture</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Collect visitor contact information during conversations.</p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-900 dark:text-[#f5f5f5]">Enable Lead Capture</label>
            <button
              type="button"
              onClick={() => setValue('lead_capture_enabled', !leadCaptureEnabled)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer',
                leadCaptureEnabled ? 'bg-[#ff914d]' : 'bg-gray-200 dark:bg-white/[0.10]'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform',
                  leadCaptureEnabled ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {leadCaptureEnabled && (
            <div className="space-y-2 pl-1">
              {([
                { value: 'start' as const, label: 'Ask immediately when chat opens' },
                { value: 'after_3_messages' as const, label: 'Ask after 3 messages' },
                { value: 'on_booking' as const, label: 'Ask only when booking is mentioned' },
              ]).map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-3 cursor-pointer rounded-lg border border-slate-200 dark:border-white/[0.10] px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <input
                    type="radio"
                    value={option.value}
                    {...register('lead_capture_timing')}
                    className="h-4 w-4 text-[#ff914d] border-slate-200 dark:border-white/[0.12] focus:ring-[#ff914d] dark:bg-white/[0.06]"
                  />
                  <span className="text-sm text-slate-500 dark:text-[#bdbdbf]">{option.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Widget Status */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5] mb-1">Widget Status</h2>
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] mb-4">Control whether the widget is visible on your website.</p>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-white/[0.10] p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setValue('is_active', !isActive)}
              className={cn(
                'relative inline-flex h-7 w-14 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer',
                isActive ? 'bg-green-500' : 'bg-gray-200 dark:bg-white/[0.10]'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow ring-0 transition-transform',
                  isActive ? 'translate-x-7' : 'translate-x-0'
                )}
              />
            </button>
            <div>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                  isActive ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-white/[0.06] text-slate-500 dark:text-[#bdbdbf]'
                )}
              >
                {isActive ? 'Active' : 'Inactive'}
              </span>
              {!isActive && (
                <p className="text-xs text-amber-600 mt-1">
                  Deactivating will hide the chat widget from your website
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors',
            saving
              ? 'bg-orange-400 dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] dark:opacity-60 cursor-not-allowed'
              : 'bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600'
          )}
        >
          {saving ? (
            <PulsingDot inline />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
        {saved && (
          <span className="text-sm text-green-600">Settings saved successfully</span>
        )}
      </div>
    </form>
  );
}
