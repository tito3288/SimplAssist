import { supabaseAdmin } from "@/lib/supabase/admin";

export interface RecordKnowledgeGapInput {
  businessId: string;
  sourceMessageId: string;
  aiResponseText: string;
}

/**
 * Best-effort capture must never interfere with delivering an AI response.
 */
export async function recordKnowledgeGap({
  businessId,
  sourceMessageId,
  aiResponseText,
}: RecordKnowledgeGapInput): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.rpc("record_knowledge_gap", {
      p_business_id: businessId,
      p_source_message_id: sourceMessageId,
      p_ai_response_text: aiResponseText,
    });

    if (error) {
      console.error(
        `[knowledge-gaps] Capture failed for business=${businessId} source_message=${sourceMessageId}:`,
        error
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `[knowledge-gaps] Capture threw for business=${businessId} source_message=${sourceMessageId}:`,
      error
    );
    return false;
  }
}
