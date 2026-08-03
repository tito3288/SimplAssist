const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PARTNER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Parses the value of one Host header into a hostname suitable for exact
 * comparison. It deliberately does not parse URLs or proxy-forwarding lists.
 */
export function normalizeHostHeader(
  rawHost: string | null | undefined,
): string | null {
  if (!rawHost || rawHost.length > 512) return null;

  // Reject list-valued/proxy-shaped headers, URL syntax, userinfo, IPv6, and
  // every whitespace/control character before doing any normalization.
  if (
    /[\s\u0000-\u001f\u007f]/.test(rawHost) ||
    /[,/\\@?#\[\]]/.test(rawHost)
  ) {
    return null;
  }

  let hostname = rawHost;
  const firstColon = hostname.indexOf(":");
  if (firstColon !== -1) {
    if (firstColon !== hostname.lastIndexOf(":")) return null;

    const port = hostname.slice(firstColon + 1);
    hostname = hostname.slice(0, firstColon);
    if (!/^\d+$/.test(port)) return null;

    const portNumber = Number(port);
    if (portNumber < 1 || portNumber > 65535) return null;
  }

  // A DNS absolute name may contain one final dot. Removing exactly one
  // still causes a malformed double-dot suffix to fail label validation.
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  hostname = hostname.toLowerCase();

  if (!hostname || hostname.length > 253) return null;

  const labels = hostname.split(".");
  if (labels.some((label) => !HOST_LABEL.test(label))) return null;

  return hostname;
}

export function isValidPartnerSlug(value: string): boolean {
  return value.length >= 1 && value.length <= 63 && PARTNER_SLUG.test(value);
}
