import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCanonicalAppOrigin } from "./defaultBrand";
import { normalizeHostHeader } from "./hostname";

export type ConnectedBusinessPartner = {
  partnerId: string;
  name: string;
  customDomain: string;
  publicOrigin: string;
};

export type WidgetAttribution = {
  poweredByName: string;
  poweredByUrl: string;
};

export class BusinessPartnerResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessPartnerResolutionError";
  }
}

type BusinessAssignmentRow = {
  partner_id: unknown;
};

type PartnerAssignmentRow = {
  id: unknown;
  name: unknown;
  custom_domain: unknown;
  status: unknown;
  domain_status: unknown;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function connectedPartnerFromRow(
  value: unknown,
): ConnectedBusinessPartner | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    throw new BusinessPartnerResolutionError("Partner assignment row is malformed");
  }

  const row = value as PartnerAssignmentRow;
  if (
    (row.status !== "active" && row.status !== "inactive") ||
    (row.domain_status !== "pending" && row.domain_status !== "connected")
  ) {
    throw new BusinessPartnerResolutionError("Partner assignment row is malformed");
  }

  if (row.status === "inactive" || row.domain_status === "pending") return null;

  if (
    typeof row.id !== "string" ||
    !UUID.test(row.id) ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    typeof row.custom_domain !== "string" ||
    !row.custom_domain.includes(".") ||
    normalizeHostHeader(row.custom_domain) !== row.custom_domain
  ) {
    throw new BusinessPartnerResolutionError("Partner assignment row is malformed");
  }

  return {
    partnerId: row.id,
    name: row.name.trim(),
    customDomain: row.custom_domain,
    publicOrigin: `https://${row.custom_domain}`,
  };
}

async function findConnectedPartnerById(
  partnerId: string,
): Promise<ConnectedBusinessPartner | null> {
  let result;
  try {
    result = await supabaseAdmin
      .from("partners")
      .select("id, name, custom_domain, status, domain_status")
      .eq("id", partnerId)
      .maybeSingle();
  } catch {
    throw new BusinessPartnerResolutionError(
      "Assigned partner lookup failed",
    );
  }

  const { data, error } = result;

  if (error) {
    throw new BusinessPartnerResolutionError(
      "Assigned partner lookup failed",
    );
  }

  if (data === null) {
    throw new BusinessPartnerResolutionError(
      "Assigned partner row is missing",
    );
  }

  return connectedPartnerFromRow(data);
}

export async function resolveConnectedBusinessPartner(
  businessId: string,
): Promise<ConnectedBusinessPartner | null> {
  let result;
  try {
    result = await supabaseAdmin
      .from("businesses")
      .select("partner_id")
      .eq("id", businessId)
      .maybeSingle();
  } catch {
    throw new BusinessPartnerResolutionError(
      "Business partner assignment lookup failed",
    );
  }

  const { data, error } = result;

  if (error) {
    throw new BusinessPartnerResolutionError(
      "Business partner assignment lookup failed",
    );
  }

  if (data === null) return null;
  if (!data || typeof data !== "object") {
    throw new BusinessPartnerResolutionError(
      "Business partner assignment row is malformed",
    );
  }

  const assignment = data as unknown as BusinessAssignmentRow;
  if (assignment.partner_id === null) return null;
  if (
    typeof assignment.partner_id !== "string" ||
    !UUID.test(assignment.partner_id)
  ) {
    throw new BusinessPartnerResolutionError(
      "Business partner assignment row is malformed",
    );
  }

  return findConnectedPartnerById(assignment.partner_id);
}

async function resolveAllowListedHostOrigin(
  rawHost: string | null,
): Promise<string> {
  const canonicalOrigin = getCanonicalAppOrigin();
  const hostname = normalizeHostHeader(rawHost);
  if (!hostname) return canonicalOrigin;

  const canonicalHostname = new URL(canonicalOrigin).hostname.toLowerCase();
  if (hostname === canonicalHostname) return canonicalOrigin;

  let result;
  try {
    result = await supabaseAdmin
      .from("partners")
      .select("id, name, custom_domain, status, domain_status")
      .eq("custom_domain", hostname)
      .eq("status", "active")
      .eq("domain_status", "connected")
      .maybeSingle();
  } catch {
    throw new BusinessPartnerResolutionError(
      "Widget request host allow-list lookup failed",
    );
  }

  const { data, error } = result;

  if (error) {
    throw new BusinessPartnerResolutionError(
      "Widget request host allow-list lookup failed",
    );
  }

  const partner = connectedPartnerFromRow(data);
  return partner?.publicOrigin ?? canonicalOrigin;
}

export async function resolveWidgetAttribution({
  businessId,
  hostHeader,
}: {
  businessId: string;
  hostHeader: string | null;
}): Promise<WidgetAttribution> {
  const assignedPartner = await resolveConnectedBusinessPartner(businessId);

  if (assignedPartner) {
    return {
      poweredByName: assignedPartner.name,
      poweredByUrl: assignedPartner.publicOrigin,
    };
  }

  return {
    poweredByName: "SimplAssist",
    poweredByUrl: await resolveAllowListedHostOrigin(hostHeader),
  };
}
