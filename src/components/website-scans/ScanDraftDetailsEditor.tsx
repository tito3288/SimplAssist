'use client';

import { ExternalLink } from 'lucide-react';
import type {
  WebsiteScanEvidence,
  WebsiteScanReviewDraft,
} from '@/lib/website-scans/client';

export function SourceEvidence({ evidence }: { evidence?: WebsiteScanEvidence[] }) {
  if (!evidence?.length) return null;
  return (
    <details className="mt-2 text-xs text-stone-500 dark:text-[#a3a3a6]">
      <summary className="cursor-pointer font-medium">View website source</summary>
      <div className="mt-2 space-y-2">
        {evidence.map((source, index) => (
          <div key={`${source.url}-${index}`} className="rounded-lg bg-stone-50 p-2 dark:bg-black/20">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-[var(--brand-accent)] hover:underline dark:text-[var(--brand-accent-dark)]"
            >
              <span className="truncate">{source.title || source.url}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {source.excerpt && <p className="mt-1 leading-5">“{source.excerpt}”</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

export function ScanDraftDetailsEditor({
  draft,
  onChange,
}: {
  draft: WebsiteScanReviewDraft;
  onChange: (draft: WebsiteScanReviewDraft) => void;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
          Business briefing
        </h2>
        <p className="mb-3 mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          A short orientation your assistant uses alongside the exact details below.
        </p>
        {draft.overviewMetadata?.targetId ? (
          <label className="mb-3 flex items-start gap-2 rounded-xl border border-[#ece4d8] bg-stone-50 p-3 text-sm text-stone-700 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#d4d4d8]">
            <input
              type="checkbox"
              checked={
                draft.overviewMetadata.selected ??
                !draft.overviewMetadata.targetId
              }
              onChange={(event) => onChange({
                ...draft,
                overviewMetadata: {
                  ...draft.overviewMetadata,
                  selected: event.target.checked,
                },
              })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary)]"
            />
            <span>
              Replace the current business briefing with this website update
              {draft.overviewMetadata.changeType === 'unchanged' && (
                <span className="mt-0.5 block text-xs text-stone-500">The website briefing matches what is already approved.</span>
              )}
            </span>
          </label>
        ) : draft.overviewMetadata ? (
          <p className="mb-3 rounded-xl border border-[#ece4d8] bg-stone-50 p-3 text-sm text-stone-600 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#bdbdbf]">
            This is your assistant’s first business briefing. Review and edit it before publishing.
          </p>
        ) : null}
        <label className="sr-only" htmlFor="assistant-overview">Business briefing</label>
        <textarea
          id="assistant-overview"
          value={draft.overview}
          maxLength={1000}
          rows={5}
          onChange={(event) => onChange({ ...draft, overview: event.target.value })}
          className="w-full resize-y rounded-xl border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-[#f5f5f5]"
        />
        <p className="mt-1 text-right text-xs text-stone-400">{draft.overview.length}/1000</p>
        <SourceEvidence evidence={draft.overviewEvidence} />
      </section>

      <section>
        <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
          Facts &amp; policies
        </h2>
        <p className="mb-3 mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          Uncheck anything your assistant should not use. You can edit every draft.
        </p>
        {draft.knowledgeItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#e3dacc] p-4 text-sm text-stone-500 dark:border-white/[0.12] dark:text-[#bdbdbf]">
            No additional facts or policies were found. Add any important details below if needed.
          </p>
        ) : (
          <div className="space-y-3">
            {draft.knowledgeItems.map((item, index) => (
              <article key={item.id} className="rounded-xl border border-[#ece4d8] bg-white p-4 dark:border-white/[0.10] dark:bg-white/[0.04]">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={(event) => {
                      const knowledgeItems = [...draft.knowledgeItems];
                      knowledgeItems[index] = { ...item, selected: event.target.checked };
                      onChange({ ...draft, knowledgeItems });
                    }}
                    aria-label={`Use ${item.title}`}
                    className="mt-2 h-4 w-4 accent-[var(--brand-primary)]"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600 dark:bg-white/[0.08] dark:text-[#bdbdbf]">
                        {item.category?.replaceAll('_', ' ') || item.kind}
                      </span>
                      {item.changeType && item.changeType !== 'new' && (
                        <span className="text-xs text-stone-500">{item.changeType.replace('_', ' ')}</span>
                      )}
                    </div>
                    <input
                      value={item.title}
                      maxLength={200}
                      onChange={(event) => {
                        const knowledgeItems = [...draft.knowledgeItems];
                        knowledgeItems[index] = { ...item, title: event.target.value };
                        onChange({ ...draft, knowledgeItems });
                      }}
                      aria-label={`${item.kind} title`}
                      className="w-full rounded-lg border border-[#e3dacc] bg-white px-3 py-2 text-sm font-medium dark:border-white/[0.12] dark:bg-white/[0.06]"
                    />
                    <textarea
                      value={item.content}
                      maxLength={2000}
                      onChange={(event) => {
                        const knowledgeItems = [...draft.knowledgeItems];
                        knowledgeItems[index] = { ...item, content: event.target.value };
                        onChange({ ...draft, knowledgeItems });
                      }}
                      aria-label={`${item.title} content`}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-[#e3dacc] bg-white px-3 py-2 text-sm dark:border-white/[0.12] dark:bg-white/[0.06]"
                    />
                    <SourceEvidence evidence={item.evidence} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
          {(['fact', 'policy'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChange({
                ...draft,
                knowledgeItems: [
                  ...draft.knowledgeItems,
                  {
                    id: `manual-${kind}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
                    kind,
                    title: '',
                    content: '',
                    selected: true,
                  },
                ],
              })}
              className="text-[var(--brand-accent)] hover:underline dark:text-[var(--brand-accent-dark)]"
            >
              + Add {kind}
            </button>
          ))}
        </div>
      </section>

      {draft.questions.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold text-stone-900 dark:text-[#f5f5f5]">
            A few optional questions
          </h2>
          <p className="mb-3 mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
            These fill gaps the website could not answer. They never block setup.
          </p>
          <div className="space-y-3">
            {draft.questions.map((question, index) => (
              <div key={question.id} className="rounded-xl border border-[#ece4d8] bg-white p-4 dark:border-white/[0.10] dark:bg-white/[0.04]">
                <label htmlFor={`scan-question-${question.id}`} className="text-sm font-medium text-stone-900 dark:text-[#f5f5f5]">
                  {question.question}
                </label>
                <textarea
                  id={`scan-question-${question.id}`}
                  value={question.answer}
                  maxLength={2000}
                  disabled={question.disposition === 'not_applicable'}
                  rows={2}
                  onChange={(event) => {
                    const questions = [...draft.questions];
                    questions[index] = {
                      ...question,
                      answer: event.target.value,
                      disposition: event.target.value.trim() ? 'answered' : 'unanswered',
                    };
                    onChange({ ...draft, questions });
                  }}
                  className="mt-2 w-full resize-y rounded-lg border border-[#e3dacc] bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-white/[0.12] dark:bg-white/[0.06]"
                />
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {question.disposition === 'not_applicable' && (
                    <button
                      type="button"
                      onClick={() => {
                        const questions = [...draft.questions];
                        questions[index] = {
                          ...question,
                          disposition: 'unanswered',
                        };
                        onChange({ ...draft, questions });
                      }}
                      className="text-stone-600 underline-offset-2 hover:underline dark:text-[#bdbdbf]"
                    >
                      Answer instead
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const questions = [...draft.questions];
                      questions[index] = { ...question, answer: '', disposition: 'skipped' };
                      onChange({ ...draft, questions });
                    }}
                    className="text-stone-600 underline-offset-2 hover:underline dark:text-[#bdbdbf]"
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const questions = [...draft.questions];
                      questions[index] = { ...question, answer: '', disposition: 'not_applicable' };
                      onChange({ ...draft, questions });
                    }}
                    className="text-stone-600 underline-offset-2 hover:underline dark:text-[#bdbdbf]"
                  >
                    Doesn’t apply
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Boolean(draft.missingItems?.length) && (
        <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-white/[0.10] dark:bg-white/[0.04]">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-[#f5f5f5]">
            No longer found on the website
          </h2>
          <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-[#bdbdbf]">
            These approved items were not found during this scan. They will remain active unless you change them separately.
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-stone-700 dark:text-[#d4d4d8]">
            {draft.missingItems?.map((item) => <li key={item.id}>{item.title}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
