import { z } from "zod";
import { isValidPartnerSlug, normalizeHostHeader } from "@/lib/branding/hostname";
import type { PartnerDomainStatus, PartnerStatus } from "@/types/database";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const ADMIN_PARTNER_COLUMNS = [
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
  "status",
  "created_at",
  "updated_at",
].join(", ");

export type PartnerColors = {
  primary: string;
  primaryHover: string;
  primaryActive: string;
  accent: string;
  primaryDark: string;
  primaryHoverDark: string;
  primaryActiveDark: string;
  accentDark: string;
};

export type PartnerProfileInput = {
  name: string;
  slug: string;
  customDomain: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  status: PartnerStatus;
  colors: PartnerColors;
};

export type PartnerPatchInput =
  | ({ action: "update" } & PartnerProfileInput)
  | {
      action: "set_domain_status";
      domainStatus: PartnerDomainStatus;
      expectedCustomDomain: string | null;
    };

export type AdminPartnerDto = PartnerProfileInput & {
  id: string;
  domainStatus: PartnerDomainStatus;
  createdAt: string;
  updatedAt: string;
};

const normalizedName = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "Name is required");

const normalizedSlug = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isValidPartnerSlug, "Slug must be a canonical lowercase slug");

const optionalDomain = z
  .union([z.string(), z.null()])
  .transform((value) => (value === "" ? null : value?.toLowerCase() ?? null))
  .refine(
    (value) =>
      value === null ||
      (value.includes(".") && normalizeHostHeader(value) === value),
    "Custom domain must be a hostname only",
  );

const color = z
  .string()
  .regex(HEX_COLOR, "Color must be a six-digit hex value")
  .transform((value) => value.toLowerCase());

const colorsSchema = z
  .object({
    primary: color,
    primaryHover: color,
    primaryActive: color,
    accent: color,
    primaryDark: color,
    primaryHoverDark: color,
    primaryActiveDark: color,
    accentDark: color,
  })
  .strict();

function isNonPublicIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;

  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicHttpsAssetUrl(value: string): boolean {
  if (!value || value.trim() !== value || value.length > 2048) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hostname.includes(".") &&
      normalizeHostHeader(hostname) === hostname &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !hostname.endsWith(".local") &&
      !hostname.endsWith(".internal") &&
      !isNonPublicIpv4(hostname)
    );
  } catch {
    return false;
  }
}

const optionalAssetUrl = z
  .union([z.string(), z.null()])
  .transform((value) => (value === "" ? null : value))
  .refine(
    (value) => value === null || isPublicHttpsAssetUrl(value),
    "Asset URL must be a public absolute HTTPS URL",
  );

const profileShape = {
  name: normalizedName,
  slug: normalizedSlug,
  customDomain: optionalDomain,
  logoLightUrl: optionalAssetUrl,
  logoDarkUrl: optionalAssetUrl,
  faviconUrl: optionalAssetUrl,
  status: z.enum(["active", "inactive"]),
  colors: colorsSchema,
} as const;

export const partnerProfileInputSchema = z.object(profileShape).strict();

export const partnerPatchInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), ...profileShape }).strict(),
  z
    .object({
      action: z.literal("set_domain_status"),
      domainStatus: z.enum(["pending", "connected"]),
      expectedCustomDomain: optionalDomain,
    })
    .strict(),
]);

const databasePartnerRowSchema = z
  .object({
    id: z.string().uuid(),
    name: normalizedName,
    slug: normalizedSlug,
    custom_domain: optionalDomain,
    domain_status: z.enum(["pending", "connected"]),
    logo_light_url: optionalAssetUrl,
    logo_dark_url: optionalAssetUrl,
    favicon_url: optionalAssetUrl,
    brand_primary: color,
    brand_primary_hover: color,
    brand_primary_active: color,
    brand_accent: color,
    brand_primary_dark: color,
    brand_primary_hover_dark: color,
    brand_primary_active_dark: color,
    brand_accent_dark: color,
    status: z.enum(["active", "inactive"]),
    created_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    updated_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  })
  .strict()
  .superRefine((row, context) => {
    if (row.domain_status === "connected" && !row.custom_domain) {
      context.addIssue({
        code: "custom",
        path: ["custom_domain"],
        message: "Connected partner is missing a custom domain",
      });
    }
  });

export function parseAdminPartnerRow(value: unknown): AdminPartnerDto {
  const row = databasePartnerRowSchema.parse(value);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    customDomain: row.custom_domain,
    domainStatus: row.domain_status,
    logoLightUrl: row.logo_light_url,
    logoDarkUrl: row.logo_dark_url,
    faviconUrl: row.favicon_url,
    status: row.status,
    colors: {
      primary: row.brand_primary,
      primaryHover: row.brand_primary_hover,
      primaryActive: row.brand_primary_active,
      accent: row.brand_accent,
      primaryDark: row.brand_primary_dark,
      primaryHoverDark: row.brand_primary_hover_dark,
      primaryActiveDark: row.brand_primary_active_dark,
      accentDark: row.brand_accent_dark,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function partnerProfileToDatabaseWrite(profile: PartnerProfileInput) {
  return {
    name: profile.name,
    slug: profile.slug,
    custom_domain: profile.customDomain,
    logo_light_url: profile.logoLightUrl,
    logo_dark_url: profile.logoDarkUrl,
    favicon_url: profile.faviconUrl,
    status: profile.status,
    brand_primary: profile.colors.primary,
    brand_primary_hover: profile.colors.primaryHover,
    brand_primary_active: profile.colors.primaryActive,
    brand_accent: profile.colors.accent,
    brand_primary_dark: profile.colors.primaryDark,
    brand_primary_hover_dark: profile.colors.primaryHoverDark,
    brand_primary_active_dark: profile.colors.primaryActiveDark,
    brand_accent_dark: profile.colors.accentDark,
  };
}
