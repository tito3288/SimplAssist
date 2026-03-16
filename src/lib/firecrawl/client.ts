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
