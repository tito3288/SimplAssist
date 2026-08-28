import "server-only";

export { validatePublicHttpUrl } from "./publicUrl";

// Shared website-fetch primitives used by both the multi-page crawler
// (src/lib/firecrawl/crawl.ts) and A2P risk screening
// (src/lib/messaging/registration/riskScreening.ts). Kept in a neutral module
// so the two callers don't have to import each other.

export const WEBSITE_FETCH_TIMEOUT_MS = 12_000;
export const MAX_WEBSITE_TEXT_CHARS = 80_000;

// Resolves the URL and rejects anything that points at a private/internal
// host or IP (SSRF guard). Callers must re-validate on every redirect hop.
// Races a promise against a timeout, resolving to `fallback` if it doesn't
// settle in time. The losing promise is left to settle on its own.
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Hard-caps scanned website text so one page can't blow up downstream
// regex matching or LLM input. Applied per page, never across pages.
export function limitText(value: string): string {
  return value.slice(0, MAX_WEBSITE_TEXT_CHARS);
}
