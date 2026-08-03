"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  CheckCircle2,
  CircleHelp,
  MessageCircleQuestion,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  dismissKnowledgeGap,
  resolveKnowledgeGapWithFaq,
  validateKnowledgeGapFaq,
} from "@/lib/knowledge-gaps/actions";
import {
  canManageKnowledgeGap,
  dismissKnowledgeGapInList,
  filterKnowledgeGaps,
  formatKnowledgeGapChannel,
  formatKnowledgeGapLastSeen,
  formatTimesAsked,
  getKnowledgeGapCounts,
  resolveKnowledgeGapInList,
  sortKnowledgeGaps,
  type KnowledgeGapFilter,
  type KnowledgeGapSort,
} from "@/lib/knowledge-gaps/dashboard";
import { FAQ_ANSWER_MAX_LENGTH } from "@/lib/contentQuality";
import {
  btnPrimaryCompact,
  btnSecondaryCompact,
  card,
  statusInfo,
  statusNeutral,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";
import type { KnowledgeGap, KnowledgeGapStatus } from "@/types/database";

interface KnowledgeGapsDashboardProps {
  businessId: string;
  initialGaps: KnowledgeGap[];
  loadError: string | null;
  timeZone: string;
}

interface FaqDraft {
  question: string;
  answer: string;
}

const FILTERS: Array<{ value: KnowledgeGapFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const STATUS_LABELS: Record<KnowledgeGapStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const STATUS_CLASSES: Record<KnowledgeGapStatus, string> = {
  open: statusWarning,
  resolved: statusSuccess,
  dismissed: statusNeutral,
};

const COUNT_CARDS = [
  {
    status: "open" as const,
    label: "Open",
    icon: CircleHelp,
    iconClass: "text-amber-600 dark:text-amber-300",
  },
  {
    status: "resolved" as const,
    label: "Resolved",
    icon: CheckCircle2,
    iconClass: "text-green-600 dark:text-green-300",
  },
  {
    status: "dismissed" as const,
    label: "Dismissed",
    icon: XCircle,
    iconClass: "text-stone-500 dark:text-stone-300",
  },
];

export default function KnowledgeGapsDashboard({
  businessId,
  initialGaps,
  loadError,
  timeZone,
}: KnowledgeGapsDashboardProps) {
  const [gaps, setGaps] = useState(initialGaps);
  const [filter, setFilter] = useState<KnowledgeGapFilter>("open");
  const [sort, setSort] = useState<KnowledgeGapSort>("most_asked");
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [dismissConfirmId, setDismissConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FaqDraft>({ question: "", answer: "" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    gapId: string;
    message: string;
  } | null>(null);
  const supabase = createClient();
  const mutationInProgress = savingId !== null;

  const counts = useMemo(() => getKnowledgeGapCounts(gaps), [gaps]);
  const visibleGaps = useMemo(
    () => sortKnowledgeGaps(filterKnowledgeGaps(gaps, filter), sort),
    [filter, gaps, sort]
  );

  function startAnswering(gap: KnowledgeGap) {
    if (mutationInProgress) return;
    setAnsweringId(gap.id);
    setDismissConfirmId(null);
    setDraft({ question: gap.question_text, answer: "" });
    setActionError(null);
  }

  function cancelAnswering() {
    if (mutationInProgress) return;
    setAnsweringId(null);
    setDraft({ question: "", answer: "" });
    setActionError(null);
  }

  async function handleResolve(
    event: FormEvent<HTMLFormElement>,
    gap: KnowledgeGap
  ) {
    event.preventDefault();
    if (mutationInProgress) return;
    const validationError = validateKnowledgeGapFaq(
      draft.question,
      draft.answer
    );
    if (validationError) {
      setActionError({ gapId: gap.id, message: validationError });
      return;
    }

    setSavingId(gap.id);
    setActionError(null);
    const result = await resolveKnowledgeGapWithFaq(supabase, {
      gapId: gap.id,
      question: draft.question,
      answer: draft.answer,
    });
    setSavingId(null);

    if (!result.ok) {
      setActionError({ gapId: gap.id, message: result.message });
      return;
    }

    setGaps((current) =>
      resolveKnowledgeGapInList(current, gap.id, result.faqId)
    );
    setAnsweringId(null);
    setDraft({ question: "", answer: "" });
  }

  async function handleDismiss(gap: KnowledgeGap) {
    if (mutationInProgress) return;
    setSavingId(gap.id);
    setActionError(null);
    const result = await dismissKnowledgeGap(supabase, {
      businessId,
      gapId: gap.id,
    });
    setSavingId(null);

    if (!result.ok) {
      setActionError({ gapId: gap.id, message: result.message });
      return;
    }

    setGaps((current) => dismissKnowledgeGapInList(current, gap.id));
    setDismissConfirmId(null);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">
          Knowledge Gaps
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          Review questions your AI could not fully answer and turn the useful
          ones into FAQs.
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className={`${card} border-red-200 p-6 dark:border-red-500/25`}
        >
          <h2 className="font-semibold text-red-700 dark:text-red-300">
            Knowledge gaps are temporarily unavailable
          </h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-[#bdbdbf]">
            {loadError} Refresh the page to try again.
          </p>
        </div>
      ) : (
        <>
          <section
            aria-label="Knowledge gap counts"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {COUNT_CARDS.map((item) => (
              <div key={item.status} className={`${card} p-5`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">
                      {item.label}
                    </p>
                    <p className="mt-1 text-3xl font-bold text-stone-900 dark:text-[#f5f5f5]">
                      {counts[item.status]}
                    </p>
                  </div>
                  <item.icon
                    aria-hidden="true"
                    className={`h-6 w-6 ${item.iconClass}`}
                  />
                </div>
              </div>
            ))}
          </section>

          <section className={`${card} overflow-hidden`}>
            <div className="flex flex-col gap-3 border-b border-[#ece4d8] p-4 dark:border-white/[0.10] sm:flex-row sm:items-center sm:justify-between">
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter knowledge gaps"
              >
                {FILTERS.map((item) => {
                  const isActive = filter === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={isActive}
                      disabled={mutationInProgress}
                      onClick={() => {
                        if (mutationInProgress) return;
                        setFilter(item.value);
                        setAnsweringId(null);
                        setDismissConfirmId(null);
                        setActionError(null);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        isActive
                          ? "border-[var(--brand-accent-soft-border)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] dark:border-[rgb(var(--brand-primary-dark-rgb)/.20)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/.15)] dark:text-[var(--brand-accent-dark)]"
                          : "border-[#e7e0d4] text-stone-600 hover:bg-[#faf6ef] dark:border-white/[0.12] dark:text-[#bdbdbf] dark:hover:bg-white/[0.06]"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-[#bdbdbf]">
                Sort
                <select
                  aria-label="Sort knowledge gaps"
                  value={sort}
                  disabled={mutationInProgress}
                  onChange={(event) => {
                    if (mutationInProgress) return;
                    setSort(event.target.value as KnowledgeGapSort);
                  }}
                  className="rounded-lg border border-[#e7e0d4] bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[var(--brand-primary)] dark:border-white/[0.12] dark:bg-[#171719] dark:text-[#f5f5f5]"
                >
                  <option value="most_asked">Most asked</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
            </div>

            {visibleGaps.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <MessageCircleQuestion
                  aria-hidden="true"
                  className="mx-auto h-8 w-8 text-stone-400"
                />
                <h2 className="mt-3 font-semibold text-stone-900 dark:text-[#f5f5f5]">
                  {emptyStateTitle(filter)}
                </h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
                  {filter === "open"
                    ? "Unresolved customer questions will appear here."
                    : "Try another filter to review your captured questions."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#ece4d8] dark:divide-white/[0.10]">
                {visibleGaps.map((gap) => {
                  const isSaving = savingId === gap.id;
                  const isAnswering = answeringId === gap.id;
                  const isConfirmingDismiss = dismissConfirmId === gap.id;
                  const rowError =
                    actionError?.gapId === gap.id ? actionError.message : null;

                  return (
                    <article key={gap.id} className="p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[gap.status]}`}
                            >
                              {STATUS_LABELS[gap.status]}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-xs ${statusInfo}`}>
                              {formatKnowledgeGapChannel(gap.channel)}
                            </span>
                          </div>
                          <h2 className="mt-3 break-words text-base font-semibold text-stone-900 dark:text-[#f5f5f5]">
                            {gap.question_text}
                          </h2>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-[#bdbdbf]">
                            <span>{formatTimesAsked(gap.occurrence_count)}</span>
                            <span>
                              Last seen{" "}
                              {formatKnowledgeGapLastSeen(
                                gap.last_seen_at,
                                timeZone
                              )}
                            </span>
                          </div>
                        </div>

                        {canManageKnowledgeGap(gap.status) && !isAnswering && (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startAnswering(gap)}
                              disabled={mutationInProgress}
                              className={`${btnPrimaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              Answer this
                            </button>
                            {isConfirmingDismiss ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleDismiss(gap)}
                                  disabled={mutationInProgress}
                                  className="rounded-full border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/25 dark:text-red-300 dark:hover:bg-red-500/10"
                                >
                                  {isSaving ? "Dismissing…" : "Confirm dismiss"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDismissConfirmId(null)}
                                  disabled={mutationInProgress}
                                  className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (mutationInProgress) return;
                                  setDismissConfirmId(gap.id);
                                  setActionError(null);
                                }}
                                disabled={mutationInProgress}
                                className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                Dismiss
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {isAnswering && (
                        <form
                          onSubmit={(event) => handleResolve(event, gap)}
                          className="mt-4 space-y-3 rounded-2xl border border-[#ece4d8] bg-[#faf7f2] p-4 dark:border-white/[0.10] dark:bg-white/[0.04]"
                        >
                          <div>
                            <label
                              htmlFor={`gap-question-${gap.id}`}
                              className="text-sm font-medium text-stone-700 dark:text-[#f5f5f5]"
                            >
                              FAQ question
                            </label>
                            <input
                              id={`gap-question-${gap.id}`}
                              value={draft.question}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  question: event.target.value,
                                }))
                              }
                              disabled={mutationInProgress}
                              className="mt-1 w-full rounded-xl border border-[#e7e0d4] bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-[var(--brand-primary)] dark:border-white/[0.12] dark:bg-[#171719] dark:text-[#f5f5f5]"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between gap-3">
                              <label
                                htmlFor={`gap-answer-${gap.id}`}
                                className="text-sm font-medium text-stone-700 dark:text-[#f5f5f5]"
                              >
                                Answer
                              </label>
                              <span className="text-xs text-stone-500 dark:text-[#bdbdbf]">
                                {draft.answer.length.toLocaleString("en-US")} /{" "}
                                {FAQ_ANSWER_MAX_LENGTH.toLocaleString("en-US")}
                              </span>
                            </div>
                            <textarea
                              id={`gap-answer-${gap.id}`}
                              value={draft.answer}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  answer: event.target.value,
                                }))
                              }
                              disabled={mutationInProgress}
                              rows={4}
                              className="mt-1 w-full resize-y rounded-xl border border-[#e7e0d4] bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-[var(--brand-primary)] dark:border-white/[0.12] dark:bg-[#171719] dark:text-[#f5f5f5]"
                            />
                          </div>

                          {rowError && (
                            <p
                              role="alert"
                              className="text-sm text-red-600 dark:text-red-300"
                            >
                              {rowError}
                            </p>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={mutationInProgress}
                              className={`${btnPrimaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              {isSaving ? "Saving…" : "Save as FAQ"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelAnswering}
                              disabled={mutationInProgress}
                              className={`${btnSecondaryCompact} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {rowError && !isAnswering && (
                        <p
                          role="alert"
                          className="mt-3 text-sm text-red-600 dark:text-red-300"
                        >
                          {rowError}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function emptyStateTitle(filter: KnowledgeGapFilter): string {
  switch (filter) {
    case "open":
      return "No open knowledge gaps";
    case "resolved":
      return "No resolved knowledge gaps";
    case "dismissed":
      return "No dismissed knowledge gaps";
    default:
      return "No knowledge gaps yet";
  }
}
