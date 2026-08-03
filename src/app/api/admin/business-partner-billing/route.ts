import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const assignmentSchema = z.object({
  businessId: z.string().uuid(),
  partnerId: z.string().uuid().nullable(),
  billingMode: z.enum(["stripe", "invoiced", "comped"]),
  partnerPlan: z.enum(["sms_only", "sms_and_chat", "full"]).nullable(),
}).strict();

const assignmentResultSchema = z.object({
  business_id: z.string().uuid(),
  partner_id: z.string().uuid().nullable(),
  billing_mode: z.enum(["stripe", "invoiced", "comped"]),
  partner_plan: z.enum(["sms_only", "sms_and_chat", "full"]).nullable(),
  billing_comped: z.boolean(),
});

const RPC_CONFLICTS = [
  "subscription_exists",
  "partner_required",
  "partner_inactive",
] as const;

type RpcError = {
  message?: string;
  details?: string;
  hint?: string;
};

function rpcErrorCode(error: RpcError): string | null {
  const text = [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (/\bbusiness_not_found\b/.test(text)) return "business_not_found";
  return RPC_CONFLICTS.find((code) =>
    new RegExp(`\\b${code}\\b`).test(text)
  ) ?? null;
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

  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_assignment", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { businessId, partnerId, billingMode, partnerPlan } = parsed.data;
  if (billingMode === "stripe" && partnerId) {
    return NextResponse.json(
      { error: "unsupported_partner_stripe" },
      { status: 409 }
    );
  }
  if (billingMode !== "stripe" && !partnerId) {
    return NextResponse.json(
      { error: "partner_required" },
      { status: 409 }
    );
  }
  if (billingMode === "stripe" && partnerPlan) {
    return NextResponse.json(
      { error: "invalid_partner_plan" },
      { status: 400 }
    );
  }
  if (billingMode !== "stripe" && !partnerPlan) {
    return NextResponse.json(
      { error: "invalid_partner_plan" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin.rpc(
    "assign_business_partner_billing",
    {
      p_business_id: businessId,
      p_partner_id: partnerId,
      p_billing_mode: billingMode,
      p_actor_user_id: admin.id,
      p_partner_plan: partnerPlan,
    }
  );

  if (error) {
    const code = rpcErrorCode(error);
    if (code === "business_not_found") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    if (code && RPC_CONFLICTS.includes(code as (typeof RPC_CONFLICTS)[number])) {
      return NextResponse.json({ error: code }, { status: 409 });
    }

    console.error(
      `[admin:business-partner-billing] Failed to update ${businessId}:`,
      error
    );
    return NextResponse.json(
      { error: "assignment_failed" },
      { status: 500 }
    );
  }

  const rawAssignment = Array.isArray(data) ? data[0] ?? null : data ?? null;
  const assignment = assignmentResultSchema.safeParse(rawAssignment);
  if (!assignment.success) {
    console.error(
      `[admin:business-partner-billing] RPC returned no assignment for ${businessId}`
    );
    return NextResponse.json(
      { error: "assignment_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, assignment: assignment.data });
}
