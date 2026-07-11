import "server-only";

import { scrapeBusinessWebsite, scrapePageWithLinks } from "@/lib/firecrawl/client";
import { validatePublicHttpUrl, withTimeout } from "@/lib/firecrawl/webFetch";

// Multi-page crawler shared by both onboarding scan consumers: autofill
// (src/app/api/scrape/route.ts) and A2P risk screening
// (src/lib/messaging/registration/riskScreening.ts). It fetches the homepage,
// discovers a bounded set of same-origin subpages, fetches them resiliently in
// parallel, and returns a structured per-page result. Every page is fetched
// through Firecrawl (which renders JavaScript) so client-rendered /menu, /shop,
// and /products pages — exactly where prohibited inventory hides — are actually
// read rather than coming back as empty shells.

export interface CrawledPage {
  url: string; // absolute URL that was fetched
  path: string; // normalized pathname key (lowercased, no trailing slash)
  markdown: string; // Firecrawl markdown (non-empty for pages in `subpages`)
  riskRelevant: boolean; // path looks like a commerce/inventory page
}

export interface CrawlResult {
  homepageOk: boolean; // true only when the homepage returned usable markdown
  homepageMarkdown: string; // "" when homepageOk is false
  subpages: CrawledPage[]; // successfully fetched subpages (non-empty markdown)
  failedRiskRelevant: string[]; // risk-relevant paths that errored/timed out — drives fail-closed
  fetchedUrls: string[]; // sorted URLs actually fetched (homepage + subpages)
}

// Discovery is scored differently per consumer (see scoreOf): "risk" guesses
// commerce/inventory pages aggressively (that's where prohibited content hides,
// even on unlinked paths); "autofill" prefers pages the homepage actually links
// to and that carry services/FAQ/about content, so its tight cap isn't spent on
// guessed pages that 404.
export type DiscoveryMode = "risk" | "autofill";

export interface CrawlOptions {
  mode: DiscoveryMode; // scoring/priority profile for subpage discovery
  maxPages: number; // total page budget including the homepage
  perPageTimeoutMs: number; // per-page fetch timeout
  overallTimeoutMs: number; // wall-clock budget for the whole crawl
  concurrency: number; // max simultaneous subpage fetches
}

// Per-consumer profiles. Risk gets a larger budget because missing a prohibited
// subpage is a compliance failure; autofill is a convenience and stays leaner.
export const CRAWL_RISK_OPTS: CrawlOptions = {
  mode: "risk",
  maxPages: 6,
  perPageTimeoutMs: 8_000,
  overallTimeoutMs: 18_000,
  concurrency: 5,
};

export const CRAWL_AUTOFILL_OPTS: CrawlOptions = {
  mode: "autofill",
  maxPages: 4,
  perPageTimeoutMs: 8_000,
  overallTimeoutMs: 12_000,
  concurrency: 5,
};

const CRAWL_MEMO_TTL_MS = 10 * 60_000;

// High-value pages worth fetching even when a site's nav is JS-rendered or the
// links format comes back empty.
const FIXED_PATHS = [
  "/services",
  "/menu",
  "/products",
  "/shop",
  "/pricing",
  "/faq",
  "/faqs",
  "/about",
  "/about-us",
  "/contact",
];
// Autofill content-value: how useful a page is for extracting services/FAQs.
// Only consulted in "autofill" mode; higher wins a scarce cap slot. Paths not
// listed fall back to a keyword heuristic in contentValue().
const AUTOFILL_VALUE = new Map<string, number>([
  ["/services", 60],
  ["/menu", 58],
  ["/faq", 55],
  ["/faqs", 55],
  ["/about", 45],
  ["/about-us", 45],
  ["/pricing", 40],
  ["/products", 35],
  ["/shop", 35],
  ["/contact", 25],
]);

// Paths that never carry business/service content — skipped so they don't burn
// a slot under the page cap.
const NOISE_PATHS = new Set([
  "/cart",
  "/checkout",
  "/login",
  "/signin",
  "/sign-in",
  "/account",
  "/my-account",
  "/wp-admin",
  "/wp-login.php",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/terms-of-service",
]);

const ASSET_RE =
  /\.(pdf|jpe?g|png|gif|svg|webp|css|js|mjs|zip|ico|mp4|mov|webm|woff2?|ttf|eot|xml|rss)$/i;

// Commerce/inventory-style paths. Used to (a) prioritize which pages to keep
// under the cap and (b) decide fail-closed: a page like this that fails to
// fetch forces manual review rather than being silently dropped.
const RISK_PATH_RE =
  /(menu|shop|products?|store|catalog|pricing|services?|dispensary|liquor|vape|tobacco|firearm|cannabis|cbd)/i;

interface Candidate {
  url: string;
  path: string;
  riskRelevant: boolean; // commerce/inventory-style path (drives fail-closed)
  linked: boolean; // appeared in the homepage's nav links (i.e. probably exists)
  fixed: boolean; // came from the fixed high-value path floor
}

type Outcome =
  | { state: "fetched"; markdown: string }
  | { state: "empty" }
  | { state: "error" };

const memo = new Map<string, { at: number; value: Promise<CrawlResult> }>();

/**
 * Crawls a website starting from `url`. Throws only when the entered URL is
 * invalid or points at a private/internal host (SSRF guard) — callers should
 * treat a throw the same way they treat a total scan failure today. Any fetch
 * failure is reported in the returned CrawlResult, never thrown.
 */
export async function crawlSite(
  url: string,
  opts: CrawlOptions
): Promise<CrawlResult> {
  const safeUrl = await validatePublicHttpUrl(url);
  const key = `${memoKey(safeUrl)}::${opts.mode}::${opts.maxPages}`;

  const cached = memo.get(key);
  if (cached && Date.now() - cached.at < CRAWL_MEMO_TTL_MS) {
    return cached.value;
  }

  // Cache the in-flight promise so concurrent identical calls (e.g. a
  // double-click, or both consumers at once) share one crawl. But only KEEP it
  // if the crawl fully succeeds — a homepage failure or a failed risk-relevant
  // subpage is transient and must not be served from cache for 10 minutes, or a
  // retry would reuse the failure instead of re-fetching.
  const value = doCrawl(safeUrl, opts);
  pruneMemo();
  memo.set(key, { at: Date.now(), value });
  value
    .then((result) => {
      if (!isCacheable(result) && memo.get(key)?.value === value) {
        memo.delete(key);
      }
    })
    .catch(() => {
      if (memo.get(key)?.value === value) memo.delete(key);
    });
  return value;
}

// A crawl is worth caching only when it is complete: the homepage was read and
// no risk-relevant subpage errored/timed out. Partial coverage stays uncached
// so the next attempt re-crawls the pages that failed.
function isCacheable(result: CrawlResult): boolean {
  return result.homepageOk && result.failedRiskRelevant.length === 0;
}

async function doCrawl(safeUrl: string, opts: CrawlOptions): Promise<CrawlResult> {
  const start = Date.now();

  const homepage = await fetchHomepage(safeUrl, opts.perPageTimeoutMs);
  if (!homepage.ok) {
    return {
      homepageOk: false,
      homepageMarkdown: "",
      subpages: [],
      failedRiskRelevant: [],
      fetchedUrls: [],
    };
  }

  const candidates =
    opts.maxPages > 1
      ? discover(safeUrl, homepage.links, opts.maxPages, opts.mode)
      : [];

  const remaining = Math.max(0, opts.overallTimeoutMs - (Date.now() - start));
  const outcomes = await crawlSubpages(
    candidates,
    opts.perPageTimeoutMs,
    remaining,
    opts.concurrency
  );

  const subpages: CrawledPage[] = [];
  const failedRiskRelevant: string[] = [];
  candidates.forEach((candidate, i) => {
    const outcome = outcomes[i];
    if (outcome.state === "fetched") {
      subpages.push({
        url: candidate.url,
        path: candidate.path,
        markdown: outcome.markdown,
        riskRelevant: candidate.riskRelevant,
      });
    } else if (
      outcome.state === "error" &&
      candidate.riskRelevant &&
      candidate.linked
    ) {
      // Fail closed ONLY for risk-relevant pages the homepage actually links to
      // (known to exist) that error/time out. A fixed-floor GUESS that 404s just
      // means the page doesn't exist — failing closed on it would route every
      // site without a /menu|/shop|/products to manual review. A fetched-but-
      // empty page is likewise dropped (not a coverage gap).
      failedRiskRelevant.push(candidate.path);
    }
  });

  const fetchedUrls = [safeUrl, ...subpages.map((p) => p.url)].sort();

  return {
    homepageOk: true,
    homepageMarkdown: homepage.markdown,
    subpages,
    failedRiskRelevant,
    fetchedUrls,
  };
}

async function fetchHomepage(
  safeUrl: string,
  perPageTimeoutMs: number
): Promise<{ ok: true; markdown: string; links: string[] } | { ok: false }> {
  try {
    const page = await withTimeout(scrapePageWithLinks(safeUrl), perPageTimeoutMs, null);
    if (!page || !page.markdown.trim()) return { ok: false };
    return { ok: true, markdown: page.markdown, links: page.links };
  } catch {
    return { ok: false };
  }
}

async function crawlSubpages(
  candidates: Candidate[],
  perPageTimeoutMs: number,
  overallTimeoutMs: number,
  concurrency: number
): Promise<Outcome[]> {
  // Pessimistic default: any candidate we never finish resolving stays "error"
  // so an unfinished risk-relevant page fails closed rather than passing.
  const outcomes: Outcome[] = candidates.map(() => ({ state: "error" }));
  if (candidates.length === 0) return outcomes;

  let idx = 0;
  const worker = async () => {
    while (idx < candidates.length) {
      const cur = idx++;
      outcomes[cur] = await fetchSubpage(candidates[cur].url, perPageTimeoutMs);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, candidates.length) },
    () => worker()
  );
  // Bound the whole wave; workers each already catch their own errors, so
  // Promise.all never rejects. On overall timeout we keep partial outcomes.
  await withTimeout(Promise.all(workers).then(() => undefined), overallTimeoutMs, undefined);
  return outcomes;
}

async function fetchSubpage(url: string, perPageTimeoutMs: number): Promise<Outcome> {
  try {
    const markdown = await withTimeout<string | null>(
      scrapeBusinessWebsite(url),
      perPageTimeoutMs,
      null
    );
    if (markdown === null) return { state: "error" }; // timed out
    if (!markdown.trim()) return { state: "empty" }; // fetched but no content
    return { state: "fetched", markdown };
  } catch {
    return { state: "error" }; // 404 / network / Firecrawl !success
  }
}

function discover(
  safeUrl: string,
  homepageLinks: string[],
  maxPages: number,
  mode: DiscoveryMode
): Candidate[] {
  const base = new URL(safeUrl);
  const homeKey = pathKey(base.pathname);
  const byKey = new Map<string, Candidate>();

  const add = (rawHref: string, source: "fixed" | "nav") => {
    let u: URL;
    try {
      u = new URL(rawHref, base);
    } catch {
      return;
    }
    if (!sameOrigin(u, base)) return;
    const key = pathKey(u.pathname);
    if (key === homeKey) return; // the homepage itself
    if (ASSET_RE.test(key)) return;
    if (NOISE_PATHS.has(key)) return;
    const existing = byKey.get(key);
    if (existing) {
      // A fixed-floor guess that also appears in the nav is known to exist.
      if (source === "nav") existing.linked = true;
      return;
    }
    byKey.set(key, {
      url: `${base.origin}${key}`, // query + fragment stripped
      path: key,
      riskRelevant: RISK_PATH_RE.test(key),
      linked: source === "nav",
      fixed: source === "fixed",
    });
  };

  // Fixed floor first, then same-origin nav links from the homepage.
  for (const p of FIXED_PATHS) add(p, "fixed");
  for (const href of homepageLinks) add(href, "nav");

  // Deterministic ordering: score desc, then path asc. Determinism matters
  // because the fetched-URL set feeds the risk cache key downstream.
  const candidates = Array.from(byKey.values());
  candidates.sort(
    (a, b) => scoreOf(b, mode) - scoreOf(a, mode) || a.path.localeCompare(b.path)
  );
  return candidates.slice(0, Math.max(0, maxPages - 1));
}

function scoreOf(c: Candidate, mode: DiscoveryMode): number {
  return mode === "risk" ? riskScore(c) : autofillScore(c);
}

// Risk: commerce/inventory pages first, guessed or not — a dispensary may hide
// its /menu from the nav, so an unlinked fixed-floor guess still ranks high.
function riskScore(c: Candidate): number {
  let score = 0;
  if (c.riskRelevant) score += 100;
  if (c.fixed) score += 50;
  if (isTopLevel(c.path)) score += 10;
  return score;
}

// Autofill: pages the homepage actually links to (they exist) beat guessed
// fixed-floor paths, so the tight cap isn't wasted on 404s; among those,
// services/FAQ/about content wins over inventory pages.
function autofillScore(c: Candidate): number {
  let score = 0;
  if (c.linked) score += 100;
  score += contentValue(c.path);
  if (isTopLevel(c.path)) score += 10;
  return score;
}

function contentValue(path: string): number {
  const known = AUTOFILL_VALUE.get(path);
  if (known !== undefined) return known;
  if (/service|faq|about|pric|menu|offer|team|work/i.test(path)) return 30;
  return 10;
}

function isTopLevel(path: string): boolean {
  return path.split("/").filter(Boolean).length === 1;
}

function sameOrigin(a: URL, b: URL): boolean {
  return (
    a.protocol === b.protocol &&
    stripWww(a.hostname) === stripWww(b.hostname) &&
    effectivePort(a) === effectivePort(b)
  );
}

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function effectivePort(u: URL): string {
  if (u.port) return u.port;
  return u.protocol === "https:" ? "443" : "80";
}

function pathKey(pathname: string): string {
  return pathname.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function memoKey(safeUrl: string): string {
  const u = new URL(safeUrl);
  return `${u.protocol}//${stripWww(u.hostname)}:${effectivePort(u)}${pathKey(u.pathname)}`;
}

function pruneMemo(): void {
  const now = Date.now();
  const expired: string[] = [];
  memo.forEach((entry, key) => {
    if (now - entry.at >= CRAWL_MEMO_TTL_MS) expired.push(key);
  });
  for (const key of expired) memo.delete(key);
}
