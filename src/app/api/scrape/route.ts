import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  crawlSite,
  CRAWL_AUTOFILL_OPTS,
  type CrawlResult,
} from "@/lib/firecrawl/crawl";
import { extractBusinessInfo } from "@/lib/firecrawl/extract";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

const scrapeSchema = z.object({
  url: z.string().url().refine(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
    { message: "URL must use http or https protocol" }
  ),
});

// Simple in-memory rate limiting: IP -> timestamps[]
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

// Caps the combined multi-page markdown handed to the extractor LLM. Homepage
// content comes first, so if the site is huge the homepage is always kept and
// only trailing subpage content is trimmed. Lives here (not in the extractor)
// so extractBusinessInfo stays cap-free. ~60k chars ≈ 15k tokens — ample for
// Claude Haiku's extraction and far under its context window.
const MAX_AUTOFILL_INPUT_CHARS = 60_000;

// Flattens a crawl into homepage-first markdown for the extractor. Returns ""
// when the homepage could not be read, which yields EMPTY_RESULT downstream —
// exactly today's behavior for a failed scan.
function assembleAutofillInput(crawl: CrawlResult): string {
  if (!crawl.homepageOk) return "";
  let combined = crawl.homepageMarkdown;
  for (const page of crawl.subpages) {
    combined += `\n\n--- ${page.path} ---\n\n${page.markdown}`;
  }
  return combined.slice(0, MAX_AUTOFILL_INPUT_CHARS);
}

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(identifier) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(identifier, recent);
    return true;
  }

  recent.push(now);
  rateLimitMap.set(identifier, recent);
  return false;
}

export async function POST(request: NextRequest) {
  const workspaceGate = await requireWorkspaceRouteAccess();
  if (!workspaceGate.ok) return workspaceGate.response;

  // This is the one Anthropic-backed pre-checkout exception: it only prefills
  // the editable onboarding form. Require an authenticated owner whose
  // onboarding is still incomplete so it cannot become a public or post-sale
  // plan-wall bypass.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, onboarding_completed_at")
    .eq("owner_id", user.id)
    .maybeSingle<{ id: string; onboarding_completed_at: string | null }>();

  if (businessError) {
    console.error("[scrape] Onboarding authorization lookup failed:", businessError);
    return NextResponse.json(
      { error: "Service temporarily unavailable", retryable: true },
      { status: 503 }
    );
  }
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }
  if (business.onboarding_completed_at) {
    return NextResponse.json(
      { error: "Website scan is only available during onboarding" },
      { status: 403 }
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const parsed = scrapeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid URL", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const crawl = await crawlSite(parsed.data.url, CRAWL_AUTOFILL_OPTS);
    const rawContent = assembleAutofillInput(crawl);
    const businessInfo = await extractBusinessInfo(rawContent);

    return NextResponse.json(businessInfo);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Scraping failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
