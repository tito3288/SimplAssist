import "server-only";

import {
  DEFAULT_BRAND,
  getCanonicalAppOrigin,
} from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { RESEND_FROM } from "./client";

export type BusinessEmailBrand = {
  partnerId: string | null;
  name: string;
  publicOrigin: string;
  from: string;
  usedFallbackSender: boolean;
};

export type BusinessEmailBrandResolutionErrorCode =
  | "invalid_business_id"
  | "business_lookup_failed"
  | "business_missing"
  | "assignment_malformed"
  | "partner_lookup_failed"
  | "partner_missing"
  | "partner_unavailable"
  | "partner_malformed"
  | "sender_state_malformed";

export class BusinessEmailBrandResolutionError extends Error {
  constructor(
    readonly code: BusinessEmailBrandResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BusinessEmailBrandResolutionError";
  }
}

type BusinessAssignmentRow = { partner_id: unknown };

type PartnerEmailRow = {
  id: unknown;
  name: unknown;
  custom_domain: unknown;
  status: unknown;
  domain_status: unknown;
  email_from: unknown;
  email_from_status: unknown;
  email_from_verified_at: unknown;
  email_from_verified_by: unknown;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAILBOX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const PARTNER_COLUMNS = [
  "id",
  "name",
  "custom_domain",
  "status",
  "domain_status",
  "email_from",
  "email_from_status",
  "email_from_verified_at",
  "email_from_verified_by",
].join(",");

export async function resolveBusinessEmailBrand(
  businessId: string | null,
): Promise<BusinessEmailBrand> {
  if (businessId === null) return defaultEmailBrand();
  if (!UUID.test(businessId)) {
    throw resolutionError("invalid_business_id", "Business id is malformed");
  }

  const assignment = await loadBusinessAssignment(businessId);
  if (assignment.partner_id === null) return defaultEmailBrand();
  if (
    typeof assignment.partner_id !== "string" ||
    !UUID.test(assignment.partner_id)
  ) {
    throw resolutionError(
      "assignment_malformed",
      "Business partner assignment is malformed",
    );
  }

  return partnerEmailBrand(
    await loadAssignedPartner(assignment.partner_id),
    assignment.partner_id,
  );
}

function defaultEmailBrand(): BusinessEmailBrand {
  return {
    partnerId: null,
    name: DEFAULT_BRAND.name,
    publicOrigin: getCanonicalAppOrigin(),
    from: RESEND_FROM,
    usedFallbackSender: false,
  };
}

async function loadBusinessAssignment(
  businessId: string,
): Promise<BusinessAssignmentRow> {
  let result;
  try {
    result = await supabaseAdmin
      .from("businesses")
      .select("partner_id")
      .eq("id", businessId)
      .maybeSingle();
  } catch {
    throw resolutionError(
      "business_lookup_failed",
      "Business email assignment lookup failed",
    );
  }

  if (result.error) {
    throw resolutionError(
      "business_lookup_failed",
      "Business email assignment lookup failed",
    );
  }
  if (result.data === null) {
    throw resolutionError("business_missing", "Business row is missing");
  }
  if (!result.data || typeof result.data !== "object") {
    throw resolutionError(
      "assignment_malformed",
      "Business partner assignment is malformed",
    );
  }
  return result.data as BusinessAssignmentRow;
}

async function loadAssignedPartner(partnerId: string): Promise<PartnerEmailRow> {
  let result;
  try {
    result = await supabaseAdmin
      .from("partners")
      .select(PARTNER_COLUMNS)
      .eq("id", partnerId)
      .maybeSingle();
  } catch {
    throw resolutionError(
      "partner_lookup_failed",
      "Assigned email partner lookup failed",
    );
  }

  if (result.error) {
    throw resolutionError(
      "partner_lookup_failed",
      "Assigned email partner lookup failed",
    );
  }
  if (result.data === null) {
    throw resolutionError("partner_missing", "Assigned email partner is missing");
  }
  if (!result.data || typeof result.data !== "object") {
    throw resolutionError("partner_malformed", "Assigned email partner is malformed");
  }
  return result.data as PartnerEmailRow;
}

function partnerEmailBrand(
  row: PartnerEmailRow,
  expectedPartnerId: string,
): BusinessEmailBrand {
  if (row.status !== "active" || row.domain_status !== "connected") {
    throw resolutionError(
      "partner_unavailable",
      "Assigned email partner is unavailable",
    );
  }
  if (typeof row.id !== "string" || row.id !== expectedPartnerId) {
    throw resolutionError("partner_malformed", "Assigned email partner is malformed");
  }

  const name = validatedDisplayName(row.name);
  const domain = validatedDomain(row.custom_domain);
  if (domain === new URL(getCanonicalAppOrigin()).hostname.toLowerCase()) {
    throw resolutionError(
      "partner_unavailable",
      "Assigned email partner domain collides with canonical",
    );
  }
  const sender = validatedSenderState(row);

  return {
    partnerId: expectedPartnerId,
    name,
    publicOrigin: `https://${domain}`,
    from: sender
      ? `${quoteDisplayName(name)} <${sender}>`
      : RESEND_FROM,
    usedFallbackSender: sender === null,
  };
}

function validatedDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw resolutionError("partner_malformed", "Assigned email partner is malformed");
  }
  const name = value.trim();
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) {
    throw resolutionError("partner_malformed", "Assigned email partner is malformed");
  }
  return name;
}

function quoteDisplayName(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function validatedDomain(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.includes(".") ||
    normalizeHostHeader(value) !== value
  ) {
    throw resolutionError("partner_malformed", "Assigned email partner is malformed");
  }
  return value;
}

function validatedSenderState(row: PartnerEmailRow): string | null {
  const status = row.email_from_status;
  if (status === "unconfigured") {
    if (
      row.email_from !== null ||
      row.email_from_verified_at !== null ||
      row.email_from_verified_by !== null
    ) {
      throw resolutionError(
        "sender_state_malformed",
        "Assigned partner sender state is malformed",
      );
    }
    return null;
  }

  if (status !== "pending" && status !== "verified") {
    throw resolutionError(
      "sender_state_malformed",
      "Assigned partner sender state is malformed",
    );
  }

  const mailbox = validatedMailbox(row.email_from);
  if (status === "pending") {
    if (
      row.email_from_verified_at !== null ||
      row.email_from_verified_by !== null
    ) {
      throw resolutionError(
        "sender_state_malformed",
        "Assigned partner sender state is malformed",
      );
    }
    return null;
  }

  if (
    typeof row.email_from_verified_at !== "string" ||
    !Number.isFinite(Date.parse(row.email_from_verified_at)) ||
    typeof row.email_from_verified_by !== "string" ||
    !UUID.test(row.email_from_verified_by)
  ) {
    throw resolutionError(
      "sender_state_malformed",
      "Assigned partner sender state is malformed",
    );
  }
  return mailbox;
}

function validatedMailbox(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    value !== value.trim().toLowerCase() ||
    !MAILBOX.test(value)
  ) {
    throw resolutionError(
      "sender_state_malformed",
      "Assigned partner sender state is malformed",
    );
  }
  return value;
}

function resolutionError(
  code: BusinessEmailBrandResolutionErrorCode,
  message: string,
): BusinessEmailBrandResolutionError {
  return new BusinessEmailBrandResolutionError(code, message);
}
