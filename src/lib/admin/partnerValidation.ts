import { z } from "zod";
import { isValidPartnerSlug, normalizeHostHeader } from "@/lib/branding/hostname";
import type {
  PartnerDomainStatus,
  PartnerEmailStatus,
  PartnerStatus,
} from "@/types/database";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const EMAIL_MAILBOX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

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
  "email_from",
  "email_from_status",
  "email_from_verified_at",
  "email_from_verified_by",
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
  emailFrom: string | null;
  status: PartnerStatus;
  colors: PartnerColors;
};

export type PartnerPatchInput =
  | ({ action: "update" } & PartnerProfileInput)
  | {
      action: "set_domain_status";
      domainStatus: PartnerDomainStatus;
      expectedCustomDomain: string | null;
    }
  | {
      action: "verify_email_from";
      expectedEmailFrom: string | null;
    };

export type AdminPartnerDto = PartnerProfileInput & {
  id: string;
  domainStatus: PartnerDomainStatus;
  emailFromStatus: PartnerEmailStatus;
  emailFromVerifiedAt: string | null;
  emailFromVerifiedBy: string | null;
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

function isCanonicalEmailMailbox(value: string): boolean {
  return (
    value.length <= 254 &&
    value === value.toLowerCase() &&
    value === value.trim() &&
    !/[\u0000-\u0020\u007f,<>]/.test(value) &&
    EMAIL_MAILBOX.test(value)
  );
}

const emailFromInput = z
  .string()
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "From email cannot contain control characters",
  );

const optionalEmailFrom = z
  .union([emailFromInput, z.null()])
  .transform((value) => {
    if (value === null) return null;
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  })
  .refine(
    (value) => value === null || isCanonicalEmailMailbox(value),
    "From email must be one lowercase mailbox on a dotted DNS domain",
  );

const databaseEmailFrom = z
  .union([z.string(), z.null()])
  .refine(
    (value) => value === null || isCanonicalEmailMailbox(value),
    "Stored From email is not canonical",
  );

const nullableTimestamp = z
  .union([z.string(), z.null()])
  .refine(
    (value) => value === null || !Number.isNaN(Date.parse(value)),
    "Invalid timestamp",
  );

const profileShape = {
  name: normalizedName,
  slug: normalizedSlug,
  customDomain: optionalDomain,
  logoLightUrl: optionalAssetUrl,
  logoDarkUrl: optionalAssetUrl,
  faviconUrl: optionalAssetUrl,
  emailFrom: optionalEmailFrom,
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
  z
    .object({
      action: z.literal("verify_email_from"),
      expectedEmailFrom: optionalEmailFrom,
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
    email_from: databaseEmailFrom,
    email_from_status: z.enum(["unconfigured", "pending", "verified"]),
    email_from_verified_at: nullableTimestamp,
    email_from_verified_by: z.union([z.string().uuid(), z.null()]),
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

    const validEmailState =
      (row.email_from === null &&
        row.email_from_status === "unconfigured" &&
        row.email_from_verified_at === null &&
        row.email_from_verified_by === null) ||
      (row.email_from !== null &&
        row.email_from_status === "pending" &&
        row.email_from_verified_at === null &&
        row.email_from_verified_by === null) ||
      (row.email_from !== null &&
        row.email_from_status === "verified" &&
        row.email_from_verified_at !== null &&
        row.email_from_verified_by !== null);

    if (!validEmailState) {
      context.addIssue({
        code: "custom",
        path: ["email_from_status"],
        message: "Stored From email verification state is inconsistent",
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
    emailFrom: row.email_from,
    emailFromStatus: row.email_from_status,
    emailFromVerifiedAt: row.email_from_verified_at,
    emailFromVerifiedBy: row.email_from_verified_by,
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
    email_from: profile.emailFrom,
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
