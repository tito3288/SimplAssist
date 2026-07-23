import { NextResponse } from "next/server";

/**
 * Retired fail-closed endpoint.
 *
 * Number release is a lifecycle-worker operation. A customer-facing request
 * must never call Telnyx or delete the local ownership record directly.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Direct phone-number release is no longer supported.",
      code: "number_release_managed_by_lifecycle",
    },
    { status: 410 }
  );
}
