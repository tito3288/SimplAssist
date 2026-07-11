import FirecrawlApp from "@mendable/firecrawl-js";

export const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY ?? "",
});

export async function scrapeBusinessWebsite(url: string): Promise<string> {
  const result = await firecrawl.scrapeUrl(url, { formats: ["markdown"] });

  if (!result.success) {
    throw new Error(`Firecrawl scrape failed: ${result.error}`);
  }

  return result.markdown ?? "";
}

// Scrapes a single page for both its markdown content and its outbound links
// in one Firecrawl call. The multi-page crawler (src/lib/firecrawl/crawl.ts)
// uses the links to discover same-origin subpages without a second request.
export async function scrapePageWithLinks(
  url: string
): Promise<{ markdown: string; links: string[] }> {
  const result = await firecrawl.scrapeUrl(url, {
    formats: ["markdown", "links"],
  });

  if (!result.success) {
    throw new Error(`Firecrawl scrape failed: ${result.error}`);
  }

  return {
    markdown: result.markdown ?? "",
    links: result.links ?? [],
  };
}
