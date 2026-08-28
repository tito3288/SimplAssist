import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelWebsiteScan,
  createWebsiteScanRequestId,
  createWebsiteScan,
  getCurrentWebsiteScan,
  getWebsiteScan,
  isWebsiteScanReviewable,
  isWebsiteScanRunning,
  publishWebsiteScan,
  retryWebsiteScan,
  saveWebsiteScanReview,
  WebsiteScanClientError,
  type WebsiteScan,
  type WebsiteScanReviewDraft,
} from './client';

const draft: WebsiteScanReviewDraft = {
  overview: 'A local repair shop.',
  services: [],
  faqs: [],
  knowledgeItems: [],
  questions: [],
};

const scan: WebsiteScan = {
  id: 'scan-1',
  websiteUrl: 'https://example.com',
  status: 'ready_for_review',
  coverage: 'complete',
  version: 3,
  pageCount: 4,
  failedPageCount: 0,
  draft,
};

afterEach(() => vi.unstubAllGlobals());

describe('website scan client', () => {
  it('always creates a UUID suitable for database idempotency keys', () => {
    expect(createWebsiteScanRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('starts an onboarding scan with the idempotent client request id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scan }), { status: 202 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(createWebsiteScan({
      url: 'https://example.com',
      trigger: 'onboarding',
      clientRequestId: 'request-1',
    })).resolves.toEqual(scan);
    expect(fetchMock).toHaveBeenCalledWith('/api/website-scans', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        url: 'https://example.com',
        trigger: 'onboarding',
        clientRequestId: 'request-1',
      }),
    }));
  });

  it('supports wrapped current-scan responses and an empty current scan', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: scan })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ scan: null })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentWebsiteScan()).resolves.toEqual(scan);
    await expect(getCurrentWebsiteScan()).resolves.toBeNull();
  });

  it('sends optimistic versions for autosave and publish', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ scan })));
    vi.stubGlobal('fetch', fetchMock);

    await saveWebsiteScanReview({ scanId: scan.id, expectedVersion: 3, draft });
    await publishWebsiteScan({
      scanId: scan.id,
      expectedVersion: 4,
      idempotencyKey: 'publish-1',
      draft,
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/website-scans/scan-1/review');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedVersion: 3, draft });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/website-scans/scan-1/publish');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      expectedVersion: 4,
      idempotencyKey: 'publish-1',
      draft,
    });
  });

  it('uses the cancel action and exposes safe server errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ scan })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Too many scans today.' }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await cancelWebsiteScan(scan.id);
    await expect(getCurrentWebsiteScan()).rejects.toEqual(
      expect.objectContaining<Partial<WebsiteScanClientError>>({
        message: 'Too many scans today.',
        status: 429,
      })
    );
  });

  it('loads a specific scan and retries a failed run through scoped action routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scan }))
    );
    vi.stubGlobal('fetch', fetchMock);

    await getWebsiteScan(scan.id);
    await retryWebsiteScan(scan.id);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/website-scans/scan-1');
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/website-scans/scan-1/retry',
      expect.objectContaining({ method: 'POST' }),
    ]);
  });

  it('classifies running and reviewable states without treating drafts as published', () => {
    expect(isWebsiteScanRunning('extracting')).toBe(true);
    expect(isWebsiteScanRunning('failed')).toBe(false);
    expect(isWebsiteScanReviewable(scan)).toBe(true);
    expect(isWebsiteScanReviewable({ ...scan, status: 'published' })).toBe(false);
  });
});
