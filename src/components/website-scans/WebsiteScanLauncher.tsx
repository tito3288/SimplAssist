'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCcw, ScanSearch, X } from 'lucide-react';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import {
  cancelWebsiteScan,
  createWebsiteScanRequestId,
  createWebsiteScan,
  getCurrentWebsiteScan,
  getWebsiteScan,
  isWebsiteScanReviewable,
  isWebsiteScanRunning,
  retryWebsiteScan,
  type ScanTrigger,
  type WebsiteScan,
} from '@/lib/website-scans/client';

type WebsiteScanLauncherProps = {
  url: string;
  trigger: ScanTrigger;
  onScanChange?: (scan: WebsiteScan | null) => void;
  onBlockingChange?: (blocking: boolean) => void;
  compact?: boolean;
};

function stageLabel(scan: WebsiteScan): string {
  if (scan.progress?.message) return scan.progress.message;
  switch (scan.status) {
    case 'queued':
      return 'Waiting for the scanner…';
    case 'discovering':
      return 'Finding the most useful pages…';
    case 'crawling':
      return 'Reading your website…';
    case 'extracting':
      return 'Drafting your assistant knowledge…';
    default:
      return 'Preparing your website scan…';
  }
}

export function WebsiteScanLauncher({
  url,
  trigger,
  onScanChange,
  onBlockingChange,
  compact = false,
}: WebsiteScanLauncherProps) {
  const [scan, setScan] = useState<WebsiteScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const startRequestRef = useRef({ url, key: createWebsiteScanRequestId() });
  if (startRequestRef.current.url !== url) {
    startRequestRef.current = { url, key: createWebsiteScanRequestId() };
  }

  const updateScan = useCallback(
    (next: WebsiteScan | null) => {
      if (!mounted.current) return;
      setScan(next);
      onScanChange?.(next);
      onBlockingChange?.(Boolean(next && isWebsiteScanRunning(next.status)));
    },
    [onBlockingChange, onScanChange]
  );

  useEffect(() => {
    mounted.current = true;
    getCurrentWebsiteScan()
      .then(updateScan)
      .catch(() => {
        // The scan is optional during onboarding. A failed resume check should
        // never stop an owner from continuing manually.
      })
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, [updateScan]);

  useEffect(() => {
    if (!scan || !isWebsiteScanRunning(scan.status)) return;
    const timeout = window.setTimeout(() => {
      getWebsiteScan(scan.id)
        .then((next) => {
          setError(null);
          updateScan(next);
        })
        .catch(() => {
          setError('Progress could not be refreshed. We will keep trying.');
          // A new object schedules the next bounded poll without losing the
          // last known progress shown to the owner.
          setScan((current) => (current ? { ...current } : current));
        });
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, [scan, updateScan]);

  async function start() {
    setWorking(true);
    setError(null);
    try {
      const started = await createWebsiteScan({
          url,
          trigger,
          clientRequestId: startRequestRef.current.key,
        });
      updateScan(started);
      startRequestRef.current = { url, key: createWebsiteScanRequestId() };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the website scan.');
    } finally {
      setWorking(false);
    }
  }

  async function cancelAndContinue() {
    if (!scan || !isWebsiteScanRunning(scan.status)) return;
    setWorking(true);
    setError(null);
    try {
      await cancelWebsiteScan(scan.id);
      updateScan(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop the scan.');
    } finally {
      setWorking(false);
    }
  }

  async function retry() {
    if (!scan) return;
    setWorking(true);
    setError(null);
    try {
      updateScan(await retryWebsiteScan(scan.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not retry the scan.');
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-stone-500" role="status">
        <PulsingDot inline /> Checking for an existing scan…
      </div>
    );
  }

  if (!url && !scan) return null;

  const running = Boolean(scan && isWebsiteScanRunning(scan.status));
  const reviewable = isWebsiteScanReviewable(scan);
  const canStartNew =
    !scan || ['published', 'cancelled', 'discarded', 'superseded'].includes(scan.status);

  return (
    <div className={`${compact ? 'mt-3' : 'mt-4'} space-y-3`}>
      {canStartNew && (
        <div className="rounded-2xl border border-[#e3dacc] bg-[#faf7f2] p-4 dark:border-white/[0.12] dark:bg-white/[0.04]">
          <div className="flex items-start gap-3">
            <ScanSearch className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-900 dark:text-[#f5f5f5]">
                Let AI draft your business knowledge
              </p>
              <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-[#bdbdbf]">
                We’ll review several public pages and draft a summary, services,
                FAQs, facts, and policies. This usually takes 1–2 minutes, and
                you approve everything before your assistant can use it.
              </p>
              <button
                type="button"
                onClick={start}
                disabled={working || !url}
                className="mt-3 rounded-full bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--brand-primary-dark)] dark:text-[#16100b]"
              >
                {working ? 'Starting…' : 'Scan website & draft knowledge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {running && scan && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-100">
          <div className="flex items-start gap-3">
            <PulsingDot inline />
            <div className="min-w-0 flex-1" role="status" aria-live="polite">
              <p className="text-sm font-semibold">{stageLabel(scan)}</p>
              <p className="mt-1 text-xs opacity-80">
                {scan.progress?.total
                  ? `${scan.progress.completed ?? 0} of ${scan.progress.total} pages processed. `
                  : ''}
                You can safely refresh this page—your progress is saved.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelAndContinue}
              disabled={working}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-blue-300/30"
            >
              <X className="h-3.5 w-3.5" /> Stop scan &amp; continue manually
            </button>
          </div>
        </div>
      )}

      {reviewable && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-100">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Your knowledge draft is ready</p>
              <p className="mt-1 text-xs opacity-80">
                We read {scan.pageCount} page{scan.pageCount === 1 ? '' : 's'} and found{' '}
                {scan.draft.services.length} services and {scan.draft.faqs.length} FAQs.
                You’ll review them in Assistant Knowledge.
              </p>
              {scan.coverage === 'partial' && (
                <p className="mt-2 text-xs font-medium">
                  Some pages could not be read. Review the draft carefully and add anything missing.
                </p>
              )}
              {scan.coverage === 'insufficient' && (
                <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                  We found very little usable content. Treat this as a starting point and fill in missing details manually.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {scan?.status === 'failed' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">We couldn’t finish this scan</p>
              <p className="mt-1 text-xs opacity-80">
                {scan.error?.message || 'Your website may be blocking automated readers.'}
                {' '}You can retry or continue by entering your information manually.
              </p>
              <button
                type="button"
                onClick={retry}
                disabled={working}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-amber-300/30"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> {working ? 'Retrying…' : 'Retry scan'}
              </button>
              {url.trim() && url.trim() !== scan.websiteUrl && (
                <button
                  type="button"
                  onClick={start}
                  disabled={working}
                  className="ml-3 mt-3 text-xs font-medium underline underline-offset-2 disabled:opacity-50"
                >
                  Scan the updated URL instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
