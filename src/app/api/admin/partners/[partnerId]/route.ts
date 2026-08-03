import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import {
  ADMIN_PARTNER_COLUMNS,
  type AdminPartnerDto,
  parseAdminPartnerRow,
  partnerPatchInputSchema,
  partnerProfileToDatabaseWrite,
} from "@/lib/admin/partnerValidation";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = {
  params: { partnerId: string };
};

const partnerIdSchema = z.string().uuid();

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505",
  );
}

async function loadPartner(
  partnerId: string,
): Promise<
  | { status: "found"; partner: AdminPartnerDto }
  | { status: "not_found" }
  | { status: "failed"; error: unknown }
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("partners")
      .select(ADMIN_PARTNER_COLUMNS)
      .eq("id", partnerId)
      .maybeSingle();

    if (error) return { status: "failed", error };
    if (!data) return { status: "not_found" };

    return { status: "found", partner: parseAdminPartnerRow(data) };
  } catch (error) {
    return { status: "failed", error };
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsedId = partnerIdSchema.safeParse(context.params.partnerId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  const result = await loadPartner(parsedId.data);
  if (result.status === "not_found") {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  if (result.status === "failed") {
    console.error("[admin:partners] Failed to load partner", result.error);
    return NextResponse.json(
      { error: "Failed to load partner" },
      { status: 500 },
    );
  }

  return NextResponse.json({ partner: result.partner });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsedId = partnerIdSchema.safeParse(context.params.partnerId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = partnerPatchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid partner update" },
      { status: 400 },
    );
  }

  const existing = await loadPartner(parsedId.data);
  if (existing.status === "not_found") {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  if (existing.status === "failed") {
    console.error("[admin:partners] Failed to load partner", existing.error);
    return NextResponse.json(
      { error: "Failed to update partner" },
      { status: 500 },
    );
  }

  if (
    parsed.data.action === "set_domain_status" &&
    parsed.data.expectedCustomDomain !== existing.partner.customDomain
  ) {
    return NextResponse.json(
      {
        error:
          "The custom domain changed before its status could be updated. Reload and verify the current domain.",
        code: "partner_domain_changed",
      },
      { status: 409 },
    );
  }

  if (
    parsed.data.action === "set_domain_status" &&
    parsed.data.domainStatus === "connected" &&
    !existing.partner.customDomain
  ) {
    return NextResponse.json(
      {
        error: "Connected status requires a custom domain",
        code: "domain_required",
      },
      { status: 400 },
    );
  }

  if (
    parsed.data.action === "set_domain_status" &&
    parsed.data.domainStatus === existing.partner.domainStatus
  ) {
    return NextResponse.json({ partner: existing.partner });
  }

  const update =
    parsed.data.action === "set_domain_status"
      ? { domain_status: parsed.data.domainStatus }
      : {
          ...partnerProfileToDatabaseWrite(parsed.data),
          domain_status:
            parsed.data.customDomain === existing.partner.customDomain
              ? existing.partner.domainStatus
              : "pending",
        };

  try {
    let updateQuery = supabaseAdmin
      .from("partners")
      .update(update)
      .eq("id", parsedId.data)
      .eq("updated_at", existing.partner.updatedAt);

    if (parsed.data.action === "set_domain_status") {
      updateQuery = parsed.data.expectedCustomDomain
        ? updateQuery.eq("custom_domain", parsed.data.expectedCustomDomain)
        : updateQuery.is("custom_domain", null);
    }

    const { data, error } = await updateQuery
      .select(ADMIN_PARTNER_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          {
            error: "A partner with that slug or domain already exists",
            code: "partner_conflict",
          },
          { status: 409 },
        );
      }
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "Partner changed while this update was being saved",
          code: "partner_update_conflict",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ partner: parseAdminPartnerRow(data) });
  } catch (error) {
    console.error("[admin:partners] Failed to update partner", error);
    return NextResponse.json(
      { error: "Failed to update partner" },
      { status: 500 },
    );
  }
}
