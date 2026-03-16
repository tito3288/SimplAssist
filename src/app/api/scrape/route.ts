import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scrapeBusinessWebsite } from "@/lib/firecrawl/client";
import { extractBusinessInfo } from "@/lib/firecrawl/extract";

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

    const rawContent = await scrapeBusinessWebsite(parsed.data.url);
    const businessInfo = await extractBusinessInfo(rawContent);

    return NextResponse.json(businessInfo);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Scraping failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
