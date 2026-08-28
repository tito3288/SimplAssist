import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AssistantKnowledgeStep from './AssistantKnowledgeStep';

const props = {
  businessId: '00000000-0000-4000-8000-000000000001',
  businessType: 'general' as const,
  onNext: vi.fn(),
  onBack: vi.fn(),
};

describe('AssistantKnowledgeStep rollout boundary', () => {
  it('uses the existing manual knowledge form when richer scanning is disabled', () => {
    const markup = renderToStaticMarkup(
      <AssistantKnowledgeStep {...props} richerScanEnabled={false} />
    );

    expect(markup).toContain('Assistant Knowledge');
    expect(markup).toContain('+ Add Service');
    expect(markup).not.toContain('Loading your knowledge draft');
  });

  it('waits for the persisted scan lookup when richer scanning is enabled', () => {
    const markup = renderToStaticMarkup(
      <AssistantKnowledgeStep {...props} richerScanEnabled />
    );

    expect(markup).toContain('Loading your knowledge draft');
  });
});
