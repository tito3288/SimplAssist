import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/entitlements", () => ({
  canUseFeature: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
}));

import { websiteScanRpcErrorResponse } from "./http.server";

describe("websiteScanRpcErrorResponse", () => {
  it("preserves the plan-required response instead of hiding it as not found", async () => {
    const response = websiteScanRpcErrorResponse({
      code: "42501",
      message: "website_scan_plan_required",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "website_scan_plan_required",
    });
  });

  it("reports an onboarding-purpose race as a conflict", async () => {
    const response = websiteScanRpcErrorResponse({
      code: "42501",
      message: "website_scan_purpose_mismatch",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "website_scan_trigger_mismatch",
    });
  });

  it("continues to hide genuinely inaccessible scans", async () => {
    const response = websiteScanRpcErrorResponse({
      code: "42501",
      message: "website_scan_not_accessible",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "website_scan_not_found",
    });
  });
});
