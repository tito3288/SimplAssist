import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  createClient: vi.fn(),
  authorizeWebsiteScanMutation: vi.fn(),
  saveWebsiteScanReview: vi.fn(),
  publishWebsiteScanReview: vi.fn(),
  retryWebsiteScan: vi.fn(),
  loadWebsiteScan: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/billing/entitlements', () => ({
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
}));
vi.mock('@/lib/customer/workspaceRouteResponse.server', () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/website-scans/http.server', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/lib/website-scans/http.server')
  >();
  return {
    ...original,
    authorizeWebsiteScanMutation: mocks.authorizeWebsiteScanMutation,
    websiteScanRolloutDenied: () => null,
  };
});
vi.mock('@/lib/website-scans/ownerActions.server', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/lib/website-scans/ownerActions.server')
  >();
  return {
    ...original,
    saveWebsiteScanReview: mocks.saveWebsiteScanReview,
    publishWebsiteScanReview: mocks.publishWebsiteScanReview,
    retryWebsiteScan: mocks.retryWebsiteScan,
  };
});
vi.mock('@/lib/website-scans/ownerRepository.server', () => ({
  loadWebsiteScan: mocks.loadWebsiteScan,
}));

import { POST as publish } from './[scanId]/publish/route';
import { POST as retry } from './[scanId]/retry/route';
import { PATCH as saveReview } from './[scanId]/review/route';

const BUSINESS_ID = '10000000-0000-4000-a000-000000000001';
const OWNER_ID = '20000000-0000-4000-a000-000000000002';
const SCAN_ID = '30000000-0000-4000-a000-000000000003';
const SUGGESTION_ID = '40000000-0000-4000-a000-000000000004';
const PUBLISH_ID = '50000000-0000-4000-a000-000000000005';

const draft = {
  overview: 'A helpful business briefing.',
  overviewMetadata: { suggestionId: SUGGESTION_ID, selected: true },
  services: [],
  faqs: [],
  knowledgeItems: [],
  questions: [],
};

function request(method: 'PATCH' | 'POST', body: unknown) {
  return new NextRequest(`http://localhost/api/website-scans/${SCAN_ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      user: { id: OWNER_ID },
      business: { id: BUSINESS_ID },
    },
  });
  mocks.createClient.mockResolvedValue({});
  mocks.authorizeWebsiteScanMutation.mockResolvedValue(null);
  mocks.saveWebsiteScanReview.mockResolvedValue({ data: 3, error: null });
  mocks.publishWebsiteScanReview.mockResolvedValue({
    data: { scanId: SCAN_ID, status: 'published', revision: 3 },
    error: null,
  });
  mocks.retryWebsiteScan.mockResolvedValue({ data: { id: SCAN_ID }, error: null });
  mocks.loadWebsiteScan.mockResolvedValue({
    id: SCAN_ID,
    websiteUrl: 'https://example.com',
    status: 'ready_for_review',
    coverage: 'complete',
    version: 3,
    pageCount: 4,
    failedPageCount: 0,
    draft,
  });
});

describe('website scan review mutation routes', () => {
  it('passes the complete draft and optimistic revision to autosave', async () => {
    const response = await saveReview(
      request('PATCH', { expectedVersion: 2, draft }),
      { params: { scanId: SCAN_ID } }
    );

    expect(response.status).toBe(200);
    expect(mocks.authorizeWebsiteScanMutation).toHaveBeenCalledWith({
      client: expect.anything(),
      businessId: BUSINESS_ID,
      ownerId: OWNER_ID,
    });
    expect(mocks.saveWebsiteScanReview).toHaveBeenCalledWith(expect.anything(), {
      scanId: SCAN_ID,
      expectedRevision: 2,
      draft,
    });
  });

  it('passes the stable publish key and reloads the owner-scoped result', async () => {
    const response = await publish(
      request('POST', {
        expectedVersion: 2,
        idempotencyKey: PUBLISH_ID,
        draft,
      }),
      { params: { scanId: SCAN_ID } }
    );

    expect(response.status).toBe(200);
    expect(mocks.publishWebsiteScanReview).toHaveBeenCalledWith(expect.anything(), {
      scanId: SCAN_ID,
      expectedRevision: 2,
      idempotencyKey: PUBLISH_ID,
      draft,
    });
    expect(mocks.loadWebsiteScan).toHaveBeenCalledWith(
      expect.anything(),
      BUSINESS_ID,
      SCAN_ID
    );
  });

  it('rejects unknown draft fields before either mutation runs', async () => {
    const response = await publish(
      request('POST', {
        expectedVersion: 2,
        idempotencyKey: PUBLISH_ID,
        draft: { ...draft, rawMarkdown: 'must never round-trip' },
      }),
      { params: { scanId: SCAN_ID } }
    );

    expect(response.status).toBe(400);
    expect(mocks.saveWebsiteScanReview).not.toHaveBeenCalled();
    expect(mocks.publishWebsiteScanReview).not.toHaveBeenCalled();
  });

  it('returns an already-running retry after a lost response without retrying again', async () => {
    mocks.loadWebsiteScan.mockResolvedValue({
      id: SCAN_ID,
      websiteUrl: 'https://example.com',
      status: 'queued',
      coverage: null,
      version: 3,
      pageCount: 0,
      failedPageCount: 0,
      draft: null,
    });

    const response = await retry(
      new NextRequest(`http://localhost/api/website-scans/${SCAN_ID}/retry`, {
        method: 'POST',
      }),
      { params: { scanId: SCAN_ID } }
    );

    expect(response.status).toBe(202);
    expect(mocks.retryWebsiteScan).not.toHaveBeenCalled();
    expect(mocks.authorizeWebsiteScanMutation).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      scan: { id: SCAN_ID, status: 'queued' },
    });
  });
});
