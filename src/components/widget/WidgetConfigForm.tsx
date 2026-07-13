'use client';

import { useState, useRef, useEffect } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useForm } from 'react-hook-form';
import { createBrowserClient } from '@/lib/supabase/client';
import type { WidgetConfig, WidgetPosition, LeadCaptureTiming } from '@/types/database';
import { cn } from '@/lib/utils';
import {
  Save,
  Check,
  RotateCcw,
  Upload,
  Trash2,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { secondaryCtaCompactClass } from '@/lib/glass';
import { statusSuccess, statusNeutral } from '@/lib/theme-v2/theme';

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

export interface WidgetConfigFormValues {
  brand_color: string;
  position: WidgetPosition;
  show_logo: boolean;
  logo_url: string;
  welcome_message: string;
  lead_capture_enabled: boolean;
  lead_capture_timing: LeadCaptureTiming;
  quick_replies: string[];
  is_active: boolean;
}

interface WidgetConfigFormProps {
  config: WidgetConfig;
  onSaved?: () => void;
  /** Fires on mount and whenever the user edits the form — for live preview only; does not persist. */
  onPreviewChange?: (values: WidgetConfigFormValues) => void;
}

function LogoUpload({
  currentUrl,
  businessId,
  onUploaded,
  onRemoved,
}: {
  currentUrl: string;
  businessId: string;
  onUploaded: (url: string) => void;
  onRemoved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("businessId", businessId);

      const res = await fetch("/api/widget/logo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }

      onUploaded(data.url);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-stone-900 dark:text-[#f5f5f5] mb-2">Logo</label>

      {currentUrl ? (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#ece4d8] dark:border-white/[0.12] flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentUrl} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={secondaryCtaCompactClass}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Change
            </button>
            <button
              type="button"
              onClick={onRemoved}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-[#ece4d8] dark:border-white/[0.12] hover:border-[#ea580c] dark:hover:border-[#ff914d]/50 transition-colors cursor-pointer"
        >
          {uploading ? (
            <Loader2 className="w-6 h-6 text-[#c2410c] dark:text-[#ff914d] animate-spin" />
          ) : (
            <Upload className="w-6 h-6 text-stone-400 dark:text-[#666]" />
          )}
          <span className="text-sm text-stone-500 dark:text-[#bdbdbf]">
            {uploading ? "Uploading..." : "Click to upload your logo"}
          </span>
          <span className="text-xs text-stone-400 dark:text-[#666]">PNG, JPG, SVG, or WEBP. Max 2MB.</span>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>}
    </div>
  );
}

export default function WidgetConfigForm({ config, onSaved, onPreviewChange }: WidgetConfigFormProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
  } = useForm<WidgetConfigFormValues>({
    defaultValues: {
      brand_color: config.brand_color,
      position: config.position,
      show_logo: config.show_logo,
      logo_url: config.logo_url || '',
      welcome_message: config.welcome_message,
      lead_capture_enabled: config.lead_capture_enabled,
      lead_capture_timing: config.lead_capture_timing,
      quick_replies: config.quick_replies || [],
      is_active: config.is_active,
    },
  });

  const brandColor = watch('brand_color');
  const showLogo = watch('show_logo');
  const position = watch('position');
  const welcomeMessage = watch('welcome_message');
  const leadCaptureEnabled = watch('lead_capture_enabled');
  const quickReplies = watch('quick_replies');
  const isActive = watch('is_active');

  useEffect(() => {
    if (!onPreviewChange) return;
    const sub = watch((value) => {
      onPreviewChange(value as WidgetConfigFormValues);
    });
    return () => sub.unsubscribe();
  }, [watch, onPreviewChange]);

  const onSubmit = async (data: WidgetConfigFormValues) => {
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
        quick_replies: data.quick_replies.filter(q => q.trim() !== ''),
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
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Appearance</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Customize how the chat widget looks on your website.</p>

        <div className="space-y-5">
          {/* Brand color */}
          <div>
            <label className="block text-sm font-medium text-stone-900 dark:text-[#f5f5f5] mb-2">Brand Color</label>
            <div className="space-y-3">
              <HexColorPicker
                color={brandColor}
                onChange={(color) => setValue('brand_color', color)}
              />

              {/* Hex input + current swatch */}
              <div className="flex items-center gap-3">
                <div
                  className="h-9 w-9 rounded-lg border border-[#ece4d8] dark:border-white/[0.12] flex-shrink-0"
                  style={{ backgroundColor: brandColor }}
                />
                <div className="flex items-center gap-1 rounded-lg border border-[#e3dacc] bg-white dark:border-white/[0.12] dark:bg-white/[0.06] px-3 py-2">
                  <span className="text-sm text-stone-400 dark:text-[#666]">#</span>
                  <HexColorInput
                    color={brandColor}
                    onChange={(color) => setValue('brand_color', color)}
                    className="w-20 bg-transparent text-sm text-stone-900 dark:text-[#f5f5f5] outline-none uppercase tracking-wider"
                  />
                </div>
              </div>

              {/* Preset swatches */}
              <div className="flex gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.name}
                    onClick={() => setValue('brand_color', color.value)}
                    className={cn(
                      'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                      brandColor === color.value ? 'border-stone-900 dark:border-[#f5f5f5] scale-110' : 'border-transparent'
                    )}
                    style={{ backgroundColor: color.value }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="block text-sm font-medium text-stone-900 dark:text-[#f5f5f5] mb-2">Widget Position</label>
            <div className="grid grid-cols-2 gap-3">
              {(['bottom_right', 'bottom_left'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setValue('position', pos)}
                  className={cn(
                    'relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors',
                    position === pos
                      ? 'border-[#ea580c] ring-2 ring-[#ea580c]/25 bg-[#fdf1e7] dark:border-[#ff914d] dark:bg-[rgba(255,145,77,0.10)]'
                      : 'border-[#ece4d8] bg-[#faf7f2] hover:border-[#e0d7c8] dark:border-white/[0.10] dark:bg-white/[0.04] dark:hover:border-white/[0.20]'
                  )}
                >
                  <div className="h-16 w-24 rounded border border-[#ece4d8] dark:border-white/[0.10] bg-white dark:bg-white/[0.06] relative">
                    <div
                      className={cn(
                        'absolute bottom-1 h-4 w-4 rounded-full',
                        pos === 'bottom_right' ? 'right-1' : 'left-1'
                      )}
                      style={{ backgroundColor: brandColor }}
                    />
                  </div>
                  <span className="text-sm font-medium text-stone-900 dark:text-[#f5f5f5]">
                    {pos === 'bottom_right' ? 'Bottom Right' : 'Bottom Left'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Show logo toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-stone-900 dark:text-[#f5f5f5]">Show Logo</label>
            <button
              type="button"
              onClick={() => setValue('show_logo', !showLogo)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer',
                showLogo ? 'bg-[#ea580c] dark:bg-[#ff914d]' : 'bg-stone-200 dark:bg-white/[0.12]'
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

          {/* Logo Upload */}
          {showLogo && (
            <LogoUpload
              currentUrl={watch('logo_url')}
              businessId={config.business_id}
              onUploaded={(url) => setValue('logo_url', url)}
              onRemoved={() => setValue('logo_url', '')}
            />
          )}
        </div>
      </div>

      {/* Section 2: Welcome Message */}
      <div>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Welcome Message</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">The first message visitors see when they open the chat.</p>

        <div className="relative">
          <textarea
            {...register('welcome_message')}
            rows={3}
            maxLength={500}
            className="w-full rounded-lg bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30 px-3 py-2 text-sm outline-none resize-none"
          />
          <div className="flex items-center justify-between mt-1">
            <button
              type="button"
              onClick={() => setValue('welcome_message', DEFAULT_WELCOME_MESSAGE)}
              className="text-xs text-stone-500 dark:text-[#bdbdbf] hover:text-stone-700 dark:hover:text-[#f5f5f5] flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
            <span className="text-xs text-stone-500 dark:text-[#bdbdbf]">{welcomeMessage.length}/500</span>
          </div>
        </div>
      </div>

      {/* Section 3: Quick Reply Buttons */}
      <div>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Quick Reply Buttons</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">
          Suggested questions shown below the welcome message. Visitors can click to start a conversation. Leave empty to hide.
        </p>

        <div className="space-y-3">
          {quickReplies.map((reply, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={reply}
                  onChange={(e) => {
                    const updated = [...quickReplies];
                    updated[index] = e.target.value;
                    setValue('quick_replies', updated);
                  }}
                  maxLength={50}
                  placeholder={`Question ${index + 1}`}
                  className="w-full rounded-lg bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30 px-3 py-2 text-sm outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400 dark:text-[#666] pointer-events-none">
                  {reply.length}/50
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const updated = quickReplies.filter((_, i) => i !== index);
                  setValue('quick_replies', updated);
                }}
                className="p-2 rounded-lg border border-[#ece4d8] dark:border-white/[0.12] text-stone-400 dark:text-[#666] hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-500/30 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}

          {quickReplies.length < 3 && (
            <button
              type="button"
              onClick={() => setValue('quick_replies', [...quickReplies, ''])}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-full border border-dashed border-[#ece4d8] dark:border-white/[0.12] text-stone-500 dark:text-[#bdbdbf] hover:border-[#ea580c] hover:text-[#c2410c] dark:hover:border-[#ff914d]/50 dark:hover:text-[#ff914d] transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add question
            </button>
          )}
        </div>
      </div>

      {/* Section 4: Lead Capture */}
      <div>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Lead Capture</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Collect visitor contact information during conversations.</p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-stone-900 dark:text-[#f5f5f5]">Enable Lead Capture</label>
            <button
              type="button"
              onClick={() => setValue('lead_capture_enabled', !leadCaptureEnabled)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer',
                leadCaptureEnabled ? 'bg-[#ea580c] dark:bg-[#ff914d]' : 'bg-stone-200 dark:bg-white/[0.12]'
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
                  className="flex items-center gap-3 cursor-pointer rounded-lg border border-[#ece4d8] dark:border-white/[0.10] px-4 py-3 hover:bg-[#faf6ef] dark:hover:bg-white/[0.03] transition-colors"
                >
                  <input
                    type="radio"
                    value={option.value}
                    {...register('lead_capture_timing')}
                    className="h-4 w-4 text-[#c2410c] dark:text-[#ff914d] border-[#ece4d8] dark:border-white/[0.12] focus:ring-[#ea580c] dark:focus:ring-[#ff914d] dark:bg-white/[0.06]"
                  />
                  <span className="text-sm text-stone-500 dark:text-[#bdbdbf]">{option.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Widget Status */}
      <div>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5] mb-1">Widget Status</h2>
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] mb-4">Control whether the widget is visible on your website.</p>

        <div className="flex items-center justify-between rounded-lg border border-[#ece4d8] dark:border-white/[0.10] p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setValue('is_active', !isActive)}
              className={cn(
                'relative inline-flex h-7 w-14 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer',
                isActive ? 'bg-green-500' : 'bg-stone-200 dark:bg-white/[0.12]'
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
                  isActive ? statusSuccess : statusNeutral
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
            'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-colors',
            saving
              ? 'bg-[#ea580c]/60 dark:bg-[#ff914d]/50 cursor-not-allowed'
              : 'bg-[#ea580c] hover:bg-[#c2410c] active:bg-[#9a3412] dark:bg-[#ff914d] dark:text-[#16100b] dark:hover:bg-[#f57f33]'
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
