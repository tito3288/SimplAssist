import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStateForOwner } from "@/lib/onboarding/state";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await getOnboardingStateForOwner(user.id);
  if (!state) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  return NextResponse.json({ state });
}
