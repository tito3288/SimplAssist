import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Use NEXT_PUBLIC_APP_URL for production (Railway's internal origin is localhost:8080)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Redirect to root — it will route to /onboarding or /dashboard based on status
  return NextResponse.redirect(`${appUrl}/`);
}
