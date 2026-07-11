import "server-only";

import dns from "dns/promises";
import net from "net";

// Shared website-fetch primitives used by both the multi-page crawler
// (src/lib/firecrawl/crawl.ts) and A2P risk screening
// (src/lib/messaging/registration/riskScreening.ts). Kept in a neutral module
// so the two callers don't have to import each other.

export const WEBSITE_FETCH_TIMEOUT_MS = 12_000;
export const MAX_WEBSITE_TEXT_CHARS = 80_000;

// Resolves the URL and rejects anything that points at a private/internal
// host or IP (SSRF guard). Callers must re-validate on every redirect hop.
export async function validatePublicHttpUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Website URL must use http or https");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Website URL cannot point to a private host");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("Website URL cannot point to a private IP address");
    }
    return parsed.toString();
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: false });
  if (addresses.length === 0) {
    throw new Error("Website host could not be resolved");
  }

  if (addresses.some((address) => isBlockedIp(address.address))) {
    throw new Error("Website URL resolves to a private IP address");
  }

  return parsed.toString();
}

function isBlockedIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  const [a, b] = parts;
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  if (address === "169.254.169.254") return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("2001:db8")
  );
}

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
