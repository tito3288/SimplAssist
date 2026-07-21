import type { BusinessEntityType } from "@/types/database";
import { normalizeUsStateCode } from "@/lib/usStates";

export type TelnyxEntityTypeCategory =
  | "PRIVATE_PROFIT"
  | "PUBLIC_PROFIT"
  | "NON_PROFIT"
  | "GOVERNMENT"
  | "SOLE_PROPRIETOR";

export type ExistingBrandIdentityField =
  | "ein"
  | "legal_name"
  | "entity_type"
  | "state"
  | "zip";

export interface ExistingBrandProviderIdentity {
  ein?: string | null;
  universalEin?: string | null;
  companyName?: string | null;
  entityType?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface ExistingBrandLocalIdentity {
  ein: string | null;
  legal_business_name: string | null;
  business_entity_type: BusinessEntityType | null;
  state: string | null;
  zip: string | null;
}

/**
 * TCR uses a broad entity category. It cannot distinguish an LLC from a C
 * corporation, S corporation, or partnership, so all four intentionally map
 * to PRIVATE_PROFIT.
 */
export function toTelnyxEntityType(
  entity: BusinessEntityType
): TelnyxEntityTypeCategory {
  switch (entity) {
    case "llc":
    case "c_corp":
    case "s_corp":
    case "partnership":
      return "PRIVATE_PROFIT";
    case "nonprofit":
      return "NON_PROFIT";
    case "sole_proprietor":
      return "SOLE_PROPRIETOR";
  }
}

export function normalizeEinDigits(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

export function normalizeLegalBusinessName(
  value?: string | null
): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  return normalized || null;
}

export function normalizeFiveDigitZip(value?: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{5})(?:-?\d{4})?$/);
  return match?.[1] ?? null;
}

export function normalizeTelnyxEntityType(
  value?: string | null
): TelnyxEntityTypeCategory | null {
  const normalized = value?.trim().toUpperCase();
  switch (normalized) {
    case "PRIVATE_PROFIT":
    case "PUBLIC_PROFIT":
    case "NON_PROFIT":
    case "GOVERNMENT":
    case "SOLE_PROPRIETOR":
      return normalized;
    default:
      return null;
  }
}

/**
 * Compare the provider identity to the local onboarding identity without
 * returning either side's sensitive value. Only safe field names escape.
 * Telnyx state/postalCode are the business address, so they match `state` and
 * `zip`; `business_registration_state` remains protected by the DB fingerprint.
 */
export function compareExistingBrandIdentity(
  provider: ExistingBrandProviderIdentity,
  local: ExistingBrandLocalIdentity
): { matches: boolean; mismatchedFields: ExistingBrandIdentityField[] } {
  const mismatchedFields: ExistingBrandIdentityField[] = [];

  const universalEin = normalizeEinDigits(provider.universalEin);
  const submittedEin = normalizeEinDigits(provider.ein);
  const providerEin = universalEin ?? submittedEin;
  const hasRawUniversalEin = Boolean(provider.universalEin?.trim());
  const hasRawSubmittedEin = Boolean(provider.ein?.trim());
  const providerEinConflict = Boolean(
    hasRawUniversalEin &&
      hasRawSubmittedEin &&
      (!universalEin || !submittedEin || universalEin !== submittedEin)
  );
  if (
    providerEinConflict ||
    !providerEin ||
    providerEin !== normalizeEinDigits(local.ein)
  ) {
    mismatchedFields.push("ein");
  }

  const providerName = normalizeLegalBusinessName(provider.companyName);
  if (
    !providerName ||
    providerName !== normalizeLegalBusinessName(local.legal_business_name)
  ) {
    mismatchedFields.push("legal_name");
  }

  const providerEntity = normalizeTelnyxEntityType(provider.entityType);
  if (
    !providerEntity ||
    !local.business_entity_type ||
    providerEntity !== toTelnyxEntityType(local.business_entity_type)
  ) {
    mismatchedFields.push("entity_type");
  }

  const providerState = normalizeUsStateCode(provider.state);
  if (!providerState || providerState !== normalizeUsStateCode(local.state)) {
    mismatchedFields.push("state");
  }

  const providerZip = normalizeFiveDigitZip(provider.postalCode);
  if (!providerZip || providerZip !== normalizeFiveDigitZip(local.zip)) {
    mismatchedFields.push("zip");
  }

  return {
    matches: mismatchedFields.length === 0,
    mismatchedFields,
  };
}
