import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthCallbackOrigin } from "@/lib/auth/callbackOrigin.server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  } else if (token_hash && type) {
    const supabase = await createClient();
    await supabase.auth.verifyOtp({ type, token_hash });
  }

  const appOrigin = await resolveAuthCallbackOrigin(
    request.headers.get("host")
  );

  // Dashboard guards route new, incomplete, deleted, and ready accounts.
  return NextResponse.redirect(`${appOrigin}/dashboard`);
}
