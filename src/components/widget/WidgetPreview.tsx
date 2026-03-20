'use client';

import { ExternalLink } from 'lucide-react';

interface WidgetPreviewProps {
  businessId: string;
  refreshKey?: number;
}

export default function WidgetPreview({ businessId, refreshKey = 0 }: WidgetPreviewProps) {
  const previewUrl = `/widget/preview?businessId=${businessId}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[#f5f5f5]">Live Preview</h2>
          <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">See how your widget looks to visitors.</p>
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
          src={previewUrl}
          title="Widget Preview"
          className="w-full border-0 bg-white dark:bg-white/[0.03] h-[300px] sm:h-[400px]"
        />
      </div>
    </div>
  );
}
