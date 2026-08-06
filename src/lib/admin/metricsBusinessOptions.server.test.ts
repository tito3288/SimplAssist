import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminMonthlyBusinessMetricBusinessOptionV2,
  AdminMonthlyBusinessMetricPartnerOptionV1,
} from "@/lib/metrics/contract";

const mocks = vi.hoisted(() => {
  const inIds = vi.fn();
  const select = vi.fn(() => ({ in: inIds }));
  const from = vi.fn(() => ({ select }));
  return { from, inIds, select };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE,
  ADMIN_METRICS_BUSINESS_ATTRIBUTION_COLUMNS,
  loadAdminMetricsBusinessOptionGroups,
} from "./metricsBusinessOptions.server";

const ALPHA_PARTNER_ID = "10000000-0000-4000-a046-000000000001";
const BETA_PARTNER_ID = "10000000-0000-4000-a046-000000000002";

function businessId(index: number): string {
  return `20000000-0000-4000-a046-${index.toString(16).padStart(12, "0")}`;
}

function business(
  index: number,
  businessName = `Business ${index}`,
): AdminMonthlyBusinessMetricBusinessOptionV2 {
  return { business_id: businessId(index), business_name: businessName };
}

function partner(
  partnerId: string,
  name: string | null,
  slug: string | null = null,
): AdminMonthlyBusinessMetricPartnerOptionV1 {
  return {
    partner_id: partnerId,
    partner_name: name,
    partner_slug: slug,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inIds.mockResolvedValue({ data: [], error: null });
});

describe("loadAdminMetricsBusinessOptionGroups", () => {
  it("reads only current business attribution in bounded ID chunks", async () => {
    const options = Array.from(
      { length: ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE + 1 },
      (_, index) => business(index + 1),
    );
    const firstChunk = options.slice(
      0,
      ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE,
    );
    const secondChunk = options.slice(
      ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE,
    );
    mocks.inIds
      .mockResolvedValueOnce({
        data: firstChunk.map((option) => ({
          id: option.business_id,
          partner_id: null,
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: secondChunk.map((option) => ({
          id: option.business_id,
          partner_id: null,
        })),
        error: null,
      });

    await expect(
      loadAdminMetricsBusinessOptionGroups(options, []),
    ).resolves.not.toBeNull();

    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.from).toHaveBeenNthCalledWith(1, "businesses");
    expect(mocks.from).toHaveBeenNthCalledWith(2, "businesses");
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select).toHaveBeenNthCalledWith(
      1,
      ADMIN_METRICS_BUSINESS_ATTRIBUTION_COLUMNS,
    );
    expect(mocks.select).toHaveBeenNthCalledWith(
      2,
      ADMIN_METRICS_BUSINESS_ATTRIBUTION_COLUMNS,
    );
    expect(mocks.inIds).toHaveBeenNthCalledWith(
      1,
      "id",
      firstChunk.map((option) => option.business_id),
    );
    expect(mocks.inIds).toHaveBeenNthCalledWith(
      2,
      "id",
      secondChunk.map((option) => option.business_id),
    );
  });

  it("looks up deletion-scheduled and history-only RPC options without a deleted_at filter", async () => {
    const deletionScheduled = business(1, "Deletion Scheduled");
    const historyOnly = business(2, "Historical Business");
    mocks.inIds.mockResolvedValue({
      data: [
        { id: historyOnly.business_id, partner_id: ALPHA_PARTNER_ID },
        { id: deletionScheduled.business_id, partner_id: null },
      ],
      error: null,
    });

    await expect(
      loadAdminMetricsBusinessOptionGroups(
        [deletionScheduled, historyOnly],
        [partner(ALPHA_PARTNER_ID, "Alpha Partner")],
      ),
    ).resolves.toEqual([
      {
        id: "direct",
        label: "SimplAssist direct",
        businesses: [deletionScheduled],
      },
      {
        id: ALPHA_PARTNER_ID,
        label: "Alpha Partner",
        businesses: [historyOnly],
      },
    ]);

    expect(mocks.inIds).toHaveBeenCalledWith("id", [
      deletionScheduled.business_id,
      historyOnly.business_id,
    ]);
  });

  it("groups direct first, partners alphabetically, and businesses by name then ID", async () => {
    const options = [
      business(4, "Zulu Direct"),
      business(5, "Same Business"),
      business(3, "Beta Business"),
      business(2, "same business"),
      business(1, "Alpha Direct"),
    ];
    mocks.inIds.mockResolvedValue({
      data: [
        { id: businessId(1), partner_id: null },
        { id: businessId(2), partner_id: BETA_PARTNER_ID },
        { id: businessId(3), partner_id: ALPHA_PARTNER_ID },
        { id: businessId(4), partner_id: null },
        { id: businessId(5), partner_id: BETA_PARTNER_ID },
      ],
      error: null,
    });

    await expect(
      loadAdminMetricsBusinessOptionGroups(options, [
        partner(BETA_PARTNER_ID, "Zulu Agency"),
        partner(ALPHA_PARTNER_ID, null, "alpha-agency"),
      ]),
    ).resolves.toEqual([
      {
        id: "direct",
        label: "SimplAssist direct",
        businesses: [business(1, "Alpha Direct"), business(4, "Zulu Direct")],
      },
      {
        id: ALPHA_PARTNER_ID,
        label: "alpha-agency",
        businesses: [business(3, "Beta Business")],
      },
      {
        id: BETA_PARTNER_ID,
        label: "Zulu Agency",
        businesses: [
          business(2, "same business"),
          business(5, "Same Business"),
        ],
      },
    ]);
  });

  it("returns no groups without issuing a service-role read when there are no businesses", async () => {
    await expect(
      loadAdminMetricsBusinessOptionGroups([], []),
    ).resolves.toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns flat-picker fallback on query errors or thrown reads", async () => {
    const option = business(1);
    mocks.inIds.mockResolvedValueOnce({
      data: null,
      error: { message: "query failed" },
    });

    await expect(
      loadAdminMetricsBusinessOptionGroups([option], []),
    ).resolves.toBeNull();

    mocks.inIds.mockRejectedValueOnce(new Error("network failure"));
    await expect(
      loadAdminMetricsBusinessOptionGroups([option], []),
    ).resolves.toBeNull();
  });

  it("returns flat-picker fallback when attribution is incomplete after a race", async () => {
    mocks.inIds.mockResolvedValue({
      data: [{ id: businessId(1), partner_id: null }],
      error: null,
    });

    await expect(
      loadAdminMetricsBusinessOptionGroups([business(1), business(2)], []),
    ).resolves.toBeNull();
  });

  it("returns flat-picker fallback for unknown partner attribution", async () => {
    mocks.inIds.mockResolvedValue({
      data: [{ id: businessId(1), partner_id: ALPHA_PARTNER_ID }],
      error: null,
    });

    await expect(
      loadAdminMetricsBusinessOptionGroups([business(1)], []),
    ).resolves.toBeNull();
  });

  it.each([
    ["null payload", null],
    ["malformed row", [{ id: "not-a-uuid", partner_id: null }]],
    [
      "unexpected field",
      [{ id: businessId(1), partner_id: null, deleted_at: null }],
    ],
    [
      "unrequested row",
      [{ id: businessId(2), partner_id: null }],
    ],
    [
      "duplicate row",
      [
        { id: businessId(1), partner_id: null },
        { id: businessId(1), partner_id: null },
      ],
    ],
  ])("returns flat-picker fallback for %s", async (_label, data) => {
    mocks.inIds.mockResolvedValue({ data, error: null });

    await expect(
      loadAdminMetricsBusinessOptionGroups([business(1)], []),
    ).resolves.toBeNull();
  });
});
