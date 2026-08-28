import { NextRequest } from "next/server";

import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { createClient } from "@/lib/supabase/server";
import {
  websiteScanIdSchema,
  websiteScanReviewMutationSchema,
} from "@/lib/website-scans/contracts";
import {
  authorizeWebsiteScanMutation,
  markWebsiteScanResponseNoStore,
  websiteScanJson,
  websiteScanReadErrorResponse,
  websiteScanRolloutDenied,
  websiteScanRpcErrorResponse,
} from "@/lib/website-scans/http.server";
import { saveWebsiteScanReview } from "@/lib/website-scans/ownerActions.server";
import { loadWebsiteScan } from "@/lib/website-scans/ownerRepository.server";

export async function PATCH(
  request: NextRequest,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return websiteScanJson(
      { error: "Request body must be valid JSON.", code: "invalid_request" },
      { status: 400 },
    );
  }
  const parsed = websiteScanReviewMutationSchema.safeParse(body);
  if (!parsed.success) {
    return websiteScanJson(
      { error: "The review draft is invalid.", code: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const client = await createClient();
    const accessDenied = await authorizeWebsiteScanMutation({
      client,
      businessId: business.id,
      ownerId: user.id,
    });
    if (accessDenied) return accessDenied;

    const result = await saveWebsiteScanReview(client, {
      scanId: parsedId.data,
      expectedRevision: parsed.data.expectedVersion,
      draft: parsed.data.draft,
    });
    if (result.error) return websiteScanRpcErrorResponse(result.error);

    const scan = await loadWebsiteScan(client, business.id, parsedId.data);
    if (!scan) return websiteScanReadErrorResponse("saved scan not readable");
    return websiteScanJson({ scan });
  } catch (error) {
    return websiteScanReadErrorResponse(error);
  }
}
