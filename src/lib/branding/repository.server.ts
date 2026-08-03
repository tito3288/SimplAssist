import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Partner } from "@/types/database";
import { isValidPartnerSlug, normalizeHostHeader } from "./hostname";
import type { PublicBrand } from "./types";

const PUBLIC_PARTNER_COLUMNS = [
  "id",
  "name",
  "slug",
  "custom_domain",
  "domain_status",
  "logo_light_url",
  "logo_dark_url",
  "favicon_url",
  "brand_primary",
  "brand_primary_hover",
  "brand_primary_active",
  "brand_accent",
  "brand_primary_dark",
  "brand_primary_hover_dark",
  "brand_primary_active_dark",
  "brand_accent_dark",
].join(",");

type PartnerBrandRow = Pick<
  Partner,
  | "id"
  | "name"
  | "slug"
  | "custom_domain"
  | "domain_status"
  | "logo_light_url"
  | "logo_dark_url"
  | "favicon_url"
  | "brand_primary"
  | "brand_primary_hover"
  | "brand_primary_active"
  | "brand_accent"
  | "brand_primary_dark"
  | "brand_primary_hover_dark"
  | "brand_primary_active_dark"
  | "brand_accent_dark"
>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function validatedColor(value: unknown): string {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error("Partner branding contains an invalid color");
  }
  return value.toLowerCase();
}

function isObviouslyPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function validatedPublicHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const normalizedHostname = normalizeHostHeader(hostname);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !normalizedHostname ||
      normalizedHostname !== hostname ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      isObviouslyPrivateIpv4(hostname)
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function mapPartnerBrand(row: PartnerBrandRow): PublicBrand {
  if (!row || typeof row !== "object") {
    throw new Error("Partner branding row is malformed");
  }

  if (typeof row.id !== "string" || !UUID.test(row.id)) {
    throw new Error("Partner branding contains an invalid id");
  }

  if (typeof row.name !== "string" || !row.name.trim()) {
    throw new Error("Partner branding contains an invalid name");
  }

  if (typeof row.slug !== "string" || !isValidPartnerSlug(row.slug)) {
    throw new Error("Partner branding contains an invalid slug");
  }

  if (row.domain_status !== "pending" && row.domain_status !== "connected") {
    throw new Error("Partner branding contains an invalid domain status");
  }

  let customDomain: string | null = null;
  if (row.custom_domain !== null) {
    if (
      typeof row.custom_domain !== "string" ||
      !row.custom_domain.includes(".") ||
      normalizeHostHeader(row.custom_domain) !== row.custom_domain
    ) {
      throw new Error("Partner branding contains an invalid custom domain");
    }
    customDomain = row.custom_domain;
  }

  if (row.domain_status === "connected" && !customDomain) {
    throw new Error("Connected partner branding is missing its custom domain");
  }

  return {
    kind: "partner",
    partnerId: row.id,
    slug: row.slug,
    name: row.name.trim(),
    publicOrigin:
      row.domain_status === "connected" && customDomain
        ? `https://${customDomain}`
        : null,
    logoLightUrl: validatedPublicHttpsUrl(row.logo_light_url),
    logoDarkUrl: validatedPublicHttpsUrl(row.logo_dark_url),
    faviconUrl: validatedPublicHttpsUrl(row.favicon_url),
    colors: {
      primary: validatedColor(row.brand_primary),
      primaryHover: validatedColor(row.brand_primary_hover),
      primaryActive: validatedColor(row.brand_primary_active),
      accent: validatedColor(row.brand_accent),
      primaryDark: validatedColor(row.brand_primary_dark),
      primaryHoverDark: validatedColor(row.brand_primary_hover_dark),
      primaryActiveDark: validatedColor(row.brand_primary_active_dark),
      accentDark: validatedColor(row.brand_accent_dark),
    },
  };
}

export async function findPartnerBrandByHostname(
  hostname: string,
): Promise<PublicBrand | null> {
  if (normalizeHostHeader(hostname) !== hostname) return null;

  const { data, error } = await supabaseAdmin
    .from("partners")
    .select(PUBLIC_PARTNER_COLUMNS)
    .eq("custom_domain", hostname)
    .eq("status", "active")
    .eq("domain_status", "connected")
    .maybeSingle();

  if (error) throw new Error("Partner hostname lookup failed");
  return data ? mapPartnerBrand(data as unknown as PartnerBrandRow) : null;
}

export async function findPartnerBrandBySlug(
  slug: string,
): Promise<PublicBrand | null> {
  if (!isValidPartnerSlug(slug)) return null;

  const { data, error } = await supabaseAdmin
    .from("partners")
    .select(PUBLIC_PARTNER_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error("Partner preview lookup failed");
  return data ? mapPartnerBrand(data as unknown as PartnerBrandRow) : null;
}
