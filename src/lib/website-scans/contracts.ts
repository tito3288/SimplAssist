import { z } from "zod";

import type { WebsiteScanReviewDraft } from "./client";

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const nullableTrimmedString = (maximum: number) =>
  z.string().trim().max(maximum).nullable();

const evidenceSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === "https:", {
        message: "Evidence links must use HTTPS.",
      }),
    title: z.string().max(500).nullable().optional(),
    excerpt: z.string().max(1_000).nullable().optional(),
  })
  .strict();

const suggestionMetadata = {
  targetId: uuidSchema.nullable().optional(),
  baselineHash: sha256Schema.nullable().optional(),
};

const suggestionStateSchema = z.enum([
  "new",
  "changed",
  "unchanged",
  "missing",
]);

const serviceDraftSchema = z
  .object({
    id: z.string().min(1).max(100),
    ...suggestionMetadata,
    name: z.string().max(120),
    description: z.string().max(1_000).optional(),
    price: z.string().max(120).optional(),
    selected: z.boolean(),
    changeType: suggestionStateSchema.optional(),
    evidence: z.array(evidenceSchema).max(5).optional(),
  })
  .strict();

const faqDraftSchema = z
  .object({
    id: z.string().min(1).max(100),
    ...suggestionMetadata,
    question: z.string().max(300),
    answer: z.string().max(2_000),
    selected: z.boolean(),
    changeType: suggestionStateSchema.optional(),
    evidence: z.array(evidenceSchema).max(5).optional(),
  })
  .strict();

const knowledgeDraftSchema = z
  .object({
    id: z.string().min(1).max(100),
    ...suggestionMetadata,
    kind: z.enum(["fact", "policy"]),
    category: z.string().trim().max(80).optional(),
    title: z.string().max(200),
    content: z.string().max(2_000),
    selected: z.boolean(),
    changeType: suggestionStateSchema.optional(),
    evidence: z.array(evidenceSchema).max(5).optional(),
  })
  .strict();

const questionDraftSchema = z
  .object({
    id: uuidSchema,
    question: z.string().trim().min(3).max(500),
    category: z.string().max(80).optional(),
    answer: z.string().max(2_000),
    disposition: z.enum([
      "unanswered",
      "answered",
      "skipped",
      "not_applicable",
    ]),
  })
  .strict()
  .superRefine((question, context) => {
    if (question.disposition === "answered" && !question.answer.trim()) {
      context.addIssue({
        code: "custom",
        path: ["answer"],
        message: "Answered questions need an answer.",
      });
    }
  });

export const websiteScanReviewDraftSchema = z
  .object({
    overview: z.string().max(1_000),
    overviewMetadata: z
      .object({
        suggestionId: uuidSchema.optional(),
        ...suggestionMetadata,
        selected: z.boolean().optional(),
        changeType: suggestionStateSchema.optional(),
      })
      .strict()
      .optional(),
    overviewEvidence: z.array(evidenceSchema).max(5).optional(),
    businessInfo: z
      .object({
        business_name: nullableTrimmedString(200).optional(),
        phone_number: nullableTrimmedString(50).optional(),
        address: nullableTrimmedString(300).optional(),
        city: nullableTrimmedString(120).optional(),
        state: nullableTrimmedString(80).optional(),
        zip: nullableTrimmedString(20).optional(),
      })
      .strict()
      .optional(),
    businessHours: z
      .array(
        z
          .object({
            day: z.string().trim().min(2).max(20),
            open_time: z.string().max(30),
            close_time: z.string().max(30),
            is_closed: z.boolean(),
          })
          .strict(),
      )
      .max(7)
      .optional(),
    services: z.array(serviceDraftSchema).max(20),
    faqs: z.array(faqDraftSchema).max(20),
    knowledgeItems: z.array(knowledgeDraftSchema).max(24),
    questions: z.array(questionDraftSchema).max(5),
    missingItems: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            kind: z.enum(["service", "faq", "knowledge"]),
            title: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .max(64)
      .optional(),
  })
  .strict();

export const websiteScanStartSchema = z
  .object({
    url: z.string().trim().url().max(2_048),
    trigger: z.enum(["onboarding", "settings"]),
    clientRequestId: uuidSchema,
  })
  .strict();

export const websiteScanReviewMutationSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    draft: websiteScanReviewDraftSchema,
  })
  .strict();

export const websiteScanPublishMutationSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    idempotencyKey: uuidSchema,
    draft: websiteScanReviewDraftSchema,
  })
  .strict();

export const websiteScanIdSchema = uuidSchema;

type PublishSuggestion = {
  suggestionId?: string;
  targetId?: string;
  baselineHash?: string;
};

export type WebsiteScanPublishPayload = {
  services: Array<
    PublishSuggestion & { name: string; description: string; price: string }
  >;
  faqs: Array<PublishSuggestion & { question: string; answer: string }>;
  knowledge: Array<
    PublishSuggestion & {
      kind: "overview" | "fact" | "policy";
      category: string;
      title: string;
      content: string;
    }
  >;
  questions: Array<{
    questionId: string;
    status: "answered" | "skipped" | "not_applicable";
    answer: string | null;
  }>;
};

export class WebsiteScanDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteScanDraftValidationError";
  }
}

/** Convert the complete owner-edited UI draft into the exact atomic RPC input. */
export function toWebsiteScanPublishPayload(
  draft: WebsiteScanReviewDraft,
): WebsiteScanPublishPayload {
  const overview = draft.overview.trim();
  const includeOverview = draft.overviewMetadata?.selected !== false;
  if (includeOverview && !overview) {
    throw new WebsiteScanDraftValidationError(
      "Add a short business briefing before publishing.",
    );
  }
  if (
    !includeOverview &&
    (!draft.overviewMetadata?.targetId || !draft.overviewMetadata.baselineHash)
  ) {
    throw new WebsiteScanDraftValidationError(
      "A new business briefing must be approved before publishing.",
    );
  }

  const services = draft.services.filter((item) => item.selected).map((item) => {
    const name = item.name.trim();
    if (!name) {
      throw new WebsiteScanDraftValidationError(
        "Every selected service needs a name.",
      );
    }
    return {
      ...publishMetadata(item.id, item.targetId, item.baselineHash),
      name,
      description: item.description?.trim() ?? "",
      price: item.price?.trim() ?? "",
    };
  });

  const faqs = draft.faqs.filter((item) => item.selected).map((item) => {
    const question = item.question.trim();
    const answer = item.answer.trim();
    if (!question || !answer) {
      throw new WebsiteScanDraftValidationError(
        "Every selected FAQ needs both a question and an answer.",
      );
    }
    return {
      ...publishMetadata(item.id, item.targetId, item.baselineHash),
      question,
      answer,
    };
  });

  const knowledge: WebsiteScanPublishPayload["knowledge"] = [
    ...(includeOverview
      ? [
          {
            ...publishMetadata(
              draft.overviewMetadata?.suggestionId,
              draft.overviewMetadata?.targetId,
              draft.overviewMetadata?.baselineHash,
            ),
            kind: "overview" as const,
            category: "business_overview",
            title: "Business overview",
            content: overview,
          },
        ]
      : []),
    ...draft.knowledgeItems
      .filter((item) => item.selected)
      .map((item) => {
        const title = item.title.trim();
        const content = item.content.trim();
        if (!title || !content) {
          throw new WebsiteScanDraftValidationError(
            "Every selected fact or policy needs a title and content.",
          );
        }
        return {
          ...publishMetadata(item.id, item.targetId, item.baselineHash),
          kind: item.kind,
          category: item.category?.trim() || item.kind,
          title,
          content,
        };
      }),
  ];

  const questions = draft.questions.flatMap((question) => {
    if (question.disposition === "unanswered") return [];
    return [
      {
        questionId: question.id,
        status: question.disposition,
        answer:
          question.disposition === "answered" ? question.answer.trim() : null,
      },
    ];
  });

  return { services, faqs, knowledge, questions };
}

function publishMetadata(
  suggestionId: string | undefined,
  targetId: string | null | undefined,
  baselineHash: string | null | undefined,
): PublishSuggestion {
  const metadata: PublishSuggestion = {};
  if (suggestionId && uuidSchema.safeParse(suggestionId).success) {
    metadata.suggestionId = suggestionId;
  }
  if (targetId) {
    if (!baselineHash) {
      throw new WebsiteScanDraftValidationError(
        "This suggestion is out of date. Refresh the review and try again.",
      );
    }
    metadata.targetId = targetId;
    metadata.baselineHash = baselineHash;
  }
  return metadata;
}
