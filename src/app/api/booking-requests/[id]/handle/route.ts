import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { createClient } from "@/lib/supabase/server";

const bookingRequestIdSchema = z.string().uuid();

const notFoundResponse = () =>
  NextResponse.json(
    { error: "Appointment request not found" },
    { status: 404 }
  );

const serviceUnavailableResponse = () =>
  NextResponse.json(
    { error: "Service temporarily unavailable", retryable: true },
    { status: 503 }
  );

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const parsedRequestId = bookingRequestIdSchema.safeParse(params.id);
  if (!parsedRequestId.success) return notFoundResponse();

  const businessId = workspace.access.business.id;

  try {
    const supabase = await createClient();
    const { data: handledAt, error } = await supabase.rpc(
      "mark_booking_request_handled",
      {
        p_business_id: businessId,
        p_request_id: parsedRequestId.data,
      }
    );

    if (error?.code === "P0002") return notFoundResponse();

    if (error) {
      console.error("[booking-requests:handle] RPC failed:", error);
      return serviceUnavailableResponse();
    }

    if (
      typeof handledAt !== "string" ||
      Number.isNaN(Date.parse(handledAt))
    ) {
      console.error(
        "[booking-requests:handle] RPC returned an invalid handled timestamp."
      );
      return serviceUnavailableResponse();
    }

    return NextResponse.json({
      request: {
        id: parsedRequestId.data,
        status: "handled",
        handledAt,
      },
    });
  } catch (error) {
    console.error("[booking-requests:handle] RPC unavailable:", error);
    return serviceUnavailableResponse();
  }
}
