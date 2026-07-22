const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/**
 * Resolve the browser-facing application origin used by Stripe redirects.
 *
 * Railway can expose its internal origin as localhost:8080. Production and
 * test callers must therefore provide NEXT_PUBLIC_APP_URL explicitly; only a
 * local development server may fall back to the incoming request origin.
 */
export function publicAppOrigin(requestOrigin: string): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredUrl) {
    if (process.env.NODE_ENV === "development") {
      return parseHttpOrigin(requestOrigin, "request origin");
    }

    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required for Stripe redirects outside development"
    );
  }

  const origin = parseHttpOrigin(configuredUrl, "NEXT_PUBLIC_APP_URL");
  const hostname = new URL(origin).hostname.toLowerCase();

  if (
    process.env.NODE_ENV !== "development" &&
    (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost"))
  ) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must not use localhost outside development"
    );
  }

  return origin;
}

function parseHttpOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }

  return url.origin;
}
