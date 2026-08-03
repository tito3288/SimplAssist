import { normalizeHostHeader } from "@/lib/branding/hostname";

function configuredCanonicalHostname(): string | null {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredOrigin) return null;

  try {
    const url = new URL(configuredOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeHostHeader(url.host);
  } catch {
    return null;
  }
}

export function isCanonicalAdminHostname(rawHost: string | null): boolean {
  const requestHostname = normalizeHostHeader(rawHost);
  const canonicalHostname = configuredCanonicalHostname();

  return !!requestHostname && requestHostname === canonicalHostname;
}
