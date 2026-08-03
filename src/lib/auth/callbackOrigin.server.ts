import "server-only";

import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ConnectedPartnerDomainRow = {
  custom_domain: unknown;
  status: unknown;
  domain_status: unknown;
};

/**
 * Resolves an allow-listed callback origin without trusting a request origin.
 * The caller supplies only Host; proxy and preview headers are intentionally
 * outside this resolver's input contract.
 */
export async function resolveAuthCallbackOrigin(
  rawHost: string | null,
): Promise<string> {
  const canonicalOrigin = getCanonicalAppOrigin();
  const hostname = normalizeHostHeader(rawHost);

  if (!hostname) return canonicalOrigin;

  const canonicalHostname = new URL(canonicalOrigin).hostname.toLowerCase();
  if (hostname === canonicalHostname) return canonicalOrigin;

  return (
    (await resolveConnectedPartnerAuthCallbackOrigin(rawHost)) ??
    canonicalOrigin
  );
}

/**
 * Strict partner-only callback origin resolution for one-time concierge
 * recovery tokens. Unlike the ordinary callback resolver, this never falls
 * back to canonical: a bad/unavailable Host must not consume a token that was
 * issued for a connected partner domain.
 */
export async function resolveConnectedPartnerAuthCallbackOrigin(
  rawHost: string | null,
): Promise<string | null> {
  const hostname = normalizeHostHeader(rawHost);
  if (!hostname) return null;

  const canonicalHostname = new URL(getCanonicalAppOrigin()).hostname.toLowerCase();
  if (hostname === canonicalHostname) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from("partners")
      .select("custom_domain, status, domain_status")
      .eq("custom_domain", hostname)
      .eq("status", "active")
      .eq("domain_status", "connected")
      .maybeSingle<ConnectedPartnerDomainRow>();

    if (
      error ||
      !data ||
      data.status !== "active" ||
      data.domain_status !== "connected" ||
      typeof data.custom_domain !== "string"
    ) {
      return null;
    }

    const storedDomain = data.custom_domain;
    if (
      !storedDomain.includes(".") ||
      normalizeHostHeader(storedDomain) !== storedDomain ||
      storedDomain !== hostname
    ) {
      return null;
    }

    return `https://${storedDomain}`;
  } catch {
    return null;
  }
}
