import { createHash } from "node:crypto";

import Firecrawl, {
  type CrawlJob,
  type Document,
} from "@mendable/firecrawl-js";

import {
  SCAN_PAGE_CHARACTER_LIMIT,
  SCAN_PAGE_LIMIT,
  SCAN_TOTAL_CHARACTER_LIMIT,
  type WebsiteScanPage,
} from "./domain";
import { validatePublicHttpUrl } from "../firecrawl/publicUrl";

const EXCLUDE_PATHS = [
  "**/login/**",
  "**/signin/**",
  "**/sign-in/**",
  "**/account/**",
  "**/cart/**",
  "**/checkout/**",
  "**/wp-admin/**",
  "**/wp-login.php",
  "**/blog/**",
  "**/news/**",
  "**/author/**",
  "**/tag/**",
  "**/category/**",
  "**/feed/**",
];

export interface WebsiteCrawlProgress {
  status: "scraping" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  creditsUsed: number;
  pages: WebsiteScanPage[];
}

export interface WebsiteCrawlProvider {
  start(sourceUrl: string): Promise<{ jobId: string }>;
  status(jobId: string, sourceUrl: string): Promise<WebsiteCrawlProgress>;
  retryFailedPages(jobId: string, sourceUrl: string, existingUrls: Set<string>): Promise<{
    pages: WebsiteScanPage[];
    failedCount: number;
    failedUrls: string[];
  }>;
  cancel(jobId: string): Promise<void>;
}

export class FirecrawlWebsiteProvider implements WebsiteCrawlProvider {
  private readonly client: Firecrawl;

  constructor(options: { apiKey?: string; client?: Firecrawl } = {}) {
    this.client =
      options.client ??
      new Firecrawl({
        apiKey: options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? "",
        maxRetries: 2,
        timeoutMs: 30_000,
      });
  }

  async start(sourceUrl: string): Promise<{ jobId: string }> {
    const safeUrl = await validatePublicHttpUrl(sourceUrl);
    const response = await this.client.startCrawl(safeUrl, {
      limit: SCAN_PAGE_LIMIT,
      maxDiscoveryDepth: 2,
      sitemap: "include",
      ignoreQueryParameters: true,
      deduplicateSimilarURLs: true,
      crawlEntireDomain: false,
      allowExternalLinks: false,
      allowSubdomains: false,
      excludePaths: EXCLUDE_PATHS,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
        timeout: 30_000,
      },
      origin: "simplassist-website-scan",
    });
    if (!response.id) throw new WebsiteCrawlError("provider_start_failed", "The website crawl could not be started", true);
    return { jobId: response.id };
  }

  async status(jobId: string, sourceUrl: string): Promise<WebsiteCrawlProgress> {
    const job = await this.client.getCrawlStatus(jobId, {
      autoPaginate: true,
      maxResults: SCAN_PAGE_LIMIT,
      maxPages: 2,
      maxWaitTime: 20,
    });
    return normalizeJob(job, sourceUrl);
  }

  async retryFailedPages(
    jobId: string,
    sourceUrl: string,
    existingUrls: Set<string>
  ): Promise<{ pages: WebsiteScanPage[]; failedCount: number; failedUrls: string[] }> {
    let errors;
    try {
      errors = await this.client.getCrawlErrors(jobId);
    } catch {
      // Error discovery is supplemental. Do not discard readable crawl pages
      // just because Firecrawl's errors endpoint is temporarily unavailable;
      // mark coverage partial and let extraction continue.
      return { pages: [], failedCount: 1, failedUrls: [] };
    }
    const urls = Array.from(
      new Set([...errors.errors.map((entry) => entry.url), ...errors.robotsBlocked])
    ).filter((url) => isAllowedPageUrl(url, sourceUrl) && !existingUrls.has(normalizeUrl(url)))
      .slice(0, Math.max(0, SCAN_PAGE_LIMIT - existingUrls.size));

    const settled = await Promise.allSettled(
      urls.map(async (url) => {
        const safeRetryUrl = await validatePublicHttpUrl(url);
        const document = await this.client.scrape(safeRetryUrl, {
          formats: ["markdown"],
          onlyMainContent: true,
          removeBase64Images: true,
          timeout: 30_000,
        });
        return normalizeDocument(document, sourceUrl);
      })
    );
    const pages = settled.flatMap((outcome) =>
      outcome.status === "fulfilled" && outcome.value ? [outcome.value] : []
    );
    const successfulUrls = new Set(pages.map((page) => page.url));
    const failedUrls = urls.map(normalizeUrl).filter((url) => !successfulUrls.has(url));
    return { pages, failedCount: failedUrls.length, failedUrls };
  }

  async cancel(jobId: string): Promise<void> {
    try {
      await this.client.cancelCrawl(jobId);
    } catch {
      // Cancellation is best effort; DB cancellation remains authoritative.
    }
  }
}

export class WebsiteCrawlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "WebsiteCrawlError";
  }
}

export function normalizeJob(job: CrawlJob, sourceUrl: string): WebsiteCrawlProgress {
  return {
    status: job.status,
    total: Math.min(SCAN_PAGE_LIMIT, Math.max(job.total, job.data.length)),
    completed: Math.min(SCAN_PAGE_LIMIT, job.completed),
    creditsUsed: Math.max(0, job.creditsUsed ?? 0),
    pages: prepareWebsiteScanPages(
      deduplicatePages(
        job.data.slice(0, SCAN_PAGE_LIMIT).flatMap((document) => {
          const page = normalizeDocument(document, sourceUrl);
          return page ? [page] : [];
        })
      )
    ),
  };
}

export function normalizeDocument(
  document: Document,
  sourceUrl: string
): WebsiteScanPage | null {
  const rawUrl = document.metadata?.sourceURL ?? document.metadata?.url;
  const markdown = document.markdown?.trim() ?? "";
  if (!rawUrl || !markdown || !isAllowedPageUrl(rawUrl, sourceUrl)) return null;
  if (
    document.metadata?.url &&
    !isAllowedPageUrl(document.metadata.url, sourceUrl)
  ) {
    return null;
  }
  const url = normalizeUrl(rawUrl);
  const capped = truncateCodePoints(markdown, SCAN_PAGE_CHARACTER_LIMIT);
  return {
    url,
    title: cleanNullable(document.metadata?.title),
    markdown: capped,
    contentHash: createHash("sha256").update(capped).digest("hex"),
    characterCount: codePointLength(capped),
  };
}

export function isAllowedPageUrl(candidate: string, sourceUrl: string): boolean {
  try {
    const url = new URL(candidate);
    const source = new URL(sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    return normalizedHostname(url.hostname) === normalizedHostname(source.hostname);
  } catch {
    return false;
  }
}

export function normalizeUrl(value: string): string {
  const url = new URL(value);
  // Scan metadata and evidence are stored as secure public URLs. Firecrawl may
  // report the originally-entered http URL even after following an HTTPS
  // canonical redirect, so normalize it before both persistence and citation.
  if (url.protocol === "http:") url.protocol = "https:";
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLocaleLowerCase("en-US");
  if (url.port === "443" || url.port === "80") {
    url.port = "";
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function normalizedHostname(hostname: string): string {
  return hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
}

function deduplicatePages(pages: WebsiteScanPage[]): WebsiteScanPage[] {
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  return pages.filter((page) => {
    if (seenUrls.has(page.url) || seenHashes.has(page.contentHash)) return false;
    seenUrls.add(page.url);
    seenHashes.add(page.contentHash);
    return true;
  });
}

export function prepareWebsiteScanPages(pages: WebsiteScanPage[]): WebsiteScanPage[] {
  return limitCombinedPages(
    deduplicatePages(pages).sort(
      (left, right) => pageValue(right.url) - pageValue(left.url) || left.url.localeCompare(right.url)
    )
  );
}

function pageValue(value: string): number {
  const path = new URL(value).pathname.toLocaleLowerCase("en-US");
  if (path === "/") return 1_000;
  const weights: Array<[RegExp, number]> = [
    [/(services?|offerings?)/, 900],
    [/(faq|frequently-asked)/, 850],
    [/(pricing|prices|rates|menu)/, 800],
    [/(refund|return|cancel|reschedul|warranty|guarantee|policy)/, 750],
    [/(about|team|company)/, 700],
    [/(contact|location|service-area|hours)/, 650],
    [/(book|appointment|schedule)/, 600],
    [/(privacy|terms)/, 300],
  ];
  return weights.find(([pattern]) => pattern.test(path))?.[1] ?? 500;
}

function limitCombinedPages(pages: WebsiteScanPage[]): WebsiteScanPage[] {
  let remaining = SCAN_TOTAL_CHARACTER_LIMIT;
  return pages.slice(0, SCAN_PAGE_LIMIT).flatMap((page) => {
    if (remaining <= 0) return [];
    const markdown = truncateCodePoints(page.markdown, remaining);
    const characterCount = codePointLength(markdown);
    remaining -= characterCount;
    if (!markdown) return [];
    return [{
      ...page,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      characterCount,
    }];
  });
}

function cleanNullable(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? truncateCodePoints(value.trim(), 500)
    : null;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function truncateCodePoints(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  let count = 0;
  let utf16End = 0;
  for (const codePoint of value) {
    count += 1;
    utf16End += codePoint.length;
    if (count === maximum) {
      return utf16End === value.length ? value : value.slice(0, utf16End);
    }
  }
  return value;
}
