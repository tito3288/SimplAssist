import "server-only";
import type {} from "react/canary";

import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { cache } from "react";
import { DEFAULT_BRAND, getCanonicalAppHostname } from "./defaultBrand";
import { isValidPartnerSlug, normalizeHostHeader } from "./hostname";
import {
  findPartnerBrandByHostname,
  findPartnerBrandBySlug,
} from "./repository.server";
import {
  BRAND_PREVIEW_HEADER,
  type PublicBrand,
  type RequestBrand,
} from "./types";

function defaultRequestBrand(): RequestBrand {
  return {
    source: "default",
    isPreview: false,
    brand: DEFAULT_BRAND,
  };
}

function previewRequestBrand(brand: PublicBrand): RequestBrand {
  return {
    source: "admin_preview",
    isPreview: true,
    brand,
  };
}

async function resolveRequestBrand(): Promise<RequestBrand> {
  noStore();
  const requestHeaders = headers();

  // Middleware strips this client-controlled header on every request and
  // restores it only after authoritative admin-channel authorization.
  const previewSlug = requestHeaders.get(BRAND_PREVIEW_HEADER);
  if (previewSlug !== null) {
    // Defense in depth: malformed/duplicate-combined values fail closed and
    // cannot fall through to host branding.
    if (!isValidPartnerSlug(previewSlug)) return defaultRequestBrand();

    try {
      const previewBrand = await findPartnerBrandBySlug(previewSlug);
      return previewRequestBrand(previewBrand ?? DEFAULT_BRAND);
    } catch (error) {
      console.error(
        "[branding] Partner preview lookup failed; using default branding.",
        error,
      );
      return previewRequestBrand(DEFAULT_BRAND);
    }
  }

  // Host is the sole hostname input. Forwarded and X-Forwarded-Host are
  // intentionally not consulted.
  const hostname = normalizeHostHeader(requestHeaders.get("host"));
  if (!hostname || hostname === getCanonicalAppHostname()) {
    return defaultRequestBrand();
  }

  try {
    const partnerBrand = await findPartnerBrandByHostname(hostname);
    return partnerBrand
      ? {
          source: "partner_host",
          isPreview: false,
          brand: partnerBrand,
        }
      : defaultRequestBrand();
  } catch (error) {
    console.error(
      "[branding] Partner hostname lookup failed; using default branding.",
      error,
    );
    return defaultRequestBrand();
  }
}

// React cache is scoped to the active server-render request. It deduplicates
// root metadata/layout/page consumers without retaining hostname state across
// requests or introducing a module-level mutable cache.
export const getRequestBrand = cache(resolveRequestBrand);
