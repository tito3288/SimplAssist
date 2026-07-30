import type { SupabaseClient } from "@supabase/supabase-js";
import { FAQ_ANSWER_MAX_LENGTH } from "@/lib/contentQuality";

export type KnowledgeGapMutationClient = Pick<
  SupabaseClient,
  "from" | "rpc"
>;

export interface ResolveKnowledgeGapInput {
  gapId: string;
  question: string;
  answer: string;
}

export interface DismissKnowledgeGapInput {
  gapId: string;
  businessId: string;
}

export type ResolveKnowledgeGapResult =
  | {
      ok: true;
      faqId: string;
      question: string;
      answer: string;
    }
  | {
      ok: false;
      message: string;
    };

export type DismissKnowledgeGapResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

export const DUPLICATE_FAQ_MESSAGE =
  "An active FAQ already uses this question. Edit the question or manage the existing FAQ in Settings.";

export const CONVERSION_ERROR_MESSAGE =
  "Could not add this FAQ. Please try again.";

export const DISMISSAL_ERROR_MESSAGE =
  "Could not dismiss this knowledge gap. Please try again.";

export const GAP_NO_LONGER_OPEN_MESSAGE =
  "This knowledge gap is no longer open. Refresh the page to see its latest status.";

export function validateKnowledgeGapFaq(
  question: string,
  answer: string
): string | null {
  if (!question.trim()) return "A question is required.";
  if (!answer.trim()) return "An answer is required.";

  if (answer.trim().length > FAQ_ANSWER_MAX_LENGTH) {
    return `Answer must be ${FAQ_ANSWER_MAX_LENGTH.toLocaleString("en-US")} characters or less.`;
  }

  return null;
}

export async function resolveKnowledgeGapWithFaq(
  client: KnowledgeGapMutationClient,
  input: ResolveKnowledgeGapInput
): Promise<ResolveKnowledgeGapResult> {
  const validationError = validateKnowledgeGapFaq(
    input.question,
    input.answer
  );

  if (validationError) {
    return { ok: false, message: validationError };
  }

  const question = input.question.trim();
  const answer = input.answer.trim();

  try {
    const { data, error } = await client.rpc(
      "resolve_knowledge_gap_with_faq",
      {
        p_gap_id: input.gapId,
        p_question: question,
        p_answer: answer,
      }
    );

    if (error) {
      return {
        ok: false,
        message: conversionErrorMessage(error),
      };
    }

    if (typeof data !== "string" || !data) {
      return { ok: false, message: CONVERSION_ERROR_MESSAGE };
    }

    return {
      ok: true,
      faqId: data,
      question,
      answer,
    };
  } catch (error) {
    return {
      ok: false,
      message: conversionErrorMessage(error),
    };
  }
}

export async function dismissKnowledgeGap(
  client: KnowledgeGapMutationClient,
  input: DismissKnowledgeGapInput
): Promise<DismissKnowledgeGapResult> {
  try {
    const { data, error } = await client
      .from("knowledge_gaps")
      .update({ status: "dismissed" })
      .eq("business_id", input.businessId)
      .eq("id", input.gapId)
      .eq("status", "open")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      return { ok: false, message: DISMISSAL_ERROR_MESSAGE };
    }

    if (!data) {
      return { ok: false, message: GAP_NO_LONGER_OPEN_MESSAGE };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: DISMISSAL_ERROR_MESSAGE };
  }
}

function isDuplicateFaqError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  return "code" in error && error.code === "23505";
}

function conversionErrorMessage(error: unknown): string {
  if (isDuplicateFaqError(error)) return DUPLICATE_FAQ_MESSAGE;
  if (isStaleGapError(error)) return GAP_NO_LONGER_OPEN_MESSAGE;
  return CONVERSION_ERROR_MESSAGE;
}

function isStaleGapError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return error.code === "P0002" || error.code === "40001";
}
