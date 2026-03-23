import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAuthUrl } from "@/lib/google/client";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  const url = generateAuthUrl(business.id);
  return NextResponse.redirect(url);
}
