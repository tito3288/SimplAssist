import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUSINESS_METRIC_KEYS_V1,
  type AdminMonthlyBusinessMetricRowV1,
  type AdminMonthlyBusinessMetricsResponseV1,
  type BusinessMetricCountsV1,
  type BusinessMetricKeyV1,
} from "@/lib/metrics/contract";
import type { AdminMetricsFilters } from "./metricsFilters";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  ADMIN_MONTHLY_BUSINESS_METRICS_RPC,
  AdminMetricsReadError,
  loadAdminMonthlyBusinessMetrics,
} from "./metrics.server";

const PARTNER_A = "10000000-0000-4000-a050-000000000001";
const PARTNER_B = "10000000-0000-4000-a050-000000000002";
const BUSINESS_A = "20000000-0000-4000-a050-000000000001";
const BUSINESS_B = "20000000-0000-4000-a050-000000000002";
const AVAILABLE_SINCE = "2026-08-05T16:30:00+00:00";

const ALL_FILTERS: AdminMetricsFilters = {
  month: "2026-08",
  scope: "all",
  partnerId: null,
};
const DIRECT_FILTERS: AdminMetricsFilters = {
  month: "2026-08",
  scope: "direct",
  partnerId: null,
};
const PARTNER_FILTERS: AdminMetricsFilters = {
  month: "2026-08",
  scope: "partner",
  partnerId: PARTNER_A,
};

const BACKFILL_SUPPORT = {
  missed_call_caught: false,
  ai_conversation_engaged: false,
  booking_confirmed: true,
  web_chat_session_engaged: false,
  contact_created: true,
  hot_lead_classified: true,
  sms_message_inbound: true,
  sms_message_outbound: true,
  sms_parts_inbound: true,
  sms_parts_outbound: true,
  mms_event_inbound: true,
  mms_event_outbound: true,
} as const satisfies Record<BusinessMetricKeyV1, boolean>;

function counts(
  overrides: Partial<BusinessMetricCountsV1> = {},
): BusinessMetricCountsV1 {
  const bookingConfirmedAi = overrides.booking_confirmed_ai ?? 0;
  const bookingConfirmedDashboard =
    overrides.booking_confirmed_dashboard ?? 0;
  return {
    missed_call_caught: 0,
    ai_conversation_engaged: 0,
    booking_confirmed: bookingConfirmedAi + bookingConfirmedDashboard,
    web_chat_session_engaged: 0,
    contact_created: 0,
    hot_lead_classified: 0,
    sms_message_inbound: 0,
    sms_message_outbound: 0,
    sms_parts_inbound: 0,
    sms_parts_outbound: 0,
    mms_event_inbound: 0,
    mms_event_outbound: 0,
    booking_confirmed_ai: bookingConfirmedAi,
    booking_confirmed_dashboard: bookingConfirmedDashboard,
    ...overrides,
  };
}

function partnerFacts(partnerId: string | null) {
  if (partnerId === PARTNER_A) {
    return { partner_name: "Agency Alpha", partner_slug: "agency-alpha" };
  }
  return { partner_name: null, partner_slug: null };
}

function row(args: {
  businessId: string;
  businessName: string;
  partnerId: string | null;
  counts?: BusinessMetricCountsV1;
}): AdminMonthlyBusinessMetricRowV1 {
  return {
    business_id: args.businessId,
    business_name: args.businessName,
    partner_id_at_event: args.partnerId,
    ...partnerFacts(args.partnerId),
    counts: args.counts ?? counts(),
  };
}

function addCounts(
  target: BusinessMetricCountsV1,
  source: BusinessMetricCountsV1,
): void {
  for (const key of Object.keys(target) as Array<keyof BusinessMetricCountsV1>) {
    target[key] += source[key];
  }
}

function validPayload(
  filters: AdminMetricsFilters,
  businesses: AdminMonthlyBusinessMetricRowV1[] = [],
): AdminMonthlyBusinessMetricsResponseV1 {
  const totals = counts();
  const totalsByPartner = new Map<string, BusinessMetricCountsV1>();
  for (const business of businesses) {
    addCounts(totals, business.counts);
    const key = business.partner_id_at_event ?? "direct";
    const brandCounts = totalsByPartner.get(key) ?? counts();
    addCounts(brandCounts, business.counts);
    totalsByPartner.set(key, brandCounts);
  }

  return {
    period: {
      month: filters.month,
      start: `${filters.month}-01T00:00:00+00:00`,
      end_exclusive: "2026-09-01T00:00:00+00:00",
    },
    scope: {
      kind: filters.scope,
      partner_id: filters.partnerId,
    },
    definitions: BUSINESS_METRIC_KEYS_V1.map((metricKey) => ({
      metric_key: metricKey,
      definition_version: 1,
      available_since: AVAILABLE_SINCE,
      supports_historical_backfill: BACKFILL_SUPPORT[metricKey],
    })),
    totals,
    brand_totals: Array.from(totalsByPartner, ([key, brandCounts]) => {
      const partnerId = key === "direct" ? null : key;
      return {
        brand_kind: partnerId === null ? "direct" : "partner",
        partner_id_at_event: partnerId,
        ...partnerFacts(partnerId),
        counts: brandCounts,
      };
    }),
    businesses,
    partner_options: [
      {
        partner_id: PARTNER_A,
        partner_name: "Agency Alpha",
        partner_slug: "agency-alpha",
      },
      {
        partner_id: PARTNER_B,
        partner_name: null,
        partner_slug: null,
      },
    ],
  };
}

function allScopeRows(): AdminMonthlyBusinessMetricRowV1[] {
  return [
    row({
      businessId: BUSINESS_A,
      businessName: "River City Dental",
      partnerId: null,
      counts: counts({ missed_call_caught: 2 }),
    }),
    row({
      businessId: BUSINESS_A,
      businessName: "River City Dental",
      partnerId: PARTNER_A,
      counts: counts({ sms_message_outbound: 3 }),
    }),
    row({
      businessId: BUSINESS_B,
      businessName: "Lakeview Dental",
      partnerId: PARTNER_A,
      counts: counts({
        contact_created: 1,
        booking_confirmed_ai: 1,
      }),
    }),
  ];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mutableObject(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function mutableArray(value: unknown): unknown[] {
  return value as unknown[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({
    data: validPayload(ALL_FILTERS),
    error: null,
  });
});

describe("loadAdminMonthlyBusinessMetrics", () => {
  it.each([
    [ALL_FILTERS, "2026-08-01", "all", null],
    [DIRECT_FILTERS, "2026-08-01", "direct", null],
    [PARTNER_FILTERS, "2026-08-01", "partner", PARTNER_A],
  ] as const)(
    "uses the exact content-free RPC arguments for %#",
    async (filters, month, scope, partnerId) => {
      const payload = validPayload(filters);
      mocks.rpc.mockResolvedValue({ data: payload, error: null });

      await expect(loadAdminMonthlyBusinessMetrics(filters)).resolves.toEqual(
        payload,
      );

      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(mocks.rpc).toHaveBeenCalledWith(
        ADMIN_MONTHLY_BUSINESS_METRICS_RPC,
        {
          p_month: month,
          p_scope_kind: scope,
          p_partner_id: partnerId,
        },
      );
      expect(JSON.stringify(mocks.rpc.mock.calls[0]?.[1])).not.toMatch(
        /content|metadata|message|phone|prompt|token|provider/i,
      );
    },
  );

  it("accepts reassigned business segments, exact totals, and global historical partner options", async () => {
    const payload = validPayload(ALL_FILTERS, allScopeRows());
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(loadAdminMonthlyBusinessMetrics(ALL_FILTERS)).resolves.toEqual(
      payload,
    );
  });

  it("accepts an empty month with definitions, zero totals, and global partner options", async () => {
    const payload = validPayload(PARTNER_FILTERS);
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    const result = await loadAdminMonthlyBusinessMetrics(PARTNER_FILTERS);

    expect(result.businesses).toEqual([]);
    expect(result.brand_totals).toEqual([]);
    expect(result.definitions).toHaveLength(12);
    expect(Object.values(result.totals).every((value) => value === 0)).toBe(
      true,
    );
    expect(result.partner_options.map((option) => option.partner_id)).toEqual([
      PARTNER_A,
      PARTNER_B,
    ]);
  });

  it("classifies a returned RPC error as query_failed without fabricating zeros", async () => {
    const queryError = { code: "42501", message: "permission denied" };
    mocks.rpc.mockResolvedValue({ data: null, error: queryError });

    const promise = loadAdminMonthlyBusinessMetrics(ALL_FILTERS);

    await expect(promise).rejects.toBeInstanceOf(AdminMetricsReadError);
    await expect(promise).rejects.toMatchObject({
      code: "query_failed",
      cause: queryError,
    });
  });

  it("classifies a thrown RPC failure as query_failed", async () => {
    const queryError = new Error("network unavailable");
    mocks.rpc.mockRejectedValue(queryError);

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "query_failed", cause: queryError });
  });

  it.each([null, undefined, "{}", [], 42])(
    "rejects malformed success payload %# as invalid_response",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      await expect(
        loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
      ).rejects.toMatchObject({ code: "invalid_response" });
    },
  );

  it.each([
    ["top-level content", (payload: Record<string, unknown>) => {
      payload.content = "private transcript";
    }],
    ["period metadata", (payload: Record<string, unknown>) => {
      mutableObject(payload.period).metadata = { private: true };
    }],
    ["definition prompt", (payload: Record<string, unknown>) => {
      mutableObject(mutableArray(payload.definitions)[0]).prompt = "private prompt";
    }],
    ["totals tokens", (payload: Record<string, unknown>) => {
      mutableObject(payload.totals).tokens = 99;
    }],
    ["brand provider payload", (payload: Record<string, unknown>) => {
      mutableObject(mutableArray(payload.brand_totals)[0]).provider_payload = {
        private: true,
      };
    }],
    ["business phone number", (payload: Record<string, unknown>) => {
      mutableObject(mutableArray(payload.businesses)[0]).phone_number =
        "+15551234567";
    }],
    ["partner option message", (payload: Record<string, unknown>) => {
      mutableObject(mutableArray(payload.partner_options)[0]).message = "private";
    }],
  ] as const)("rejects unexpected %s fields", async (_label, mutate) => {
    const payload = clone(
      validPayload(ALL_FILTERS, [allScopeRows()[0], allScopeRows()[1]]),
    ) as unknown as Record<string, unknown>;
    mutate(payload);
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["string", "1"],
  ])("rejects a %s count", async (_label, value) => {
    const payload = validPayload(ALL_FILTERS) as unknown as Record<
      string,
      unknown
    >;
    mutableObject(payload.totals).contact_created = value;
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects an unknown definition as invalid_response", async () => {
    const payload = validPayload(ALL_FILTERS) as unknown as Record<
      string,
      unknown
    >;
    mutableObject(mutableArray(payload.definitions)[0]).metric_key =
      "message_content_seen";
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each(["duplicate", "missing"])(
    "rejects a %s v1 definition set as inconsistent_response",
    async (kind) => {
      const payload = clone(validPayload(ALL_FILTERS));
      if (kind === "duplicate") {
        payload.definitions[1] = clone(payload.definitions[0]);
      } else {
        payload.definitions.pop();
      }
      mocks.rpc.mockResolvedValue({ data: payload, error: null });

      await expect(
        loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
      ).rejects.toMatchObject({ code: "inconsistent_response" });
    },
  );

  it("rejects v1 backfill-label drift", async () => {
    const payload = validPayload(ALL_FILTERS);
    payload.definitions[0].supports_historical_backfill = true;
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it.each([
    ["month", "2026-07"],
    ["start", "2026-08-02T00:00:00+00:00"],
    ["end_exclusive", "2026-09-02T00:00:00+00:00"],
  ] as const)("rejects a mismatched period %s", async (field, value) => {
    const payload = validPayload(ALL_FILTERS);
    payload.period[field] = value;
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it("rejects a non-UTC period timestamp instead of accepting an equivalent instant", async () => {
    const payload = validPayload(ALL_FILTERS);
    payload.period.start = "2026-07-31T20:00:00-04:00";
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects scope metadata that does not echo the request", async () => {
    const payload = validPayload(PARTNER_FILTERS);
    payload.scope.partner_id = PARTNER_B;
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(PARTNER_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it.each([
    [
      PARTNER_FILTERS,
      row({
        businessId: BUSINESS_B,
        businessName: "Lakeview Dental",
        partnerId: PARTNER_B,
      }),
    ],
    [
      DIRECT_FILTERS,
      row({
        businessId: BUSINESS_B,
        businessName: "Lakeview Dental",
        partnerId: PARTNER_A,
      }),
    ],
  ] as const)(
    "rejects a cross-scope business and brand fixture for %#",
    async (filters, leakedRow) => {
      const payload = validPayload(filters, [leakedRow]);
      mocks.rpc.mockResolvedValue({ data: payload, error: null });

      await expect(
        loadAdminMonthlyBusinessMetrics(filters),
      ).rejects.toMatchObject({ code: "inconsistent_response" });
    },
  );

  it("accepts unrelated partner options in an exact partner-scoped response", async () => {
    const payload = validPayload(PARTNER_FILTERS, [
      row({
        businessId: BUSINESS_B,
        businessName: "Lakeview Dental",
        partnerId: PARTNER_A,
        counts: counts({ contact_created: 1 }),
      }),
    ]);
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(PARTNER_FILTERS),
    ).resolves.toEqual(payload);
    expect(payload.partner_options.some((option) => option.partner_id === PARTNER_B))
      .toBe(true);
  });

  it("rejects duplicate business segments but permits one business under two event-time brands", async () => {
    const permitted = validPayload(ALL_FILTERS, allScopeRows().slice(0, 2));
    mocks.rpc.mockResolvedValueOnce({ data: permitted, error: null });
    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).resolves.toEqual(permitted);

    const duplicatedRow = allScopeRows()[0];
    const duplicate = validPayload(ALL_FILTERS, [duplicatedRow, clone(duplicatedRow)]);
    mocks.rpc.mockResolvedValueOnce({ data: duplicate, error: null });
    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it.each(["brand", "partner option"])(
    "rejects a duplicate %s",
    async (kind) => {
      const payload = validPayload(ALL_FILTERS, [allScopeRows()[0]]);
      if (kind === "brand") {
        payload.brand_totals.push(clone(payload.brand_totals[0]));
      } else {
        payload.partner_options.push(clone(payload.partner_options[0]));
      }
      mocks.rpc.mockResolvedValue({ data: payload, error: null });

      await expect(
        loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
      ).rejects.toMatchObject({ code: "inconsistent_response" });
    },
  );

  it.each(["overall", "brand", "missing brand"])(
    "rejects %s totals that disagree with business rows",
    async (kind) => {
      const payload = validPayload(ALL_FILTERS, allScopeRows());
      if (kind === "overall") {
        payload.totals.contact_created += 1;
      } else if (kind === "brand") {
        payload.brand_totals[1].counts.contact_created += 1;
      } else {
        payload.brand_totals.pop();
      }
      mocks.rpc.mockResolvedValue({ data: payload, error: null });

      await expect(
        loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
      ).rejects.toMatchObject({ code: "inconsistent_response" });
    },
  );

  it("rejects a booking origin breakdown that disagrees with its booking total", async () => {
    const payload = validPayload(ALL_FILTERS, [allScopeRows()[2]]);
    payload.businesses[0].counts.booking_confirmed = 2;
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it("rejects overflow while reconciling individually safe business counts", async () => {
    const maxCounts = counts({ missed_call_caught: Number.MAX_SAFE_INTEGER });
    const first = row({
      businessId: BUSINESS_A,
      businessName: "River City Dental",
      partnerId: null,
      counts: maxCounts,
    });
    const second = row({
      businessId: BUSINESS_B,
      businessName: "Lakeview Dental",
      partnerId: null,
      counts: maxCounts,
    });
    const payload = validPayload(ALL_FILTERS);
    payload.businesses = [first, second];
    payload.brand_totals = [
      {
        brand_kind: "direct",
        partner_id_at_event: null,
        partner_name: null,
        partner_slug: null,
        counts: counts(),
      },
    ];
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it.each([
    ["partial partner display", (payload: AdminMonthlyBusinessMetricsResponseV1) => {
      payload.partner_options[0].partner_slug = null;
    }],
    ["conflicting partner display", (payload: AdminMonthlyBusinessMetricsResponseV1) => {
      payload.partner_options[0].partner_name = "Different Agency";
    }],
    ["direct partner display", (payload: AdminMonthlyBusinessMetricsResponseV1) => {
      payload.businesses[0].partner_name = "Impossible Agency";
      payload.businesses[0].partner_slug = "impossible";
    }],
    ["conflicting business name", (payload: AdminMonthlyBusinessMetricsResponseV1) => {
      payload.businesses[1].business_name = "Different Business";
    }],
  ] as const)("rejects %s facts", async (_label, mutate) => {
    const payload = validPayload(ALL_FILTERS, allScopeRows().slice(0, 2));
    mutate(payload);
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(ALL_FILTERS),
    ).rejects.toMatchObject({ code: "inconsistent_response" });
  });

  it("accepts fully null display facts for a deleted historical partner", async () => {
    const deletedPartnerFilters: AdminMetricsFilters = {
      month: "2026-08",
      scope: "partner",
      partnerId: PARTNER_B,
    };
    const payload = validPayload(deletedPartnerFilters, [
      row({
        businessId: BUSINESS_B,
        businessName: "Lakeview Dental",
        partnerId: PARTNER_B,
        counts: counts({ hot_lead_classified: 1 }),
      }),
    ]);
    mocks.rpc.mockResolvedValue({ data: payload, error: null });

    await expect(
      loadAdminMonthlyBusinessMetrics(deletedPartnerFilters),
    ).resolves.toEqual(payload);
  });
});
