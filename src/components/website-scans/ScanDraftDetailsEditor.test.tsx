import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ScanDraftDetailsEditor } from './ScanDraftDetailsEditor';

describe('ScanDraftDetailsEditor', () => {
  it('renders owner-editable briefing, policies, optional questions, and safe sources', () => {
    const markup = renderToStaticMarkup(
      <ScanDraftDetailsEditor
        onChange={vi.fn()}
        draft={{
          overview: 'Friendly neighborhood dental practice.',
          services: [],
          faqs: [],
          knowledgeItems: [{
            id: 'policy-1',
            kind: 'policy',
            title: 'Cancellation policy',
            content: 'Please give 24 hours notice.',
            selected: true,
            evidence: [{
              url: 'https://example.com/policies',
              title: 'Policies',
              excerpt: '24 hours notice is required.',
            }],
          }],
          questions: [{
            id: 'question-1',
            question: 'Do you accept insurance?',
            answer: '',
            disposition: 'unanswered',
          }],
        }}
      />
    );

    expect(markup).toContain('Business briefing');
    expect(markup).toContain('Facts &amp; policies');
    expect(markup).toContain('Cancellation policy');
    expect(markup).toContain('A few optional questions');
    expect(markup).toContain('href="https://example.com/policies"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });
});
