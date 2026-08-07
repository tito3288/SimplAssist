import "server-only";

import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ConnectedPartnerDomainRow = {
  custom_domain: unknown;
  status: unknown;
  domain_status: unknown;
};

type ConnectedPartnerIdentityRow = ConnectedPartnerDomainRow & {
  id: unknown;
};

export type StrictAuthCallbackOrigin =
  | {
      origin: string;
      kind: "direct";
      partnerId: null;
    }
  | {
      origin: string;
      kind: "partner";
      partnerId: string;
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
 * Resolves the exact direct or active partner identity represented by Host.
 * Unlike the ordinary callback resolver, this has no fallback: recovery
 * tokens must not be verified for an unknown or unavailable request domain.
 */
export async function resolveStrictAuthCallbackOrigin(
  rawHost: string | null,
): Promise<StrictAuthCallbackOrigin | null> {
  const hostname = normalizeHostHeader(rawHost);
  if (!hostname) return null;

  const canonicalOrigin = getCanonicalAppOrigin();
  const canonicalHostname = new URL(canonicalOrigin).hostname.toLowerCase();
  if (hostname === canonicalHostname) {
    return { origin: canonicalOrigin, kind: "direct", partnerId: null };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("partners")
      .select("id, custom_domain, status, domain_status")
      .eq("custom_domain", hostname)
      .eq("status", "active")
      .eq("domain_status", "connected")
      .maybeSingle<ConnectedPartnerIdentityRow>();

    if (
      error ||
      !data ||
      typeof data.id !== "string" ||
      !isCanonicalUuid(data.id) ||
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

    return {
      origin: `https://${storedDomain}`,
      kind: "partner",
      partnerId: data.id,
    };
  } catch {
    return null;
  }
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

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}
