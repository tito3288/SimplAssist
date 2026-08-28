import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requireWorkspacePageAccess: vi.fn(),
  getDashboardEntitledContext: vi.fn(),
  canUseFeature: vi.fn(() => true),
  manager: vi.fn(),
  queries: new Map<string, { eq: ReturnType<typeof vi.fn> }>(),
  richerWebsiteScanEnabled: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/customer/workspaceRouteResponse.server', () => ({
  requireWorkspacePageAccess: mocks.requireWorkspacePageAccess,
}));
vi.mock('@/lib/dashboard/context', () => ({
  getDashboardEntitledContext: mocks.getDashboardEntitledContext,
}));
vi.mock('@/lib/billing/entitlements', () => ({ canUseFeature: mocks.canUseFeature }));
vi.mock('@/lib/website-scans/rollout.server', () => ({
  isRicherWebsiteScanEnabledForBusiness: mocks.richerWebsiteScanEnabled,
}));
vi.mock('@/components/settings/WebsiteKnowledgeManager', () => ({
  default: (props: unknown) => {
    mocks.manager(props);
    return <div>Knowledge manager</div>;
  },
}));

import AssistantKnowledgePage from './page';

function queryFor(table: string, data: unknown) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => Promise.resolve({ data, error: null }));
  query.single = vi.fn(() => Promise.resolve({ data, error: null }));
  mocks.queries.set(table, query as { eq: ReturnType<typeof vi.fn> });
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.richerWebsiteScanEnabled.mockReturnValue(true);
  mocks.queries.clear();
  const data: Record<string, unknown> = {
    services: [{ name: 'Repair', description: null, price: null, source: 'manual' }],
    faqs: [{ question: 'Open?', answer: 'Yes', source: 'manual' }],
    businesses: { business_type: 'general' },
    business_knowledge_items: [{ kind: 'overview', title: null, content: 'Overview' }],
  };
  mocks.getDashboardEntitledContext.mockResolvedValue({
    status: 'resolved',
    supabase: { from: (table: string) => queryFor(table, data[table]) },
    business: { id: '00000000-0000-4000-8000-000000000001', website_url: 'https://example.com' },
    entitlements: { active: true },
  });
});

describe('AssistantKnowledgePage', () => {
  it('loads only active services, FAQs, and knowledge for the current workspace', async () => {
    const markup = renderToStaticMarkup(await AssistantKnowledgePage());

    expect(markup).toContain('Knowledge manager');
    expect(mocks.queries.get('services')?.eq).toHaveBeenCalledWith('is_active', true);
    expect(mocks.queries.get('faqs')?.eq).toHaveBeenCalledWith('is_active', true);
    expect(mocks.queries.get('business_knowledge_items')?.eq).toHaveBeenCalledWith('is_active', true);
    expect(mocks.manager).toHaveBeenCalledWith(expect.objectContaining({
      websiteUrl: 'https://example.com',
      initialData: expect.objectContaining({
        services: [expect.objectContaining({ name: 'Repair' })],
        faqs: [expect.objectContaining({ question: 'Open?' })],
      }),
    }));
  });

  it('redirects direct navigation when the richer scan rollout is disabled', async () => {
    mocks.richerWebsiteScanEnabled.mockReturnValue(false);
    mocks.redirect.mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(AssistantKnowledgePage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/settings');
    expect(mocks.manager).not.toHaveBeenCalled();
  });
});
