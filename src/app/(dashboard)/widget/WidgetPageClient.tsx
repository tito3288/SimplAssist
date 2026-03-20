'use client';

import { useState } from 'react';
import type { WidgetConfig } from '@/types/database';
import WidgetConfigForm from '@/components/widget/WidgetConfigForm';
import WidgetPreview from '@/components/widget/WidgetPreview';
import EmbedCodeGenerator from '@/components/widget/EmbedCodeGenerator';
import { glassCard } from '@/lib/glass';

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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-[#f5f5f5]">Website Chat Widget</h1>
        <p className="mt-1 text-slate-500 dark:text-[#bdbdbf]">Configure and embed a chat assistant on your website</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column — config form */}
        <div className={`lg:col-span-3 p-6 ${glassCard}`}>
          <WidgetConfigForm
            config={config}
            onSaved={() => setRefreshKey((k) => k + 1)}
          />
        </div>

        {/* Right column — preview + embed code */}
        <div className="lg:col-span-2 space-y-6">
          <div className={`p-6 ${glassCard}`}>
            <WidgetPreview businessId={businessId} refreshKey={refreshKey} />
          </div>
          <div className={`p-6 ${glassCard}`}>
            <EmbedCodeGenerator businessId={businessId} />
          </div>
        </div>
      </div>
    </div>
  );
}
