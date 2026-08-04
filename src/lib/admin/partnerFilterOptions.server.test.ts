import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return { from, limit, select };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  ADMIN_PARTNER_FILTER_OPTIONS_COLUMNS,
  loadAdminPartnerFilterOptions,
} from "./partnerFilterOptions.server";

const ALPHA_ID = "10000000-0000-4000-a046-000000000001";
const BETA_ID = "10000000-0000-4000-a046-000000000002";
const BUSINESS_ID = "20000000-0000-4000-a046-000000000001";

function ownershipRow(partnerId: string, name: string) {
  return {
    id: partnerId,
    name,
    businesses: [{ id: BUSINESS_ID }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue({ data: [], error: null });
});

describe("loadAdminPartnerFilterOptions", () => {
  it("uses one minimized partner read with an inner ownership join and no status filter", async () => {
    mocks.limit.mockResolvedValue({
      data: [ownershipRow(ALPHA_ID, "Alpha Partner")],
      error: null,
    });

    await expect(loadAdminPartnerFilterOptions()).resolves.toEqual([
      { id: ALPHA_ID, name: "Alpha Partner" },
    ]);

    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("partners");
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.select).toHaveBeenCalledWith(
      ADMIN_PARTNER_FILTER_OPTIONS_COLUMNS,
    );
    expect(mocks.limit).toHaveBeenCalledOnce();
    expect(mocks.limit).toHaveBeenCalledWith(1, {
      referencedTable: "businesses",
    });
  });

  it("includes every assigned partner, trims names, deduplicates, and sorts", async () => {
    mocks.limit.mockResolvedValue({
      data: [
        ownershipRow(BETA_ID, "  Beta Partner  "),
        ownershipRow(ALPHA_ID, "Alpha Partner"),
        ownershipRow(BETA_ID, "Beta Partner"),
      ],
      error: null,
    });

    await expect(loadAdminPartnerFilterOptions()).resolves.toEqual([
      { id: ALPHA_ID, name: "Alpha Partner" },
      { id: BETA_ID, name: "Beta Partner" },
    ]);
  });

  it("returns an empty list for a valid empty response", async () => {
    await expect(loadAdminPartnerFilterOptions()).resolves.toEqual([]);
  });

  it("fails explicitly when the service-role query fails", async () => {
    const queryError = { code: "42501", message: "permission denied" };
    mocks.limit.mockResolvedValue({ data: null, error: queryError });

    await expect(loadAdminPartnerFilterOptions()).rejects.toMatchObject({
      name: "AdminPartnerFilterOptionsReadError",
      code: "query_failed",
      cause: queryError,
    });
  });

  it("rejects null payloads instead of treating them as empty", async () => {
    mocks.limit.mockResolvedValue({ data: null, error: null });

    await expect(loadAdminPartnerFilterOptions()).rejects.toMatchObject({
      name: "AdminPartnerFilterOptionsReadError",
      code: "invalid_response",
    });
  });

  it.each([
    [
      "unexpected partner field",
      { ...ownershipRow(ALPHA_ID, "Alpha"), status: "inactive" },
    ],
    [
      "unexpected business field",
      {
        ...ownershipRow(ALPHA_ID, "Alpha"),
        businesses: [{ id: BUSINESS_ID, email: "private@example.com" }],
      },
    ],
    ["malformed UUID", ownershipRow("not-a-uuid", "Alpha")],
    ["blank name", ownershipRow(ALPHA_ID, "   ")],
    ["missing relation", { id: ALPHA_ID, name: "Alpha", businesses: [] }],
  ])("rejects %s", async (_label, row) => {
    mocks.limit.mockResolvedValue({ data: [row], error: null });

    await expect(loadAdminPartnerFilterOptions()).rejects.toMatchObject({
      name: "AdminPartnerFilterOptionsReadError",
      code: "invalid_response",
    });
  });

  it("rejects conflicting names for the same assigned partner", async () => {
    mocks.limit.mockResolvedValue({
      data: [
        ownershipRow(ALPHA_ID, "Alpha Partner"),
        ownershipRow(ALPHA_ID, "Different Name"),
      ],
      error: null,
    });

    const result = loadAdminPartnerFilterOptions();

    await expect(result).rejects.toMatchObject({
      name: "AdminPartnerFilterOptionsReadError",
      code: "inconsistent_response",
    });
  });
});
