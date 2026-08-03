import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchAvailableNumbers } from "@/lib/messaging/numbers";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

export async function GET(request: NextRequest) {
  const workspaceGate = await requireWorkspaceRouteAccess();
  if (!workspaceGate.ok) return workspaceGate.response;

  const areaCode = request.nextUrl.searchParams.get("areaCode");

  if (!areaCode || !/^\d{3}$/.test(areaCode)) {
    return NextResponse.json(
      { error: "Area code must be 3 digits" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const numbers = await searchAvailableNumbers(areaCode);
    return NextResponse.json({ numbers });
  } catch (error) {
    console.error("Error searching numbers:", error);
    return NextResponse.json(
      { error: "Failed to search numbers" },
      { status: 500 }
    );
  }
}
