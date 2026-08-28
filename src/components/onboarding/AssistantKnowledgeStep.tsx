'use client';

import { useEffect, useState } from 'react';
import type { BusinessType } from '@/types/database';
import type { ServicesAndFaqsValues } from '@/lib/onboarding/servicesAndFaqsDefaults';
import type { ServicesAndFaqsData } from '@/lib/onboarding/servicesAndFaqsSubmission';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import ServicesAndFaqsForm from '@/components/onboarding/ServicesAndFaqsForm';
import {
  cancelWebsiteScan,
  getCurrentWebsiteScan,
  isWebsiteScanReviewable,
  type WebsiteScan,
} from '@/lib/website-scans/client';

export default function AssistantKnowledgeStep({
  businessId,
  businessType,
  initialData,
  scrapedServices,
  scrapedFaqs,
  onNext,
  onBack,
  richerScanEnabled,
}: {
  businessId: string;
  businessType: BusinessType;
  initialData?: ServicesAndFaqsValues;
  scrapedServices?: { name: string; description?: string; price?: string }[];
  scrapedFaqs?: { question: string; answer: string }[];
  onNext: (data: ServicesAndFaqsData) => void;
  onBack: () => void;
  richerScanEnabled: boolean;
}) {
  const [scan, setScan] = useState<WebsiteScan | null>(null);
  const [loading, setLoading] = useState(richerScanEnabled);
  const [discardedScan, setDiscardedScan] = useState(false);

  useEffect(() => {
    if (!richerScanEnabled) {
      setScan(null);
      setLoading(false);
      return;
    }
    let active = true;
    getCurrentWebsiteScan()
      .then((current) => active && setScan(current))
      .catch(() => {
        // Manual setup remains the fallback when scan state is unavailable.
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [richerScanEnabled]);

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-3" role="status">
        <PulsingDot />
        <span className="text-sm text-stone-500 dark:text-[#bdbdbf]">Loading your knowledge draft…</span>
      </div>
    );
  }

  return (
    <ServicesAndFaqsForm
      key={isWebsiteScanReviewable(scan) ? scan.id : 'manual'}
      businessId={businessId}
      businessType={businessType}
      initialData={initialData}
      scrapedServices={discardedScan ? undefined : scrapedServices}
      scrapedFaqs={discardedScan ? undefined : scrapedFaqs}
      websiteScan={isWebsiteScanReviewable(scan) ? scan : undefined}
      onDiscardScan={isWebsiteScanReviewable(scan) ? async () => {
        await cancelWebsiteScan(scan.id);
        setDiscardedScan(true);
        setScan(null);
      } : undefined}
      onNext={onNext}
      onBack={onBack}
    />
  );
}
