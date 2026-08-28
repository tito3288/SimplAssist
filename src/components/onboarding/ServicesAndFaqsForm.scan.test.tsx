import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ServicesAndFaqsForm from './ServicesAndFaqsForm';

describe('ServicesAndFaqsForm scan review', () => {
  it('makes partial website suggestions explicitly reviewable before publish', () => {
    const services = [1, 2, 3].map((number) => ({
      id: `00000000-0000-4000-8000-00000000000${number}`,
      name: `Service ${number}`,
      description: `Description ${number}`,
      price: '',
      selected: true,
      changeType: number === 1 ? ('changed' as const) : ('new' as const),
      evidence: [{ url: `https://example.com/service-${number}`, excerpt: `Service ${number}` }],
    }));
    const faqs = [1, 2, 3].map((number) => ({
      id: `10000000-0000-4000-8000-00000000000${number}`,
      question: `Question ${number}?`,
      answer: `Answer ${number}`,
      selected: true,
      changeType: 'new' as const,
    }));

    const markup = renderToStaticMarkup(
      <ServicesAndFaqsForm
        businessId="20000000-0000-4000-8000-000000000001"
        businessType="general"
        mode="settings"
        websiteScan={{
          id: '30000000-0000-4000-8000-000000000001',
          websiteUrl: 'https://example.com',
          status: 'ready_for_review',
          coverage: 'partial',
          version: 1,
          pageCount: 4,
          failedPageCount: 1,
          draft: {
            overview: 'A useful business briefing.',
            overviewMetadata: {
              suggestionId: '50000000-0000-4000-8000-000000000001',
              targetId: '60000000-0000-4000-8000-000000000001',
              baselineHash: 'a'.repeat(64),
              selected: false,
              changeType: 'changed',
            },
            services,
            faqs,
            knowledgeItems: [],
            questions: [],
          },
        }}
        onNext={vi.fn()}
      />
    );

    expect(markup).toContain('Assistant Knowledge');
    expect(markup).toContain('Nothing from a website scan is used until you approve it here.');
    expect(markup).toContain('Some website pages could not be read.');
    expect(markup).toContain('Replace the current business briefing with this website update');
    expect(markup).toContain('Website suggests an update');
    expect(markup).toContain('aria-label="Use Service 1"');
    expect(markup).toContain('View website source');
    expect(markup).toContain('Approve &amp; publish');
  });

  it('counts approved Settings knowledge without inventing padded rescan rows', () => {
    const initialData = {
      services: [1, 2, 3].map((number) => ({
        name: `Approved service ${number}`,
        description: '',
        price: '',
        source: 'manual' as const,
      })),
      faqs: [1, 2, 3].map((number) => ({
        question: `Approved question ${number}?`,
        answer: `Approved answer ${number}`,
        source: 'manual' as const,
      })),
    };
    const markup = renderToStaticMarkup(
      <ServicesAndFaqsForm
        businessId="20000000-0000-4000-8000-000000000001"
        businessType="general"
        mode="settings"
        initialData={initialData}
        websiteScan={{
          id: '30000000-0000-4000-8000-000000000002',
          websiteUrl: 'https://example.com',
          status: 'ready_for_review',
          coverage: 'complete',
          version: 1,
          pageCount: 2,
          failedPageCount: 0,
          draft: {
            overview: 'An updated business briefing.',
            services: [{
              id: '40000000-0000-4000-8000-000000000001',
              name: 'New suggestion',
              selected: true,
            }],
            faqs: [],
            knowledgeItems: [],
            questions: [],
          },
        }}
        onNext={vi.fn()}
      />
    );

    expect(markup.match(/3 of 3 ready/g)).toHaveLength(2);
    expect(markup).toContain('New suggestion');
    expect(markup).not.toContain('What are your hours of operation?');
  });

  it('uses saved onboarding knowledge as the baseline when reviewing a later scan', () => {
    const initialData = {
      services: [1, 2, 3].map((number) => ({
        name: `Saved service ${number}`,
        description: '',
        price: '',
        source: 'manual' as const,
      })),
      faqs: [1, 2, 3].map((number) => ({
        question: `Saved question ${number}?`,
        answer: `Saved answer ${number}`,
        source: 'manual' as const,
      })),
    };
    const markup = renderToStaticMarkup(
      <ServicesAndFaqsForm
        businessId="20000000-0000-4000-8000-000000000001"
        businessType="general"
        initialData={initialData}
        websiteScan={{
          id: '30000000-0000-4000-8000-000000000003',
          websiteUrl: 'https://example.com',
          status: 'ready_for_review',
          coverage: 'complete',
          version: 1,
          pageCount: 2,
          failedPageCount: 0,
          draft: {
            overview: 'A saved-business rescan.',
            services: [],
            faqs: [],
            knowledgeItems: [],
            questions: [],
          },
        }}
        onNext={vi.fn()}
      />
    );

    expect(markup.match(/3 of 3 ready/g)).toHaveLength(2);
    expect(markup).not.toContain('What are your hours of operation?');
  });
});
