import Firecrawl from "@mendable/firecrawl-js";

// The v4 client targets Firecrawl's v2 API. These two small wrappers preserve
// the exact single-page contract used by the legacy onboarding and A2P
// crawlers while the richer scanner uses the asynchronous v2 crawl API.
export const firecrawl = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY ?? "",
});

export async function scrapeBusinessWebsite(url: string): Promise<string> {
  const result = await firecrawl.v1.scrapeUrl(url, { formats: ["markdown"] });
  if (!result.success) throw new Error(`Firecrawl scrape failed: ${result.error}`);
  return result.markdown ?? "";
}

// Scrapes a single page for both its markdown content and its outbound links
// in one Firecrawl call. The multi-page crawler (src/lib/firecrawl/crawl.ts)
// uses the links to discover same-origin subpages without a second request.
export async function scrapePageWithLinks(
  url: string
): Promise<{ markdown: string; links: string[] }> {
  const result = await firecrawl.v1.scrapeUrl(url, {
    formats: ["markdown", "links"],
  });
  if (!result.success) throw new Error(`Firecrawl scrape failed: ${result.error}`);

  return {
    markdown: result.markdown ?? "",
    links: result.links ?? [],
  };
}
