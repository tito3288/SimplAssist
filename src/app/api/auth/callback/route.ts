import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Use NEXT_PUBLIC_APP_URL for production (Railway's internal origin is localhost:8080)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  } else if (token_hash && type) {
    const supabase = await createClient();
    await supabase.auth.verifyOtp({ type, token_hash });
  }

  // Redirect to root — it will route to /onboarding or /dashboard based on status
  return NextResponse.redirect(`${appUrl}/`);
}
