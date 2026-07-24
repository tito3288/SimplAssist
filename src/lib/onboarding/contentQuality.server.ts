import "server-only";

import { evaluateContentQuality } from "@/lib/contentQuality";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ActiveServiceRow = {
  name: string;
  is_active: boolean | null;
};

type ActiveFaqRow = {
  question: string;
  answer: string;
  is_active: boolean | null;
};

/**
 * Reads the exact active knowledge available to the AI and evaluates it with
 * the shared client/server policy. Callers decide whether a completed or
 * carrier-review account is exempt from an initial-launch gate.
 */
export async function getBusinessContentQuality(businessId: string) {
  const [servicesResult, faqsResult] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("name, is_active")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .returns<ActiveServiceRow[]>(),
    supabaseAdmin
      .from("faqs")
      .select("question, answer, is_active")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .returns<ActiveFaqRow[]>(),
  ]);

  if (servicesResult.error) {
    throw new Error(
      `[content-quality] Failed to read services for ${businessId}: ${servicesResult.error.message}`
    );
  }
  if (faqsResult.error) {
    throw new Error(
      `[content-quality] Failed to read FAQs for ${businessId}: ${faqsResult.error.message}`
    );
  }

  return evaluateContentQuality(
    servicesResult.data ?? [],
    faqsResult.data ?? []
  );
}
