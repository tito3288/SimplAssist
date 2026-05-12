import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BusinessEntityType } from "@/types/database";
import { appendRegistrationEvent, serializeError } from "./audit";

type TelnyxEntityType =
  | "PRIVATE_PROFIT"
  | "PUBLIC_PROFIT"
  | "NON_PROFIT"
  | "GOVERNMENT"
  | "SOLE_PROPRIETOR";

function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required for Telnyx webhook URLs"
    );
  }
  return url.replace(/\/+$/, "");
}

function toTelnyxEntityType(entity: BusinessEntityType): TelnyxEntityType {
  switch (entity) {
    case "llc":
    case "c_corp":
    case "s_corp":
    case "partnership":
      return "PRIVATE_PROFIT";
    case "nonprofit":
      return "NON_PROFIT";
    case "sole_proprietor":
      // Sole Proprietor brand path requires SMS OTP verification — deferred to
      // Phase 11. The BrandVerificationForm currently blocks sole_proprietor
      // entity types, so reaching this branch indicates a schema/UI mismatch.
      return "SOLE_PROPRIETOR";
  }
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1).trim(),
  };
}

function toE164(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

export async function registerBrand(businessId: string): Promise<void> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, legal_business_name, business_entity_type, ein, compliance_info_completed_at, telnyx_brand_id, authorized_rep_name, authorized_rep_email, authorized_rep_phone, address, city, state, zip, website_url"
    )
    .eq("id", businessId)
    .single();

  if (readError || !business) {
    throw new Error(
      `[registration:brand] Business ${businessId} not found: ${readError?.message}`
    );
  }

  if (business.telnyx_brand_id) {
    return;
  }

  if (!business.compliance_info_completed_at) {
    throw new Error(
      `[registration:brand] Business ${businessId} has not completed compliance info`
    );
  }

  if (!business.business_entity_type) {
    throw new Error(
      `[registration:brand] Business ${businessId} is missing business_entity_type`
    );
  }

  if (!business.legal_business_name) {
    throw new Error(
      `[registration:brand] Business ${businessId} is missing legal_business_name`
    );
  }

  if (!business.ein) {
    throw new Error(
      `[registration:brand] Business ${businessId} is missing EIN (Phase 11 will add Sole Prop path)`
    );
  }

  if (!business.authorized_rep_email) {
    throw new Error(
      `[registration:brand] Business ${businessId} is missing authorized_rep_email`
    );
  }

  const entityType = toTelnyxEntityType(business.business_entity_type);
  const { firstName, lastName } = splitName(business.authorized_rep_name ?? "");
  const phone = toE164(business.authorized_rep_phone);
  const einDigits = business.ein.replace(/\D/g, "");
  const webhookURL = `${appBaseUrl()}/api/messaging/registration/status`;

  try {
    const response = await telnyx.messaging10dlc.brand.create({
      country: "US",
      displayName: business.name,
      companyName: business.legal_business_name,
      email: business.authorized_rep_email,
      entityType,
      vertical: "PROFESSIONAL",
      ein: einDigits,
      firstName,
      lastName,
      phone,
      street: business.address ?? undefined,
      city: business.city ?? undefined,
      state: business.state ?? undefined,
      postalCode: business.zip ?? undefined,
      website: business.website_url ?? undefined,
      webhookURL,
      webhookFailoverURL: webhookURL,
    });

    const brandId = response.brandId;
    if (!brandId) {
      throw new Error(
        `[registration:brand] Telnyx returned no brandId for business ${businessId}`
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        telnyx_brand_id: brandId,
        brand_status: "pending",
        brand_status_updated_at: new Date().toISOString(),
      })
      .eq("id", businessId);

    if (updateError) {
      throw new Error(
        `[registration:brand] Failed to persist brand id ${brandId} for business ${businessId}: ${updateError.message}`
      );
    }

    await appendRegistrationEvent({
      businessId,
      eventType: "brand_submitted",
      resourceType: "brand",
      resourceId: brandId,
      status: "pending",
      rawPayload: response as unknown as Record<string, unknown>,
    });
  } catch (err) {
    await appendRegistrationEvent({
      businessId,
      eventType: "brand_submitted",
      resourceType: "brand",
      status: "error",
      rawPayload: serializeError(err),
    });
    throw err;
  }
}
