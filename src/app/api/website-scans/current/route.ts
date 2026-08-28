import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { createClient } from "@/lib/supabase/server";
import {
  markWebsiteScanResponseNoStore,
  websiteScanJson,
  websiteScanReadErrorResponse,
} from "@/lib/website-scans/http.server";
import { loadCurrentWebsiteScan } from "@/lib/website-scans/ownerRepository.server";

export async function GET() {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) {
    return markWebsiteScanResponseNoStore(workspace.response);
  }

  try {
    const client = await createClient();
    const scan = await loadCurrentWebsiteScan(
      client,
      workspace.access.business.id,
    );
    return websiteScanJson({ scan });
  } catch (error) {
    return websiteScanReadErrorResponse(error);
  }
}
