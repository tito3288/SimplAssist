import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runFullRegistration } from "@/lib/messaging/registration";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

const retrySchema = z.object({
  businessId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = retrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { businessId } = parsed.data;

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select("id, compliance_info_completed_at")
    .eq("id", businessId)
    .eq("owner_id", user.id)
    .single();

  if (ownershipError || !business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  if (!business.compliance_info_completed_at) {
    return NextResponse.json(
      { error: "Complete brand verification info before retrying registration" },
      { status: 400 }
    );
  }

  try {
    await runFullRegistration(businessId);
  } catch (err) {
    console.error(
      `[onboarding:retry-registration] Registration failed for ${businessId}:`,
      err
    );
    return NextResponse.json(
      { error: REGISTRATION_FAILURE_MESSAGE },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
