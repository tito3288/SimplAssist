import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appendRiskEvent,
  buildA2pRiskInputForBusiness,
  hashA2pRiskInput,
} from "@/lib/messaging/registration/riskScreening";
import { A2P_RISK_PASSED_MESSAGE } from "@/lib/messaging/registration/riskCategories";

const overrideSchema = z.object({
  businessId: z.string().uuid(),
  note: z.string().min(8),
  reviewedBy: z.string().min(2).optional(),
  acknowledgeFeeRisk: z.literal(true),
});

export async function POST(request: NextRequest) {
  const configuredToken = process.env.A2P_REVIEW_ADMIN_TOKEN;
  const providedToken =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-a2p-review-admin-token")?.trim();

  if (!configuredToken || providedToken !== configuredToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid review override", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { businessId, note, reviewedBy } = parsed.data;
  const { input } = await buildA2pRiskInputForBusiness(businessId);
  const inputHash = hashA2pRiskInput(input);
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      a2p_risk_review_status: "admin_approved",
      a2p_risk_review_input_hash: inputHash,
      a2p_risk_review_message: A2P_RISK_PASSED_MESSAGE,
      a2p_risk_review_reason: "Admin approved after manual review",
      a2p_risk_review_reviewed_at: now,
      a2p_risk_review_reviewed_by: reviewedBy ?? "admin",
      a2p_risk_review_override_note: note,
      a2p_risk_review_updated_at: now,
    })
    .eq("id", businessId)
    .or(
      [
        "a2p_risk_review_status.is.null",
        "a2p_risk_review_status.neq.admin_approved",
        "a2p_risk_review_input_hash.is.null",
        `a2p_risk_review_input_hash.neq.${inputHash}`,
      ].join(",")
    );

  if (error) {
    console.error(
      `[a2p-risk:admin] Failed to approve ${businessId}:`,
      error
    );
    return NextResponse.json(
      { error: "Failed to save A2P review override" },
      { status: 500 }
    );
  }

  await appendRiskEvent({
    businessId,
    eventType: "admin_approved",
    status: "admin_approved",
    inputHash,
    message: A2P_RISK_PASSED_MESSAGE,
    rawPayload: {
      reviewedBy: reviewedBy ?? "admin",
      note,
      acknowledgeFeeRisk: true,
    },
  });

  return NextResponse.json({
    success: true,
    status: "admin_approved",
    inputHash,
  });
}
