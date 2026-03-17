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
          <h2 className="text-lg font-semibold text-gray-900">Live Preview</h2>
          <p className="text-sm text-gray-500">See how your widget looks to visitors.</p>
        </div>
        <button
          onClick={() => window.open(previewUrl, '_blank')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Open in New Tab
        </button>
      </div>

      {/* Browser window chrome */}
      <div className="rounded-lg border border-gray-300 overflow-hidden shadow-sm">
        {/* URL bar */}
        <div className="flex items-center gap-2 bg-gray-100 border-b border-gray-300 px-3 py-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-yellow-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 rounded-md bg-white border border-gray-200 px-3 py-1 text-xs text-gray-500 font-mono">
            yourwebsite.com
          </div>
        </div>

        {/* iframe */}
        <iframe
          key={refreshKey}
          src={previewUrl}
          title="Widget Preview"
          className="w-full border-0 bg-white"
          style={{ height: 400 }}
        />
      </div>
    </div>
  );
}
