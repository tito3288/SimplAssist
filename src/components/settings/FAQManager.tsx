'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Plus, ChevronUp } from 'lucide-react';
import type { FAQ } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaCompactClass } from '@/lib/glass';
import { statusInfo, statusWarning, statusNeutral } from '@/lib/theme-v2/theme';
import {
  FAQ_ANSWER_MAX_LENGTH,
  MIN_VALID_FAQS,
  evaluateContentQuality,
  normalizeKnowledgeKey,
} from '@/lib/contentQuality';

interface FAQManagerProps {
  businessId: string;
  initialFaqs: FAQ[];
}

export default function FAQManager({ businessId, initialFaqs }: FAQManagerProps) {
  const [faqs, setFaqs] = useState<FAQ[]>(initialFaqs);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Scoped to the acting control ('add' or an FAQ id) so the message renders
  // where the user is looking, not off-viewport atop a long list.
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null);

  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');

  const supabase = createClient();
  const validFaqCount = evaluateContentQuality([], faqs).validFaqCount;
  const faqFloor = Math.min(validFaqCount, MIN_VALID_FAQS);

  const projectedFaqCount = (nextFaqs: FAQ[]) =>
    evaluateContentQuality([], nextFaqs).validFaqCount;

  const canRemoveActiveContribution = (id: string, mode: 'delete' | 'deactivate') => {
    const nextFaqs =
      mode === 'delete'
        ? faqs.filter((faq) => faq.id !== id)
        : faqs.map((faq) =>
            faq.id === id ? { ...faq, is_active: false } : faq
          );
    return projectedFaqCount(nextFaqs) >= faqFloor;
  };

  const duplicatesActiveQuestion = (question: string, excludeId?: string) => {
    const key = normalizeKnowledgeKey(question);
    return (
      key.length > 0 &&
      faqs.some(
        (faq) =>
          faq.id !== excludeId &&
          faq.is_active &&
          normalizeKnowledgeKey(faq.question) === key
      )
    );
  };

  const sourceLabel = (source: string) => {
    switch (source) {
      case 'scraped': return { text: 'Scraped', color: statusInfo };
      case 'suggested': return { text: 'Suggested', color: statusWarning };
      default: return { text: 'Manual', color: statusNeutral };
    }
  };

  const handleAdd = async () => {
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    if (newAnswer.trim().length > FAQ_ANSWER_MAX_LENGTH) {
      setActionError({ scope: 'add', message: `Answer must be ${FAQ_ANSWER_MAX_LENGTH.toLocaleString()} characters or less.` });
      return;
    }
    if (duplicatesActiveQuestion(newQuestion)) {
      setActionError({ scope: 'add', message: 'Use a distinct question. This FAQ is already active.' });
      return;
    }
    setSaving('add');
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('faqs')
        .insert({
          business_id: businessId,
          question: newQuestion.trim(),
          answer: newAnswer.trim(),
          source: 'manual' as const,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      setFaqs((prev) => [...prev, data]);
      setNewQuestion('');
      setNewAnswer('');
      setShowAddForm(false);
    } catch {
      setActionError({ scope: 'add', message: 'Could not add the FAQ. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const handleEdit = async (id: string) => {
    const faq = faqs.find((item) => item.id === id);
    if (!editQuestion.trim() || !editAnswer.trim()) {
      setActionError({ scope: id, message: 'Both a question and an answer are required.' });
      return;
    }
    if (editAnswer.trim().length > FAQ_ANSWER_MAX_LENGTH) {
      setActionError({ scope: id, message: `Answer must be ${FAQ_ANSWER_MAX_LENGTH.toLocaleString()} characters or less.` });
      return;
    }
    if (faq?.is_active && duplicatesActiveQuestion(editQuestion, id)) {
      setActionError({ scope: id, message: 'Use a distinct question. This FAQ is already active.' });
      return;
    }
    setSaving(id);
    setActionError(null);
    try {
      const { error } = await supabase
        .from('faqs')
        .update({ question: editQuestion.trim(), answer: editAnswer.trim() })
        .eq('id', id);
      if (error) throw error;
      setFaqs((prev) =>
        prev.map((f) => (f.id === id ? { ...f, question: editQuestion.trim(), answer: editAnswer.trim() } : f))
      );
      setExpandedId(null);
    } catch {
      setActionError({ scope: id, message: 'Could not save the FAQ. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setActionError(null);
    const faq = faqs.find((item) => item.id === id);
    if (!faq) return;
    if (isActive && !canRemoveActiveContribution(id, 'deactivate')) {
      setActionError({
        scope: id,
        message: `Keep at least ${MIN_VALID_FAQS} distinct active answered FAQs. Add another FAQ before turning this one off.`,
      });
      return;
    }
    if (!isActive) {
      if (
        !faq.question.trim() ||
        !faq.answer.trim() ||
        faq.answer.trim().length > FAQ_ANSWER_MAX_LENGTH
      ) {
        setActionError({
          scope: id,
          message: `Add a question and answer of ${FAQ_ANSWER_MAX_LENGTH.toLocaleString()} characters or less before activating this FAQ.`,
        });
        return;
      }
      if (duplicatesActiveQuestion(faq.question, id)) {
        setActionError({ scope: id, message: 'Rewrite this question before activating it; that question is already active.' });
        return;
      }
    }
    try {
      const { error } = await supabase.from('faqs').update({ is_active: !isActive }).eq('id', id);
      if (error) throw error;
      setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, is_active: !isActive } : f)));
    } catch {
      setActionError({ scope: id, message: 'Could not update the FAQ. Please try again.' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!canRemoveActiveContribution(id, 'delete')) {
      setActionError({
        scope: id,
        message: `Keep at least ${MIN_VALID_FAQS} distinct active answered FAQs. Add another FAQ before deleting this one.`,
      });
      setDeleteConfirmId(null);
      return;
    }
    setSaving(id);
    setActionError(null);
    try {
      const { error } = await supabase.from('faqs').delete().eq('id', id);
      if (error) throw error;
      setFaqs((prev) => prev.filter((f) => f.id !== id));
      setDeleteConfirmId(null);
    } catch {
      setActionError({ scope: id, message: 'Could not delete the FAQ. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const errorFor = (scope: string, className = '') =>
    actionError?.scope === scope ? (
      <p className={`text-sm text-red-600 dark:text-red-400 ${className}`}>{actionError.message}</p>
    ) : null;

  const startEdit = (faq: FAQ) => {
    setEditQuestion(faq.question);
    setEditAnswer(faq.answer);
    setExpandedId(faq.id);
  };

  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className={`rounded-lg border px-3 py-2 text-sm ${
          validFaqCount >= MIN_VALID_FAQS
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100'
        }`}
      >
        <p className="font-medium">
          {validFaqCount} of {MIN_VALID_FAQS} distinct active answered FAQs
        </p>
        {validFaqCount < MIN_VALID_FAQS && (
          <p className="mt-1 text-xs">
            Add {MIN_VALID_FAQS - validFaqCount} more so your AI can answer customers accurately. Your current AI service stays live while you repair this.
          </p>
        )}
      </div>

      {/* Fallback for an error scoped to a row that no longer renders (e.g.
          a slow failing toggle racing a successful delete) — without this
          the failure would be silent again. */}
      {actionError && actionError.scope !== 'add' &&
        !faqs.some((f) => f.id === actionError.scope) &&
        errorFor(actionError.scope)}

      {faqs.length === 0 && !showAddForm && (
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] text-center py-4">No FAQs yet. Add your first FAQ below.</p>
      )}

      <div className="space-y-2">
        {faqs.map((faq) => {
          const badge = sourceLabel(faq.source);
          const deactivateLocked =
            faq.is_active &&
            !canRemoveActiveContribution(faq.id, 'deactivate');
          const deleteLocked = !canRemoveActiveContribution(faq.id, 'delete');
          const floorExplanation = `Keep at least ${MIN_VALID_FAQS} distinct active answered FAQs. Add another FAQ first.`;
          return (
            <div key={faq.id} className="border border-[#ece4d8] dark:border-white/[0.12] rounded-lg">
              <div className="flex items-start gap-3 p-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={faq.is_active}
                  onClick={() => handleToggleActive(faq.id, faq.is_active)}
                  disabled={deactivateLocked}
                  title={deactivateLocked ? floorExplanation : undefined}
                  aria-label={`${faq.is_active ? 'Deactivate' : 'Activate'} ${faq.question}`}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5 ${
                    faq.is_active ? 'bg-[var(--brand-primary)] dark:bg-[var(--brand-primary-dark)]' : 'bg-stone-200 dark:bg-white/[0.12]'
                  } ${deactivateLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                      faq.is_active ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${faq.is_active ? 'text-stone-900 dark:text-[#f5f5f5]' : 'text-stone-400 dark:text-[#666]'}`}>
                      {faq.question}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.color}`}>
                      {badge.text}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 dark:text-[#bdbdbf] mt-0.5 line-clamp-2">{faq.answer}</p>
                </div>

                <button
                  type="button"
                  onClick={() => (expandedId === faq.id ? setExpandedId(null) : startEdit(faq))}
                  className="text-stone-400 dark:text-[#bdbdbf] hover:text-[var(--brand-accent)] dark:hover:text-[var(--brand-accent-dark)] p-1 shrink-0"
                >
                  {expandedId === faq.id ? <ChevronUp className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                </button>

                {deleteConfirmId === faq.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDelete(faq.id)}
                      disabled={saving === faq.id}
                      className="text-xs text-red-600 hover:text-red-700 font-medium"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-xs text-stone-500 dark:text-[#bdbdbf] hover:text-stone-700 dark:hover:text-[#f5f5f5]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(faq.id)}
                    disabled={deleteLocked}
                    title={deleteLocked ? floorExplanation : undefined}
                    aria-label={`Delete ${faq.question}`}
                    className={`text-stone-400 dark:text-[#bdbdbf] hover:text-red-500 p-1 shrink-0 ${deleteLocked ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {errorFor(faq.id, 'px-3 pb-2')}
              {(deactivateLocked || deleteLocked) && (
                <p className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-300">
                  {floorExplanation}
                </p>
              )}

              {expandedId === faq.id && (
                <div className="border-t border-[#ece4d8] dark:border-white/[0.10] p-3 space-y-2 bg-[#faf6ef] dark:bg-white/[0.03]">
                  <input
                    value={editQuestion}
                    onChange={(e) => setEditQuestion(e.target.value)}
                    placeholder="Question"
                    className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
                  />
                  <textarea
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    placeholder="Answer"
                    rows={3}
                    maxLength={FAQ_ANSWER_MAX_LENGTH}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="px-3 py-1.5 text-sm text-stone-600 dark:text-[#bdbdbf] hover:text-stone-800 dark:hover:text-[#f5f5f5]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(faq.id)}
                      disabled={saving === faq.id || !editQuestion.trim() || !editAnswer.trim()}
                      className={primaryCtaCompactClass}
                    >
                      {saving === faq.id ? (
                        <>
                          <PulsingDot inline />
                          Saving…
                        </>
                      ) : (
                        'Save'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddForm ? (
        <div className="border border-[var(--brand-accent-soft-border)] dark:border-[rgb(var(--brand-primary-dark-rgb)/.30)] rounded-lg p-3 space-y-2 bg-[var(--brand-accent-soft)] dark:bg-white/[0.04]">
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Question *"
            className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]"
          />
          <textarea
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            placeholder="Answer *"
            rows={3}
            maxLength={FAQ_ANSWER_MAX_LENGTH}
            className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.25)] dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)] resize-none"
          />
          {errorFor('add')}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewQuestion(''); setNewAnswer(''); setActionError(null); }}
              className="px-3 py-1.5 text-sm text-stone-600 dark:text-[#bdbdbf] hover:text-stone-800 dark:hover:text-[#f5f5f5]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving === 'add' || !newQuestion.trim() || !newAnswer.trim()}
              className={primaryCtaCompactClass}
            >
              {saving === 'add' ? (
                <>
                  <PulsingDot inline />
                  Adding…
                </>
              ) : (
                'Add FAQ'
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 text-sm text-[var(--brand-accent)] hover:text-[var(--brand-primary-active)] dark:text-[var(--brand-accent-dark)] dark:hover:text-[var(--brand-primary-soft-dark)] font-medium"
        >
          <Plus className="w-4 h-4" /> Add FAQ
        </button>
      )}
    </div>
  );
}
