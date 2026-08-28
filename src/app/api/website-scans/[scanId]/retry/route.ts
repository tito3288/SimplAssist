import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { createClient } from "@/lib/supabase/server";
import { websiteScanIdSchema } from "@/lib/website-scans/contracts";
import {
  authorizeWebsiteScanMutation,
  markWebsiteScanResponseNoStore,
  websiteScanJson,
  websiteScanReadErrorResponse,
  websiteScanRolloutDenied,
  websiteScanRpcErrorResponse,
} from "@/lib/website-scans/http.server";
import { retryWebsiteScan } from "@/lib/website-scans/ownerActions.server";
import { loadWebsiteScan } from "@/lib/website-scans/ownerRepository.server";

export async function POST(
  _request: Request,
  { params }: { params: { scanId: string } },
) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) {
    return markWebsiteScanResponseNoStore(workspace.response);
  }
  const { business, user } = workspace.access;
  const rolloutDenied = websiteScanRolloutDenied(business.id);
  if (rolloutDenied) return rolloutDenied;

  const parsedId = websiteScanIdSchema.safeParse(params.scanId);
  if (!parsedId.success) {
    return websiteScanJson(
      { error: "Website scan not found.", code: "website_scan_not_found" },
      { status: 404 },
    );
  }

  try {
    const client = await createClient();
    const failed = await loadWebsiteScan(client, business.id, parsedId.data);
    if (!failed) {
      return websiteScanJson(
        { error: "Website scan not found.", code: "website_scan_not_found" },
        { status: 404 },
      );
    }
    // If the first retry committed but its HTTP response was lost, the owner
    // sees the already-running durable retry instead of a misleading conflict.
    if (["queued", "discovering", "crawling", "extracting"].includes(failed.status)) {
      return websiteScanJson({ scan: failed }, { status: 202 });
    }

    const accessDenied = await authorizeWebsiteScanMutation({
      client,
      businessId: business.id,
      ownerId: user.id,
    });
    if (accessDenied) return accessDenied;

    if (failed.status !== "failed" || !failed.updatedAt) {
      return websiteScanJson(
        {
          error: "Only a failed website scan can be retried.",
          code: "website_scan_not_retryable",
        },
        { status: 409 },
      );
    }

    const result = await retryWebsiteScan(client, {
      scanId: parsedId.data,
      failedRunUpdatedAt: failed.updatedAt,
    });
    if (result.error) return websiteScanRpcErrorResponse(result.error);

    const scan = await loadWebsiteScan(client, business.id, parsedId.data);
    if (!scan) return websiteScanReadErrorResponse("retried scan not readable");
    return websiteScanJson({ scan }, { status: 202 });
  } catch (error) {
    return websiteScanReadErrorResponse(error);
  }
}
