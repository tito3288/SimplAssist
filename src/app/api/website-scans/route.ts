import { NextRequest } from "next/server";

import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { createClient } from "@/lib/supabase/server";
import { websiteScanStartSchema } from "@/lib/website-scans/contracts";
import {
  authorizeWebsiteScanMutation,
  markWebsiteScanResponseNoStore,
  websiteScanJson,
  websiteScanReadErrorResponse,
  websiteScanRolloutDenied,
  websiteScanRpcErrorResponse,
} from "@/lib/website-scans/http.server";
import {
  scanIdFromRpcData,
  startWebsiteScan,
} from "@/lib/website-scans/ownerActions.server";
import { loadWebsiteScan } from "@/lib/website-scans/ownerRepository.server";
import { validateWebsiteScanSourceUrl } from "@/lib/website-scans/sourceUrl.server";

export async function POST(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) {
    return markWebsiteScanResponseNoStore(workspace.response);
  }

  const { business, user } = workspace.access;
  const rolloutDenied = websiteScanRolloutDenied(business.id);
  if (rolloutDenied) return rolloutDenied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return websiteScanJson(
      { error: "Request body must be valid JSON.", code: "invalid_request" },
      { status: 400 },
    );
  }
  const parsed = websiteScanStartSchema.safeParse(body);
  if (!parsed.success) {
    return websiteScanJson(
      { error: "Enter a valid HTTPS website URL.", code: "invalid_request" },
      { status: 400 },
    );
  }

  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch (error) {
    return websiteScanReadErrorResponse(error);
  }

  const accessDenied = await authorizeWebsiteScanMutation({
    client,
    businessId: business.id,
    ownerId: user.id,
    trigger: parsed.data.trigger,
  });
  if (accessDenied) return accessDenied;

  let sourceUrl: string;
  try {
    sourceUrl = await validateWebsiteScanSourceUrl(parsed.data.url);
  } catch {
    return websiteScanJson(
      {
        error: "Enter a public HTTPS website URL.",
        code: "invalid_website_url",
      },
      { status: 400 },
    );
  }

  const result = await startWebsiteScan(client, {
    businessId: business.id,
    sourceUrl,
    purpose:
      parsed.data.trigger === "onboarding" ? "onboarding" : "manual_rescan",
    idempotencyKey: parsed.data.clientRequestId,
  });
  if (result.error) return websiteScanRpcErrorResponse(result.error);

  const scanId = scanIdFromRpcData(result.data);
  if (!scanId) return websiteScanReadErrorResponse("invalid start response");
  try {
    const scan = await loadWebsiteScan(client, business.id, scanId);
    if (!scan) return websiteScanReadErrorResponse("started scan not readable");
    return websiteScanJson(
      { scan },
      { status: scan.status === "ready_for_review" ? 200 : 202 },
    );
  } catch (error) {
    return websiteScanReadErrorResponse(error);
  }
}
