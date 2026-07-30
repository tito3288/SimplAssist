import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyWaitlistUnsubscribeToken } from "@/lib/waitlist/unsubscribeToken";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: PRIVATE_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("Invalid request", 400);
  }

  const tokenValue = formData.get("token");
  if (typeof tokenValue !== "string") {
    return errorResponse("Invalid unsubscribe link", 400);
  }

  let signupId: string | null;
  try {
    signupId = verifyWaitlistUnsubscribeToken(tokenValue);
  } catch {
    console.error("[waitlist:unsubscribe] token verification unavailable");
    return errorResponse("Unsubscribe is temporarily unavailable", 500);
  }

  if (!signupId) {
    return errorResponse("Invalid unsubscribe link", 400);
  }

  const { error } = await supabaseAdmin
    .from("waitlist_signups")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", signupId)
    .is("unsubscribed_at", null);

  if (error) {
    console.error("[waitlist:unsubscribe] update failed", {
      code: error.code ?? "unknown",
    });
    return errorResponse("Unsubscribe is temporarily unavailable", 500);
  }

  return new NextResponse(null, {
    status: 303,
    headers: {
      ...PRIVATE_HEADERS,
      Location: new URL("/waitlist/unsubscribed", request.url).toString(),
    },
  });
}
