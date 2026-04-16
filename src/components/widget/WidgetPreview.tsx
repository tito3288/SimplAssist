'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import type { WidgetConfigFormValues } from '@/components/widget/WidgetConfigForm';

const PREVIEW_MSG_SOURCE = 'simplassist-widget-preview';
const PREVIEW_MSG_TYPE = 'apply-preview';

interface WidgetPreviewProps {
  businessId: string;
  refreshKey?: number;
  /** Current form values for live preview (not persisted until Save). */
  preview: WidgetConfigFormValues;
}

function buildPreviewPayload(values: WidgetConfigFormValues) {
  return {
    brandColor: values.brand_color,
    position: values.position,
    showLogo: values.show_logo,
    logoUrl: values.logo_url || '',
    welcomeMessage: values.welcome_message,
    leadCaptureEnabled: values.lead_capture_enabled,
    leadCaptureTiming: values.lead_capture_timing,
    quickReplies: values.quick_replies.filter(q => q.trim() !== ''),
  };
}

export default function WidgetPreview({ businessId, refreshKey = 0, preview }: WidgetPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewUrl = `/widget/preview?businessId=${encodeURIComponent(businessId)}`;

  const pushPreview = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        source: PREVIEW_MSG_SOURCE,
        type: PREVIEW_MSG_TYPE,
        payload: buildPreviewPayload(preview),
      },
      '*'
    );
  }, [preview]);

  useEffect(() => {
    pushPreview();
  }, [pushPreview]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5]">Live Preview</h2>
          <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">
            Updates as you edit — save to apply on your live site.
          </p>
        </div>
        <button
          onClick={() => window.open(previewUrl, '_blank')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/[0.10] px-3 py-1.5 text-sm font-medium text-slate-500 dark:text-[#bdbdbf] hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Open in New Tab
        </button>
      </div>

      {/* Browser window chrome */}
      <div className="rounded-lg border border-slate-200 dark:border-white/[0.10] overflow-hidden shadow-sm">
        {/* URL bar */}
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/[0.10] px-3 py-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-yellow-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 rounded-md bg-white dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.12] px-3 py-1 text-xs text-slate-500 dark:text-[#bdbdbf] font-mono">
            yourwebsite.com
          </div>
        </div>

        {/* iframe */}
        <iframe
          key={refreshKey}
          ref={iframeRef}
          src={previewUrl}
          title="Widget Preview"
          onLoad={pushPreview}
          className="w-full border-0 bg-white dark:bg-white/[0.03] h-[300px] sm:h-[400px]"
        />
      </div>
    </div>
  );
}
