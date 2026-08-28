import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  WebsiteScan,
  WebsiteScanCoverage,
  WebsiteScanEvidence,
  WebsiteScanReviewDraft,
  WebsiteScanStatus,
} from "./client";
import { websiteScanReviewDraftSchema } from "./contracts";

const RUN_COLUMNS = [
  "id",
  "business_id",
  "source_url",
  "purpose",
  "status",
  "coverage",
  "progress_stage",
  "pages_discovered",
  "pages_succeeded",
  "pages_completed",
  "pages_failed",
  "profile_prefill",
  "review_draft",
  "review_revision",
  "error_code",
  "error_message",
  "created_at",
  "updated_at",
].join(",");

const SUGGESTION_COLUMNS = [
  "id",
  "kind",
  "category",
  "draft_payload",
  "change_type",
  "target_id",
  "baseline_hash",
  "created_at",
].join(",");

const QUESTION_COLUMNS = [
  "id",
  "category",
  "question",
  "reason",
  "output_kind",
  "output_title",
  "status",
  "answer",
  "created_at",
].join(",");

const WEBSITE_SCAN_STATUSES = new Set<WebsiteScanStatus>([
  "queued",
  "discovering",
  "crawling",
  "extracting",
  "ready_for_review",
  "published",
  "failed",
  "cancelled",
  "discarded",
  "superseded",
]);

const WEBSITE_SCAN_COVERAGES = new Set<Exclude<WebsiteScanCoverage, null>>([
  "complete",
  "partial",
  "insufficient",
]);

export class WebsiteScanOwnerRepositoryError extends Error {
  constructor(
    public readonly operation: string,
    public readonly detail: string,
  ) {
    super(`Website scan owner read failed during ${operation}: ${detail}`);
    this.name = "WebsiteScanOwnerRepositoryError";
  }
}

export async function loadCurrentWebsiteScan(
  client: SupabaseClient,
  businessId: string,
): Promise<WebsiteScan | null> {
  const result = await client
    .from("website_scan_runs")
    .select(RUN_COLUMNS)
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw new WebsiteScanOwnerRepositoryError(
      "load_current",
      result.error.message,
    );
  }
  if (!result.data) return null;
  return hydrateWebsiteScan(client, businessId, result.data);
}

export async function loadWebsiteScan(
  client: SupabaseClient,
  businessId: string,
  scanId: string,
): Promise<WebsiteScan | null> {
  const result = await client
    .from("website_scan_runs")
    .select(RUN_COLUMNS)
    .eq("id", scanId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (result.error) {
    throw new WebsiteScanOwnerRepositoryError(
      "load_scan",
      result.error.message,
    );
  }
  if (!result.data) return null;
  return hydrateWebsiteScan(client, businessId, result.data);
}

async function hydrateWebsiteScan(
  client: SupabaseClient,
  businessId: string,
  rawRun: unknown,
): Promise<WebsiteScan> {
  const run = record(rawRun, "run");
  const scanId = requiredString(run.id, "id");
  const status = parseStatus(run.status);
  let draft: WebsiteScanReviewDraft | null = null;

  if (status === "ready_for_review") {
    const [suggestionResult, sourceResult, questionResult] = await Promise.all([
      client
        .from("website_scan_suggestions")
        .select(SUGGESTION_COLUMNS)
        .eq("scan_id", scanId)
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
      client
        .from("website_scan_suggestion_sources")
        .select("suggestion_id,source_url,excerpt")
        .eq("business_id", businessId)
        .in(
          "suggestion_id",
          await suggestionIds(client, businessId, scanId),
        ),
      client
        .from("website_scan_questions")
        .select(QUESTION_COLUMNS)
        .eq("scan_id", scanId)
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
    ]);

    if (suggestionResult.error) {
      throw new WebsiteScanOwnerRepositoryError(
        "load_suggestions",
        suggestionResult.error.message,
      );
    }
    if (sourceResult.error) {
      throw new WebsiteScanOwnerRepositoryError(
        "load_sources",
        sourceResult.error.message,
      );
    }
    if (questionResult.error) {
      throw new WebsiteScanOwnerRepositoryError(
        "load_questions",
        questionResult.error.message,
      );
    }

    draft = buildOwnerReviewDraft({
      reviewDraft: run.review_draft,
      profilePrefill: run.profile_prefill,
      suggestions: arrayOfRecords(suggestionResult.data),
      sources: arrayOfRecords(sourceResult.data),
      questions: arrayOfRecords(questionResult.data),
    });
  }

  return {
    id: scanId,
    websiteUrl: requiredString(run.source_url, "source_url"),
    status,
    coverage: parseCoverage(run.coverage),
    version: nonnegativeInteger(run.review_revision),
    pageCount: nonnegativeInteger(run.pages_succeeded),
    failedPageCount: nonnegativeInteger(run.pages_failed),
    progress: {
      stage: optionalString(run.progress_stage) ?? status,
      completed: nonnegativeInteger(run.pages_completed),
      total: nonnegativeInteger(run.pages_discovered),
    },
    error:
      typeof run.error_message === "string" && run.error_message
        ? {
            code: optionalString(run.error_code) ?? undefined,
            message: run.error_message,
          }
        : null,
    draft,
    createdAt: optionalString(run.created_at) ?? undefined,
    updatedAt: optionalString(run.updated_at) ?? undefined,
  };
}

async function suggestionIds(
  client: SupabaseClient,
  businessId: string,
  scanId: string,
): Promise<string[]> {
  const result = await client
    .from("website_scan_suggestions")
    .select("id")
    .eq("scan_id", scanId)
    .eq("business_id", businessId);
  if (result.error) {
    throw new WebsiteScanOwnerRepositoryError(
      "load_suggestion_ids",
      result.error.message,
    );
  }
  return arrayOfRecords(result.data).flatMap((row) =>
    typeof row.id === "string" ? [row.id] : [],
  );
}

export function buildOwnerReviewDraft(input: {
  reviewDraft: unknown;
  profilePrefill: unknown;
  suggestions: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  questions: Record<string, unknown>[];
}): WebsiteScanReviewDraft {
  const sourceMap = new Map<string, WebsiteScanEvidence[]>();
  for (const source of input.sources) {
    const suggestionId = optionalString(source.suggestion_id);
    const url = optionalString(source.source_url);
    const excerpt = optionalString(source.excerpt);
    if (!suggestionId || !url || !excerpt) continue;
    sourceMap.set(suggestionId, [
      ...(sourceMap.get(suggestionId) ?? []),
      { url, excerpt },
    ]);
  }

  const saved = websiteScanReviewDraftSchema.safeParse(input.reviewDraft);
  if (saved.success) {
    return rehydrateSavedReview(saved.data, input.suggestions, sourceMap);
  }

  const overviewSuggestion = input.suggestions.find(
    (suggestion) => suggestion.kind === "overview",
  );
  const overviewPayload = objectOrEmpty(overviewSuggestion?.draft_payload);
  const profile = objectOrEmpty(input.profilePrefill);
  const hours = Array.isArray(profile.business_hours)
    ? profile.business_hours.flatMap(parseHour)
    : [];

  const activeSuggestions = input.suggestions.filter(
    (suggestion) => suggestion.change_type !== "missing",
  );

  return {
    overview: optionalString(overviewPayload.content) ?? "",
    overviewMetadata: overviewSuggestion
      ? metadataForSuggestion(overviewSuggestion)
      : undefined,
    overviewEvidence: overviewSuggestion
      ? sourceMap.get(requiredString(overviewSuggestion.id, "suggestion.id"))
      : undefined,
    businessInfo: {
      business_name: nullableString(profile.business_name),
      phone_number: nullableString(profile.phone_number),
      address: nullableString(profile.address),
      city: nullableString(profile.city),
      state: nullableString(profile.state),
      zip: nullableString(profile.zip),
    },
    businessHours: hours,
    services: activeSuggestions
      .filter((suggestion) => suggestion.kind === "service")
      .map((suggestion) => {
        const payload = objectOrEmpty(suggestion.draft_payload);
        return {
          id: requiredString(suggestion.id, "suggestion.id"),
          ...itemMetadata(suggestion),
          name: optionalString(payload.name) ?? "",
          description: optionalString(payload.description) ?? "",
          price: optionalString(payload.price) ?? "",
          selected: payload.selected === true,
          changeType: parseChangeType(suggestion.change_type),
          evidence: sourceMap.get(requiredString(suggestion.id, "suggestion.id")),
        };
      }),
    faqs: activeSuggestions
      .filter((suggestion) => suggestion.kind === "faq")
      .map((suggestion) => {
        const payload = objectOrEmpty(suggestion.draft_payload);
        return {
          id: requiredString(suggestion.id, "suggestion.id"),
          ...itemMetadata(suggestion),
          question: optionalString(payload.question) ?? "",
          answer: optionalString(payload.answer) ?? "",
          selected: payload.selected === true,
          changeType: parseChangeType(suggestion.change_type),
          evidence: sourceMap.get(requiredString(suggestion.id, "suggestion.id")),
        };
      }),
    knowledgeItems: activeSuggestions
      .filter(
        (suggestion) =>
          suggestion.kind === "fact" || suggestion.kind === "policy",
      )
      .map((suggestion) => {
        const payload = objectOrEmpty(suggestion.draft_payload);
        return {
          id: requiredString(suggestion.id, "suggestion.id"),
          ...itemMetadata(suggestion),
          kind: suggestion.kind as "fact" | "policy",
          category:
            optionalString(suggestion.category) ??
            optionalString(payload.category) ??
            undefined,
          title: optionalString(payload.title) ?? "",
          content: optionalString(payload.content) ?? "",
          selected: payload.selected === true,
          changeType: parseChangeType(suggestion.change_type),
          evidence: sourceMap.get(requiredString(suggestion.id, "suggestion.id")),
        };
      }),
    questions: input.questions.map((question) => ({
      id: requiredString(question.id, "question.id"),
      question: requiredString(question.question, "question.question"),
      category: optionalString(question.category) ?? undefined,
      answer: optionalString(question.answer) ?? "",
      disposition: parseQuestionDisposition(question.status),
    })),
    missingItems: input.suggestions
      .filter((suggestion) => suggestion.change_type === "missing")
      .map((suggestion) => ({
        id: requiredString(suggestion.id, "suggestion.id"),
        kind:
          suggestion.kind === "service"
            ? ("service" as const)
            : suggestion.kind === "faq"
              ? ("faq" as const)
              : ("knowledge" as const),
        title: suggestionTitle(suggestion),
      })),
  };
}

function rehydrateSavedReview(
  saved: WebsiteScanReviewDraft,
  suggestions: Record<string, unknown>[],
  sourceMap: Map<string, WebsiteScanEvidence[]>,
): WebsiteScanReviewDraft {
  const suggestionsById = new Map(
    suggestions.flatMap((suggestion) => {
      const id = optionalString(suggestion.id);
      return id ? [[id, suggestion] as const] : [];
    }),
  );
  const hydrateItems = <T extends { id: string }>(items: T[]): T[] =>
    items.map((item) => {
      const suggestion = suggestionsById.get(item.id);
      if (!suggestion) return item;
      return {
        ...item,
        ...itemMetadata(suggestion),
        evidence: sourceMap.get(item.id),
      };
    });

  const overviewSuggestion = saved.overviewMetadata?.suggestionId
    ? suggestionsById.get(saved.overviewMetadata.suggestionId)
    : suggestions.find((suggestion) => suggestion.kind === "overview");

  return {
    ...saved,
    overviewMetadata: overviewSuggestion
      ? metadataForSuggestion(
          overviewSuggestion,
          saved.overviewMetadata?.selected,
        )
      : saved.overviewMetadata,
    overviewEvidence: overviewSuggestion
      ? sourceMap.get(requiredString(overviewSuggestion.id, "suggestion.id"))
      : saved.overviewEvidence,
    services: hydrateItems(saved.services),
    faqs: hydrateItems(saved.faqs),
    knowledgeItems: hydrateItems(saved.knowledgeItems),
  };
}

function metadataForSuggestion(
  suggestion: Record<string, unknown>,
  savedSelected?: boolean,
): NonNullable<WebsiteScanReviewDraft["overviewMetadata"]> {
  const payload = objectOrEmpty(suggestion.draft_payload);
  return {
    suggestionId: requiredString(suggestion.id, "suggestion.id"),
    ...itemMetadata(suggestion),
    selected:
      typeof savedSelected === "boolean"
        ? savedSelected
        : payload.selected === true,
    changeType: parseChangeType(suggestion.change_type),
  };
}

function itemMetadata(suggestion: Record<string, unknown>) {
  return {
    targetId: nullableString(suggestion.target_id),
    baselineHash: nullableString(suggestion.baseline_hash),
  };
}

function parseHour(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const hour = value as Record<string, unknown>;
  if (
    typeof hour.day !== "string" ||
    typeof hour.open_time !== "string" ||
    typeof hour.close_time !== "string" ||
    typeof hour.is_closed !== "boolean"
  ) {
    return [];
  }
  return [
    {
      day: hour.day,
      open_time: hour.open_time,
      close_time: hour.close_time,
      is_closed: hour.is_closed,
    },
  ];
}

function suggestionTitle(suggestion: Record<string, unknown>): string {
  const payload = objectOrEmpty(suggestion.draft_payload);
  return (
    optionalString(payload.name) ??
    optionalString(payload.question) ??
    optionalString(payload.title) ??
    "Previously approved item"
  );
}

function parseQuestionDisposition(
  value: unknown,
): "unanswered" | "answered" | "skipped" | "not_applicable" {
  return value === "answered" || value === "skipped" || value === "not_applicable"
    ? value
    : "unanswered";
}

function parseChangeType(value: unknown) {
  return value === "changed" ||
    value === "unchanged" ||
    value === "missing"
    ? value
    : ("new" as const);
}

function parseStatus(value: unknown): WebsiteScanStatus {
  if (typeof value === "string" && WEBSITE_SCAN_STATUSES.has(value as WebsiteScanStatus)) {
    return value as WebsiteScanStatus;
  }
  throw new WebsiteScanOwnerRepositoryError("parse_run", "invalid status");
}

function parseCoverage(value: unknown): WebsiteScanCoverage {
  return typeof value === "string" &&
    WEBSITE_SCAN_COVERAGES.has(value as Exclude<WebsiteScanCoverage, null>)
    ? (value as Exclude<WebsiteScanCoverage, null>)
    : null;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebsiteScanOwnerRepositoryError("parse_run", `invalid ${name}`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new WebsiteScanOwnerRepositoryError("parse_run", `missing ${name}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}
