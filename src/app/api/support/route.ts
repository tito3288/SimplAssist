import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendSupportTicketEmail } from "@/lib/email/supportTicket";
import { SUPPORT_CATEGORY_VALUES } from "@/lib/support/constants";
import { getOptionalWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

/**
 * Public support-ticket endpoint backing the /support form.
 *
 * Works logged-in AND logged-out. Validation order (cheap first):
 * 1. IP rate limit (3/min sliding window)
 * 2. JSON parse
 * 3. Schema validation
 * 4. Honeypot (returns a FAKE success — a 400 would teach bots the trap)
 * 5. Optional auth context — user_id/business_id are derived exclusively
 *    server-side from the session; the client payload never carries identity
 * 6. Insert via service role (support_requests has no client grants)
 * 7. Owner-notification email — fire-and-forget; failure never fails the
 *    request (the row is the durable record; `notified` flags the miss)
 */

const supportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORY_VALUES),
  message: z
    .string()
    .trim()
    .min(10, "Please tell us a bit more about what you need")
    .max(5000, "Please keep your message under 5,000 characters"),
  name: z.string().trim().min(1, "Please enter your name").max(200),
  email: z.string().trim().email("Please enter a valid email").max(320),
  // Honeypot — hidden off-screen in the form; humans never fill it.
  website: z.string().optional(),
});

// Simple in-memory rate limiting: IP -> timestamps[] (same pattern as
// api/scrape). Per-instance best-effort — acceptable alongside the honeypot
// and size caps; extracting a shared limiter is deferred cleanup.
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(identifier) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(identifier, recent);
    return true;
  }

  recent.push(now);
  rateLimitMap.set(identifier, recent);
  return false;
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = supportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.website && parsed.data.website.trim() !== "") {
    console.warn("[support] honeypot tripped, dropping submission", { ip });
    return NextResponse.json({ success: true });
  }

  // Optional auth context. Never trust client-sent identity — derive it from
  // the session cookie and the owner lookup only.
  let userId: string | null = null;
  let businessId: string | null = null;
  let businessName: string | null = null;

  const workspace = await getOptionalWorkspaceRouteAccess();

  if (workspace) {
    userId = workspace.user.id;
    businessId = workspace.business.id;
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("id, name")
      .eq("id", workspace.business.id)
      .maybeSingle();
    if (business?.id === workspace.business.id) {
      businessName = business.name ?? null;
    }
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("support_requests")
    .insert({
      category: parsed.data.category,
      message: parsed.data.message,
      name: parsed.data.name,
      email: parsed.data.email,
      user_id: userId,
      business_id: businessId,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("[support] insert failed:", insertError);
    return NextResponse.json(
      { error: "Couldn't submit your request right now. Please try again." },
      { status: 500 }
    );
  }

  const notified = await sendSupportTicketEmail({
    requestId: inserted.id,
    category: parsed.data.category,
    message: parsed.data.message,
    name: parsed.data.name,
    email: parsed.data.email,
    userId,
    businessId,
    businessName,
  });

  if (notified) {
    const { error: updateError } = await supabaseAdmin
      .from("support_requests")
      .update({ notified: true })
      .eq("id", inserted.id);
    if (updateError) {
      console.error("[support] notified flag update failed:", updateError);
    }
  }

  return NextResponse.json({ success: true });
}
