'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BusinessType } from '@/types/database';
import type { ServicesAndFaqsValues } from '@/lib/onboarding/servicesAndFaqsDefaults';
import { LockedFeatureCard } from '@/components/entitlements/LockedFeatureCard';
import ServicesAndFaqsForm from '@/components/onboarding/ServicesAndFaqsForm';
import { WebsiteScanLauncher } from '@/components/website-scans/WebsiteScanLauncher';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import {
  cancelWebsiteScan,
  getCurrentWebsiteScan,
  isWebsiteScanReviewable,
  type WebsiteScan,
} from '@/lib/website-scans/client';

export default function WebsiteKnowledgeManager({
  businessId,
  businessType,
  websiteUrl,
  canCustomizeAi,
  planActive,
  initialData,
  initialKnowledge,
}: {
  businessId: string;
  businessType: BusinessType;
  websiteUrl: string | null;
  canCustomizeAi: boolean;
  planActive: boolean;
  initialData: ServicesAndFaqsValues;
  initialKnowledge: {
    kind: 'overview' | 'fact' | 'policy';
    title: string | null;
    content: string;
  }[];
}) {
  const router = useRouter();
  const [scan, setScan] = useState<WebsiteScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [published, setPublished] = useState(false);
  const [scanUrl, setScanUrl] = useState(websiteUrl ?? '');
  const [scanBlocking, setScanBlocking] = useState(false);

  const handleScanChange = useCallback((next: WebsiteScan | null) => {
    setScan(next);
    if (next) setScanUrl((current) => current || next.websiteUrl);
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentWebsiteScan()
      .then((current) => {
        if (!active) return;
        setScan(current);
        if (current) setScanUrl((value) => value || current.websiteUrl);
      })
      .catch(() => {
        // The launcher will still allow a new attempt if resume lookup fails.
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (!canCustomizeAi) {
    return (
      <LockedFeatureCard
        title="Assistant Knowledge customization is paused"
        description={
          planActive
            ? 'Growth lets you rescan your website and publish updated assistant knowledge.'
            : 'Reactivate your subscription to rescan and update assistant knowledge.'
        }
        requiredPlan={planActive ? 'Growth' : null}
        preservedDetail="Your previously approved knowledge stays saved."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-3" role="status">
        <PulsingDot />
        <span className="text-sm text-stone-500 dark:text-[#bdbdbf]">Loading Assistant Knowledge…</span>
      </div>
    );
  }

  if (published) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100">
        <h2 className="font-semibold">Assistant Knowledge updated</h2>
        <p className="mt-1 text-sm opacity-80">Your approved changes are now available to your assistant.</p>
        <button
          type="button"
          onClick={() => {
            setPublished(false);
            setScan(null);
            router.refresh();
          }}
          className="mt-3 text-sm font-medium underline underline-offset-2"
        >
          Return to Assistant Knowledge
        </button>
      </div>
    );
  }

  if (isWebsiteScanReviewable(scan)) {
    return (
      <ServicesAndFaqsForm
        businessId={businessId}
        businessType={businessType}
        initialData={initialData}
        websiteScan={scan}
        mode="settings"
        onDiscardScan={async () => {
          await cancelWebsiteScan(scan.id);
          setScan(null);
        }}
        onNext={() => {
          setPublished(true);
          router.refresh();
        }}
      />
    );
  }

  const overview = initialKnowledge.find((item) => item.kind === 'overview');
  const supportingKnowledge = initialKnowledge.filter((item) => item.kind !== 'overview');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">Assistant Knowledge</h1>
        <p className="mt-1 text-stone-500 dark:text-[#bdbdbf]">
          Keep your assistant’s business briefing, services, FAQs, facts, and policies accurate.
        </p>
      </div>

      <div>
        <label htmlFor="knowledge-scan-url" className="mb-1 block text-sm font-medium text-stone-700 dark:text-[#d4d4d8]">
          Website to scan
        </label>
        <input
          id="knowledge-scan-url"
          type="url"
          value={scanUrl}
          disabled={scanBlocking}
          onChange={(event) => setScanUrl(event.target.value)}
          placeholder="https://www.example.com"
          className="w-full rounded-[22px] border border-[#e3dacc] bg-white px-3 py-2 text-stone-900 placeholder:text-stone-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5]"
        />
        <WebsiteScanLauncher
          url={scanUrl}
          trigger="settings"
          onScanChange={handleScanChange}
          onBlockingChange={setScanBlocking}
        />
        {scan?.createdAt && !isWebsiteScanReviewable(scan) && (
          <p className="mt-2 text-xs text-stone-500 dark:text-[#888]">
            Latest scan: {new Date(scan.createdAt).toLocaleDateString()} ·{' '}
            {scan.status.replaceAll('_', ' ')} · {scan.pageCount} page{scan.pageCount === 1 ? '' : 's'} read
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[#e3dacc] bg-white p-5 dark:border-white/[0.12] dark:bg-white/[0.04]">
        <h2 className="font-semibold text-stone-900 dark:text-[#f5f5f5]">Current approved knowledge</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          {initialData.services.length} service{initialData.services.length === 1 ? '' : 's'} and{' '}
          {initialData.faqs.length} FAQ{initialData.faqs.length === 1 ? '' : 's'} are currently saved.
          {supportingKnowledge.length > 0 && ` ${supportingKnowledge.length} additional fact${supportingKnowledge.length === 1 ? '' : 's'} or policies are also active.`}
          A rescan never removes or overwrites these without your approval.
        </p>
        {overview && (
          <div className="mt-4 rounded-xl bg-stone-50 p-4 dark:bg-white/[0.04]">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Business briefing</p>
            <p className="mt-1 text-sm leading-6 text-stone-700 dark:text-[#d4d4d8]">{overview.content}</p>
          </div>
        )}
        {supportingKnowledge.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {supportingKnowledge.map((item, index) => (
              <article key={`${item.kind}-${item.title ?? index}`} className="rounded-xl border border-[#ece4d8] p-3 dark:border-white/[0.10]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  {item.kind}
                </p>
                {item.title && <h3 className="mt-1 text-sm font-semibold text-stone-900 dark:text-[#f5f5f5]">{item.title}</h3>}
                <p className="mt-1 text-sm leading-5 text-stone-600 dark:text-[#bdbdbf]">{item.content}</p>
              </article>
            ))}
          </div>
        )}
        <a href="/settings" className="mt-3 mr-4 inline-block text-sm font-medium text-[var(--brand-accent)] hover:underline dark:text-[var(--brand-accent-dark)]">
          Edit services and FAQs
        </a>
        <a href="/knowledge-gaps" className="mt-3 inline-block text-sm font-medium text-[var(--brand-accent)] hover:underline dark:text-[var(--brand-accent-dark)]">
          Review ongoing Knowledge Gaps
        </a>
      </div>
    </div>
  );
}
