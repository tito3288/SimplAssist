import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin/auth";
import {
  ADMIN_PARTNER_COLUMNS,
  parseAdminPartnerRow,
  partnerProfileInputSchema,
  partnerProfileToDatabaseWrite,
} from "@/lib/admin/partnerValidation";
import { supabaseAdmin } from "@/lib/supabase/admin";

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505",
  );
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("partners")
      .select(ADMIN_PARTNER_COLUMNS)
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      partners: (data ?? []).map(parseAdminPartnerRow),
    });
  } catch (error) {
    console.error("[admin:partners] Failed to list partners", error);
    return NextResponse.json(
      { error: "Failed to load partners" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = partnerProfileInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid partner profile" },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("partners")
      .insert({
        ...partnerProfileToDatabaseWrite(parsed.data),
        domain_status: "pending",
        email_from_status: parsed.data.emailFrom ? "pending" : "unconfigured",
        email_from_verified_at: null,
        email_from_verified_by: null,
      })
      .select(ADMIN_PARTNER_COLUMNS)
      .single();

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

    return NextResponse.json(
      { partner: parseAdminPartnerRow(data) },
      { status: 201 },
    );
  } catch (error) {
    console.error("[admin:partners] Failed to create partner", error);
    return NextResponse.json(
      { error: "Failed to create partner" },
      { status: 500 },
    );
  }
}
