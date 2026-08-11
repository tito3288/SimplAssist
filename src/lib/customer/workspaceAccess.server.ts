import "server-only";
import type {} from "react/canary";

import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { cache } from "react";
import {
  isAuthApiError,
  isAuthSessionMissingError,
  type User,
} from "@supabase/supabase-js";
import {
  DEFAULT_BRAND,
  getCanonicalAppOrigin,
} from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { BillingMode, PrimaryGoal } from "@/types/database";

export type CustomerBusiness = {
  id: string;
  partner_id: string | null;
  billing_mode: BillingMode;
  primary_goal: PrimaryGoal | null;
};

export type ResolvedWorkspaceAccess = {
  status: "resolved";
  user: User;
  business: CustomerBusiness;
  hostKind: "canonical" | "partner";
};

export type WorkspaceAccess =
  | { status: "unauthenticated" }
  | { status: "business_not_found" }
  | { status: "lookup_failed" }
  | { status: "unknown_host" }
  | { status: "partner_unavailable" }
  | {
      status: "mismatch";
      expectedOrigin: string | null;
      expectedName: string | null;
    }
  | ResolvedWorkspaceAccess;

type PartnerTenancyRow = {
  id: unknown;
  name: unknown;
  custom_domain: unknown;
  status: unknown;
  domain_status: unknown;
};

type PartnerTenancy = {
  id: string;
  name: string;
  customDomain: string | null;
  status: "active" | "inactive";
  domainStatus: "pending" | "connected";
};

type PartnerLookup =
  | { status: "found"; partner: PartnerTenancy }
  | { status: "missing" }
  | { status: "failed" };

const CUSTOMER_BUSINESS_COLUMNS =
  "id, partner_id, billing_mode, primary_goal";
const PARTNER_TENANCY_COLUMNS =
  "id, name, custom_domain, status, domain_status";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveWorkspaceAccess(): Promise<WorkspaceAccess> {
  noStore();

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { status: "lookup_failed" };
  }

  let user: User | null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (result.error) {
      if (!user && isUnauthenticatedAuthError(result.error)) {
        return { status: "unauthenticated" };
      }
      return { status: "lookup_failed" };
    }
  } catch {
    return { status: "lookup_failed" };
  }

  if (!user) return { status: "unauthenticated" };
  if (!isUuid(user.id)) return { status: "lookup_failed" };

  let businessResult: {
    data: CustomerBusiness | null;
    error: { message?: string } | null;
  };
  try {
    businessResult = await supabase
      .from("businesses")
      .select(CUSTOMER_BUSINESS_COLUMNS)
      .eq("owner_id", user.id)
      .maybeSingle<CustomerBusiness>();
  } catch {
    return { status: "lookup_failed" };
  }

  if (businessResult.error) return { status: "lookup_failed" };
  if (!businessResult.data) return { status: "business_not_found" };

  const business = parseCustomerBusiness(businessResult.data);
  if (!business) return { status: "lookup_failed" };

  const canonical = canonicalWorkspace();
  if (!canonical) return { status: "lookup_failed" };

  let assignedPartner: PartnerTenancy | null = null;
  if (business.partner_id) {
    const assignedLookup = await findPartnerById(business.partner_id);
    if (assignedLookup.status === "failed") return { status: "lookup_failed" };
    if (assignedLookup.status === "missing") {
      return { status: "partner_unavailable" };
    }
    if (!isAvailablePartner(assignedLookup.partner, canonical.hostname)) {
      return { status: "partner_unavailable" };
    }
    assignedPartner = assignedLookup.partner;
  }

  let requestHostname: string | null;
  try {
    requestHostname = normalizeHostHeader(headers().get("host"));
  } catch {
    return { status: "lookup_failed" };
  }
  if (!requestHostname) return { status: "unknown_host" };

  if (requestHostname === canonical.hostname) {
    if (!assignedPartner) {
      return { status: "resolved", user, business, hostKind: "canonical" };
    }
    return mismatchForPartner(assignedPartner);
  }

  const hostLookup = await findPartnerByHostname(requestHostname);
  if (hostLookup.status === "failed") return { status: "lookup_failed" };
  if (hostLookup.status === "missing") return { status: "unknown_host" };
  if (!isAvailablePartner(hostLookup.partner, canonical.hostname)) {
    return { status: "partner_unavailable" };
  }

  if (!assignedPartner) {
    return {
      status: "mismatch",
      expectedOrigin: canonical.origin,
      expectedName: canonical.name,
    };
  }

  // Domain uniqueness is enforced in the database, but access is granted by
  // comparing the host-resolved partner UUID to the business assignment. A
  // name, slug, or domain suffix never acts as membership evidence.
  if (hostLookup.partner.id === assignedPartner.id) {
    return { status: "resolved", user, business, hostKind: "partner" };
  }

  return mismatchForPartner(assignedPartner);
}

function parseCustomerBusiness(value: unknown): CustomerBusiness | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(row.id)) return null;
  if (row.partner_id !== null && !isUuid(row.partner_id)) return null;
  if (!isBillingMode(row.billing_mode)) return null;
  if (!isPrimaryGoal(row.primary_goal)) return null;
  return {
    id: row.id,
    partner_id: row.partner_id,
    billing_mode: row.billing_mode,
    primary_goal: row.primary_goal,
  };
}

function parsePartner(value: unknown): PartnerTenancy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as PartnerTenancyRow;
  if (!isUuid(row.id)) return null;
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  if (row.status !== "active" && row.status !== "inactive") return null;
  if (row.domain_status !== "pending" && row.domain_status !== "connected") {
    return null;
  }

  let customDomain: string | null = null;
  if (row.custom_domain !== null) {
    if (
      typeof row.custom_domain !== "string" ||
      !row.custom_domain.includes(".") ||
      normalizeHostHeader(row.custom_domain) !== row.custom_domain
    ) {
      return null;
    }
    customDomain = row.custom_domain;
  }

  if (row.domain_status === "connected" && !customDomain) return null;

  return {
    id: row.id,
    name: row.name.trim(),
    customDomain,
    status: row.status,
    domainStatus: row.domain_status,
  };
}

async function findPartnerById(partnerId: string): Promise<PartnerLookup> {
  return findPartner("id", partnerId);
}

async function findPartnerByHostname(hostname: string): Promise<PartnerLookup> {
  return findPartner("custom_domain", hostname);
}

async function findPartner(
  field: "id" | "custom_domain",
  value: string,
): Promise<PartnerLookup> {
  try {
    const { data, error } = await supabaseAdmin
      .from("partners")
      .select(PARTNER_TENANCY_COLUMNS)
      .eq(field, value)
      .maybeSingle<PartnerTenancyRow>();

    if (error) return { status: "failed" };
    if (!data) return { status: "missing" };
    const partner = parsePartner(data);
    if (
      !partner ||
      (field === "id" && partner.id !== value) ||
      (field === "custom_domain" && partner.customDomain !== value)
    ) {
      return { status: "failed" };
    }
    return { status: "found", partner };
  } catch {
    return { status: "failed" };
  }
}

function isAvailablePartner(
  partner: PartnerTenancy,
  canonicalHostname: string,
): boolean {
  return (
    partner.status === "active" &&
    partner.domainStatus === "connected" &&
    partner.customDomain !== null &&
    partner.customDomain !== canonicalHostname
  );
}

function mismatchForPartner(
  partner: PartnerTenancy,
): Extract<WorkspaceAccess, { status: "mismatch" }> {
  return {
    status: "mismatch",
    expectedOrigin: partner.customDomain
      ? `https://${partner.customDomain}`
      : null,
    expectedName: partner.name,
  };
}

function canonicalWorkspace(): {
  hostname: string;
  origin: string;
  name: string;
} | null {
  try {
    const origin = getCanonicalAppOrigin();
    const url = new URL(origin);
    const hostname = normalizeHostHeader(url.host);
    if (!hostname) return null;
    return { hostname, origin, name: DEFAULT_BRAND.name };
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isBillingMode(value: unknown): value is BillingMode {
  return value === "stripe" || value === "invoiced" || value === "comped";
}

function isPrimaryGoal(value: unknown): value is PrimaryGoal | null {
  return (
    value === null ||
    value === "book" ||
    value === "signup" ||
    value === "quote" ||
    value === "callback"
  );
}

function isUnauthenticatedAuthError(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;

  // A rejected/expired credential is an unauthenticated state. Rate limits,
  // transport failures, and 5xx Auth responses are operational lookup
  // failures and must remain retryable instead of looking like sign-out.
  return (
    isAuthApiError(error) &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

// React cache is scoped to the active server request. It lets layouts and API
// adapters share one authorization/database decision without retaining tenant
// state across requests.
export const getWorkspaceAccess = cache(resolveWorkspaceAccess);

/**
 * Re-run the complete workspace policy without React's request cache.
 *
 * Use this only when a handler crosses an external network boundary before a
 * durable mutation and must detect a session, business, partner assignment,
 * or Host-policy change that happened while the request was in flight.
 */
export async function getFreshWorkspaceAccess(): Promise<WorkspaceAccess> {
  return resolveWorkspaceAccess();
}
