import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import { approveA2pRiskReview } from "@/lib/admin/a2pRiskReview";
import { isAuthorizedReviewToken } from "@/lib/admin/reviewToken";

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
  const tokenAuthorized = isAuthorizedReviewToken(providedToken, configuredToken);
  const admin = tokenAuthorized ? null : await getAdminUser();

  if (!tokenAuthorized && !admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const { businessId, note } = parsed.data;
  try {
    const result = await approveA2pRiskReview({
      businessId,
      note,
      reviewedBy:
        parsed.data.reviewedBy ?? admin?.email ?? admin?.id ?? "token_admin",
      acknowledgeFeeRisk: true,
    });
    return NextResponse.json({
      success: true,
      status: result.status,
      inputHash: result.inputHash,
    });
  } catch (error) {
    console.error("[a2p-risk:admin] Approval failed:", error);
    return NextResponse.json(
      { error: "Failed to save A2P review override" },
      { status: 500 }
    );
  }
}
