import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { createClient } from "@/lib/supabase/server";
import { websiteScanIdSchema } from "@/lib/website-scans/contracts";
import {
  markWebsiteScanResponseNoStore,
  websiteScanJson,
  websiteScanReadErrorResponse,
} from "@/lib/website-scans/http.server";
import { loadWebsiteScan } from "@/lib/website-scans/ownerRepository.server";

export async function GET(
  _request: Request,
  { params }: { params: { scanId: string } },
) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) {
    return markWebsiteScanResponseNoStore(workspace.response);
  }

  const parsedId = websiteScanIdSchema.safeParse(params.scanId);
  if (!parsedId.success) {
    return websiteScanJson(
      { error: "Website scan not found.", code: "website_scan_not_found" },
      { status: 404 },
    );
  }

  try {
    const client = await createClient();
    const scan = await loadWebsiteScan(
      client,
      workspace.access.business.id,
      parsedId.data,
    );
    if (!scan) {
      return websiteScanJson(
        { error: "Website scan not found.", code: "website_scan_not_found" },
        { status: 404 },
      );
    }
    return websiteScanJson({ scan });
  } catch (error) {
    return websiteScanReadErrorResponse(error);
  }
}
