import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnowledgeGap } from "@/types/database";

export const KNOWLEDGE_GAP_PAGE_SIZE = 1000;

type KnowledgeGapReadClient = Pick<SupabaseClient, "from">;

export type LoadKnowledgeGapsResult =
  | { data: KnowledgeGap[]; error: null }
  | { data: []; error: unknown };

export async function loadKnowledgeGaps(
  client: KnowledgeGapReadClient,
  businessId: string
): Promise<LoadKnowledgeGapsResult> {
  const gaps: KnowledgeGap[] = [];
  let afterId: string | null = null;

  while (true) {
    let query = client
      .from("knowledge_gaps")
      .select("*")
      .eq("business_id", businessId)
      .order("id", { ascending: true });

    if (afterId) {
      query = query.gt("id", afterId);
    }

    const { data, error } = await query.limit(KNOWLEDGE_GAP_PAGE_SIZE);

    if (error) return { data: [], error };

    const page = (data ?? []) as KnowledgeGap[];
    gaps.push(...page);

    if (page.length < KNOWLEDGE_GAP_PAGE_SIZE) {
      return { data: gaps, error: null };
    }

    afterId = page[page.length - 1].id;
  }
}
