'use client';

import { useState } from 'react';
import type { WidgetConfig } from '@/types/database';
import WidgetConfigForm from '@/components/widget/WidgetConfigForm';
import WidgetPreview from '@/components/widget/WidgetPreview';
import EmbedCodeGenerator from '@/components/widget/EmbedCodeGenerator';

interface WidgetPageClientProps {
  config: WidgetConfig;
  businessId: string;
  businessName: string;
}

export default function WidgetPageClient({ config, businessId }: WidgetPageClientProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Website Chat Widget</h1>
        <p className="mt-1 text-gray-600">Configure and embed a chat assistant on your website</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column — config form */}
        <div className="lg:col-span-3 bg-white rounded-lg border border-gray-200 p-6">
          <WidgetConfigForm
            config={config}
            onSaved={() => setRefreshKey((k) => k + 1)}
          />
        </div>

        {/* Right column — preview + embed code */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <WidgetPreview businessId={businessId} refreshKey={refreshKey} />
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <EmbedCodeGenerator businessId={businessId} />
          </div>
        </div>
      </div>
    </div>
  );
}
