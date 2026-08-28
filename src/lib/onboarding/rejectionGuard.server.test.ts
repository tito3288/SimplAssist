import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { CarrierRejectionSupportRequiredError } from "./rejectionGuidance";
import { assertNoCarrierRejectionForBusiness } from "./rejectionGuard.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000456";

function mockResult(result: unknown) {
  const single = vi.fn(async () => result);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ select });
  return { select, eq, single };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertNoCarrierRejectionForBusiness", () => {
  it("allows a fresh non-rejected carrier snapshot", async () => {
    const query = mockResult({
      data: {
        brand_status: "approved",
        campaign_status: "pending",
        brand_rejection_reason: null,
        campaign_rejection_reason: null,
      },
      error: null,
    });

    await expect(
      assertNoCarrierRejectionForBusiness(BUSINESS_ID),
    ).resolves.toBeUndefined();

    expect(mocks.from).toHaveBeenCalledWith("businesses");
    expect(query.eq).toHaveBeenCalledWith("id", BUSINESS_ID);
  });

  it.each([
    ["brand", "Exact brand rejection"],
    ["campaign", "Exact campaign rejection"],
  ] as const)(
    "throws the support-only error for a %s rejection",
    async (resource, reason) => {
      mockResult({
        data: {
          brand_status: resource === "brand" ? "rejected" : "approved",
          campaign_status: resource === "campaign" ? "rejected" : null,
          brand_rejection_reason: resource === "brand" ? reason : null,
          campaign_rejection_reason: resource === "campaign" ? reason : null,
        },
        error: null,
      });

      const error = await assertNoCarrierRejectionForBusiness(
        BUSINESS_ID,
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(CarrierRejectionSupportRequiredError);
      expect(error).toMatchObject({
        code: "rejection_support_required",
        carrierReason: reason,
        rejectedResource: resource,
      });
    },
  );

  it("fails closed when carrier state cannot be refreshed", async () => {
    mockResult({ data: null, error: { message: "database unavailable" } });

    await expect(
      assertNoCarrierRejectionForBusiness(BUSINESS_ID),
    ).rejects.toThrow("Failed to refresh carrier status");
  });
});
