import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import {
  ADMIN_METRICS_REPORT_BUSINESS_COLUMNS,
  ADMIN_METRICS_REPORT_CONFIG_COLUMNS,
  ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE,
  ADMIN_METRICS_REPORT_CONFIG_SAVE_RPC,
  ADMIN_METRICS_REPORT_PARTNER_COLUMNS,
  AdminMetricsReportConfigError,
  AdminMetricsReportConfigsReadError,
  loadAdminMetricsReportConfigSettings,
  saveAdminMetricsReportConfig,
} from "./metricsReportConfigs.server";
import { ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT } from "./metricsReportConfigs.shared";

const DIRECT_CONFIG_ID = "10000000-0000-4000-a051-000000000001";
const PARTNER_CONFIG_ID = "10000000-0000-4000-a051-000000000002";
const PARTNER_A = "20000000-0000-4000-a051-000000000001";
const PARTNER_B = "20000000-0000-4000-a051-000000000002";
const BUSINESS_DIRECT = "30000000-0000-4000-a051-000000000001";
const BUSINESS_PARTNER = "30000000-0000-4000-a051-000000000002";
const BUSINESS_STALE = "30000000-0000-4000-a051-000000000003";

type StoredResults = Record<
  | "metrics_report_configs"
  | "partners"
  | "businesses",
  { data: unknown; error: unknown }
>;

let storedResults: StoredResults;
let selectCalls: Array<[string, string]>;
let isCalls: Array<[string, string, unknown]>;
let simulatedServerRowCap: number;
let orderCalls: Array<[string, string, { ascending: boolean }]>;
let limitCalls: Array<[string, number]>;
let gtCalls: Array<[string, string, string]>;

function resetStoredResults(): void {
  storedResults = {
    metrics_report_configs: {
      data: [
        {
          id: DIRECT_CONFIG_ID,
          scope_kind: "direct",
          partner_id: null,
          selection_mode: "selected",
          reporting_starts_on: "2026-08-01",
          enabled: false,
          metrics_report_recipients: [],
          metrics_report_selected_businesses: [
            { business_id: BUSINESS_STALE },
          ],
        },
        {
          id: PARTNER_CONFIG_ID,
          scope_kind: "partner",
          partner_id: PARTNER_A,
          selection_mode: "all",
          reporting_starts_on: "2026-09-01",
          enabled: true,
          metrics_report_recipients: [
            { email: "zed@example.com", enabled: false },
            { email: "alpha@example.com", enabled: true },
          ],
          metrics_report_selected_businesses: [],
        },
      ],
      error: null,
    },
    partners: {
      data: [
        { id: PARTNER_B, name: "Zulu Agency", slug: "zulu-agency" },
        { id: PARTNER_A, name: "Alpha Agency", slug: "alpha-agency" },
      ],
      error: null,
    },
    businesses: {
      data: [
        {
          id: BUSINESS_STALE,
          name: "Zed Dental",
          partner_id: PARTNER_B,
        },
        {
          id: BUSINESS_PARTNER,
          name: "Alpha Dental",
          partner_id: PARTNER_A,
        },
        {
          id: BUSINESS_DIRECT,
          name: "Direct Dental",
          partner_id: null,
        },
      ],
      error: null,
    },
  };
}

function installFromMock(): void {
  mocks.from.mockImplementation((table: keyof StoredResults) => {
    let afterId: string | null = null;
    let pageLimit: number | null = null;

    const builder = {
      select(columns: string) {
        selectCalls.push([table, columns]);
        return builder;
      },
      is(column: string, value: unknown) {
        isCalls.push([table, column, value]);
        return builder;
      },
      order(column: string, options: { ascending: boolean }) {
        orderCalls.push([table, column, options]);
        return builder;
      },
      limit(value: number) {
        limitCalls.push([table, value]);
        pageLimit = value;
        return builder;
      },
      gt(column: string, value: string) {
        gtCalls.push([table, column, value]);
        afterId = value;
        return builder;
      },
      then(
        onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        const stored = storedResults[table];
        let data = stored.data;
        if (Array.isArray(data)) {
          data = [...data]
            .sort((left, right) => rowId(left).localeCompare(rowId(right)))
            .filter((row) => afterId === null || rowId(row) > afterId)
            .slice(
              0,
              Math.min(pageLimit ?? Number.POSITIVE_INFINITY, simulatedServerRowCap),
            );
        }
        return Promise.resolve({ data, error: stored.error }).then(
          onFulfilled,
          onRejected,
        );
      },
    };

    return builder;
  });
}

function rowId(row: unknown): string {
  if (
    typeof row !== "object" ||
    row === null ||
    Array.isArray(row) ||
    typeof (row as Record<string, unknown>).id !== "string"
  ) {
    return "";
  }
  return (row as Record<string, string>).id;
}

function numberedUuid(family: "4" | "5" | "6", index: number): string {
  return `${family}0000000-0000-4000-a051-${String(index).padStart(12, "0")}`;
}

function directSaveRequest(overrides: Record<string, unknown> = {}) {
  return {
    scopeKind: "direct" as const,
    selectionMode: "all" as const,
    reportingStartsOn: "2026-08-01",
    enabled: false,
    recipients: [] as Array<{ email: string; enabled: boolean }>,
    selectedBusinessIds: [] as string[],
    ...overrides,
  };
}

function saveResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: DIRECT_CONFIG_ID,
    scope_kind: "direct",
    partner_id: null,
    selection_mode: "all",
    reporting_starts_on: "2026-08-01",
    enabled: false,
    recipients: [],
    selected_business_ids: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCalls = [];
  isCalls = [];
  orderCalls = [];
  limitCalls = [];
  gtCalls = [];
  simulatedServerRowCap = Number.POSITIVE_INFINITY;
  resetStoredResults();
  installFromMock();
  mocks.rpc.mockResolvedValue({ data: saveResponse(), error: null });
});

describe("loadAdminMetricsReportConfigSettings", () => {
  it("does not start a service-role read until the authenticated caller invokes it", async () => {
    expect(mocks.from).not.toHaveBeenCalled();

    await loadAdminMetricsReportConfigSettings();

    expect(mocks.from).toHaveBeenCalledTimes(6);
  });

  it("uses minimized exact columns and filters soft-deleted businesses", async () => {
    await loadAdminMetricsReportConfigSettings();

    expect(selectCalls).toHaveLength(6);
    expect(
      selectCalls.filter(
        (call) =>
          call[0] === "metrics_report_configs" &&
          call[1] === ADMIN_METRICS_REPORT_CONFIG_COLUMNS,
      ),
    ).toHaveLength(2);
    expect(
      selectCalls.filter(
        (call) =>
          call[0] === "partners" &&
          call[1] === ADMIN_METRICS_REPORT_PARTNER_COLUMNS,
      ),
    ).toHaveLength(2);
    expect(
      selectCalls.filter(
        (call) =>
          call[0] === "businesses" &&
          call[1] === ADMIN_METRICS_REPORT_BUSINESS_COLUMNS,
      ),
    ).toHaveLength(2);
    expect(isCalls).toEqual([
      ["businesses", "deleted_at", null],
      ["businesses", "deleted_at", null],
    ]);
    expect(orderCalls).toHaveLength(6);
    expect(
      orderCalls.every(
        ([, column, options]) => column === "id" && options.ascending,
      ),
    ).toBe(true);
    expect(limitCalls).toHaveLength(6);
    expect(
      limitCalls.every(
        ([, limit]) => limit === ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE,
      ),
    ).toBe(true);
  });

  it("exhaustively keyset-paginates configs, partners and businesses past one page", async () => {
    const rowCount = ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE + 1;
    storedResults.partners.data = Array.from(
      { length: rowCount },
      (_unused, index) => ({
        id: numberedUuid("4", index + 1),
        name: `Agency ${String(index + 1).padStart(4, "0")}`,
        slug: `agency-${String(index + 1).padStart(4, "0")}`,
      }),
    );
    storedResults.metrics_report_configs.data = Array.from(
      { length: rowCount },
      (_unused, index) => ({
        id: numberedUuid("5", index + 1),
        scope_kind: "partner",
        partner_id: numberedUuid("4", index + 1),
        selection_mode: "all",
        reporting_starts_on: "2026-08-01",
        enabled: false,
        metrics_report_recipients: [],
        metrics_report_selected_businesses: [],
      }),
    );
    storedResults.businesses.data = Array.from(
      { length: rowCount },
      (_unused, index) => ({
        id: numberedUuid("6", index + 1),
        name: `Business ${String(index + 1).padStart(4, "0")}`,
        partner_id: numberedUuid("4", index + 1),
      }),
    );

    const settings = await loadAdminMetricsReportConfigSettings();

    expect(settings.partners).toHaveLength(rowCount);
    expect(settings.partners.every((partner) => partner.config !== null)).toBe(
      true,
    );
    expect(
      settings.partners.every((partner) => partner.businesses.length === 1),
    ).toBe(true);
    expect(mocks.from).toHaveBeenCalledTimes(9);
    expect(limitCalls).toHaveLength(9);
    expect(
      limitCalls.every(
        ([, limit]) => limit === ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE,
      ),
    ).toBe(true);
    expect(orderCalls).toHaveLength(9);
    expect(
      orderCalls.every(
        ([, column, options]) => column === "id" && options.ascending,
      ),
    ).toBe(true);
    expect(
      [...gtCalls].sort(
        (left, right) =>
          left[0].localeCompare(right[0]) || left[2].localeCompare(right[2]),
      ),
    ).toEqual([
        [
          "metrics_report_configs",
          "id",
          numberedUuid("5", ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE),
        ],
        [
          "metrics_report_configs",
          "id",
          numberedUuid("5", rowCount),
        ],
        [
          "partners",
          "id",
          numberedUuid("4", ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE),
        ],
        ["partners", "id", numberedUuid("4", rowCount)],
        [
          "businesses",
          "id",
          numberedUuid("6", ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE),
        ],
        ["businesses", "id", numberedUuid("6", rowCount)],
    ].sort(
      (left, right) =>
        left[0].localeCompare(right[0]) || left[2].localeCompare(right[2]),
    ));
    expect(isCalls).toEqual([
      ["businesses", "deleted_at", null],
      ["businesses", "deleted_at", null],
      ["businesses", "deleted_at", null],
    ]);
  });

  it("continues keyset pagination when the server cap is below the requested page size", async () => {
    simulatedServerRowCap = 1;

    const settings = await loadAdminMetricsReportConfigSettings();

    expect(settings.direct.config?.id).toBe(DIRECT_CONFIG_ID);
    expect(settings.partners.map(({ id }) => id)).toEqual([
      PARTNER_A,
      PARTNER_B,
    ]);
    expect(settings.direct.businesses).toEqual([
      { id: BUSINESS_DIRECT, name: "Direct Dental" },
    ]);
    expect(mocks.from).toHaveBeenCalledTimes(10);
  });

  it("hydrates real configs, every partner and current scoped businesses deterministically", async () => {
    const settings = await loadAdminMetricsReportConfigSettings();

    expect(settings).toEqual({
      direct: {
        config: {
          id: DIRECT_CONFIG_ID,
          scopeKind: "direct",
          partnerId: null,
          selectionMode: "selected",
          reportingStartsOn: "2026-08-01",
          enabled: false,
          recipients: [],
          selectedBusinessIds: [BUSINESS_STALE],
        },
        businesses: [{ id: BUSINESS_DIRECT, name: "Direct Dental" }],
      },
      partners: [
        {
          id: PARTNER_A,
          name: "Alpha Agency",
          slug: "alpha-agency",
          config: {
            id: PARTNER_CONFIG_ID,
            scopeKind: "partner",
            partnerId: PARTNER_A,
            selectionMode: "all",
            reportingStartsOn: "2026-09-01",
            enabled: true,
            recipients: [
              { email: "alpha@example.com", enabled: true },
              { email: "zed@example.com", enabled: false },
            ],
            selectedBusinessIds: [],
          },
          businesses: [{ id: BUSINESS_PARTNER, name: "Alpha Dental" }],
        },
        {
          id: PARTNER_B,
          name: "Zulu Agency",
          slug: "zulu-agency",
          config: null,
          businesses: [{ id: BUSINESS_STALE, name: "Zed Dental" }],
        },
      ],
    });
  });

  it("keeps a reassigned selected business visible as a stale stored id", async () => {
    const settings = await loadAdminMetricsReportConfigSettings();

    expect(settings.direct.config?.selectedBusinessIds).toContain(
      BUSINESS_STALE,
    );
    expect(settings.direct.businesses).not.toContainEqual(
      expect.objectContaining({ id: BUSINESS_STALE }),
    );
    expect(settings.partners[1].businesses).toContainEqual({
      id: BUSINESS_STALE,
      name: "Zed Dental",
    });
  });

  it("returns null persisted configs instead of fabricating virtual defaults", async () => {
    storedResults.metrics_report_configs.data = [];

    const settings = await loadAdminMetricsReportConfigSettings();

    expect(settings.direct.config).toBeNull();
    expect(settings.partners.map(({ config }) => config)).toEqual([null, null]);
  });

  it.each([
    "metrics_report_configs",
    "partners",
    "businesses",
  ] as const)("maps a %s query error to a safe read failure", async (table) => {
    storedResults[table].error = {
      message: "raw database failure admin@example.com",
    };

    await expect(loadAdminMetricsReportConfigSettings()).rejects.toMatchObject({
      name: "AdminMetricsReportConfigsReadError",
      code: "query_failed",
      message: "query_failed",
    });
  });

  it("maps a thrown client failure without retaining the raw cause", async () => {
    mocks.from.mockImplementationOnce(() => {
      throw new Error("raw failure recipient@example.com");
    });

    const error = await loadAdminMetricsReportConfigSettings().catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(AdminMetricsReportConfigsReadError);
    expect(error).toMatchObject({ code: "query_failed" });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("recipient@example.com");
  });

  it("rejects missing, extra or malformed stored fields", async () => {
    const rows = storedResults.partners.data as Array<Record<string, unknown>>;
    rows[0] = { ...rows[0], raw_secret: "must-not-pass" };

    await expect(loadAdminMetricsReportConfigSettings()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects duplicate children returned by the nested config snapshot", async () => {
    const rows = storedResults.metrics_report_configs.data as Array<
      Record<string, unknown>
    >;
    rows[1].metrics_report_recipients = [
      { email: "alpha@example.com", enabled: true },
      { email: "alpha@example.com", enabled: false },
    ];

    await expect(loadAdminMetricsReportConfigSettings()).rejects.toMatchObject({
      code: "inconsistent_response",
    });
  });

  it.each([
    "metrics_report_recipients",
    "metrics_report_selected_businesses",
  ] as const)(
    "fails closed when nested %s reaches the PostgREST truncation boundary",
    async (childKey) => {
      const rows = storedResults.metrics_report_configs.data as Array<
        Record<string, unknown>
      >;
      rows[0][childKey] = Array.from(
        { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT + 1 },
        (_unused, index) =>
          childKey === "metrics_report_recipients"
            ? {
                email: `recipient${index + 1}@example.com`,
                enabled: false,
              }
            : { business_id: numberedUuid("6", index + 1) },
      );

      await expect(
        loadAdminMetricsReportConfigSettings(),
      ).rejects.toMatchObject({ code: "invalid_response" });
    },
  );

  it("loads config identity and both child collections in one statement", async () => {
    await loadAdminMetricsReportConfigSettings();

    const configRead = selectCalls.filter(
      ([table]) => table === "metrics_report_configs",
    );
    expect(configRead).toHaveLength(2);
    expect(
      configRead.every(
        ([, columns]) => columns === ADMIN_METRICS_REPORT_CONFIG_COLUMNS,
      ),
    ).toBe(true);
    expect(ADMIN_METRICS_REPORT_CONFIG_COLUMNS).toContain(
      "metrics_report_recipients!metrics_report_recipients_config_id_fkey(email,enabled)",
    );
    expect(ADMIN_METRICS_REPORT_CONFIG_COLUMNS).toContain(
      "metrics_report_selected_businesses!metrics_report_selected_businesses_config_id_fkey(business_id)",
    );
    expect(mocks.from).not.toHaveBeenCalledWith("metrics_report_recipients");
    expect(mocks.from).not.toHaveBeenCalledWith(
      "metrics_report_selected_businesses",
    );
  });

  it("rejects duplicate partner identities", async () => {
    const rows = storedResults.partners.data as Array<Record<string, unknown>>;
    rows.push({ ...rows[0] });

    await expect(loadAdminMetricsReportConfigSettings()).rejects.toMatchObject({
      code: "inconsistent_response",
    });
  });

  it("rejects a partner configuration whose partner row is absent", async () => {
    storedResults.partners.data = [
      { id: PARTNER_B, name: "Zulu Agency", slug: "zulu-agency" },
    ];
    storedResults.businesses.data = [];

    await expect(loadAdminMetricsReportConfigSettings()).rejects.toMatchObject({
      code: "inconsistent_response",
    });
  });
});

describe("saveAdminMetricsReportConfig", () => {
  it("normalizes a complete replacement and calls the atomic v1 RPC exactly", async () => {
    mocks.rpc.mockResolvedValue({
      data: saveResponse({
        recipients: [
          { email: "alpha@example.com", enabled: true },
          { email: "zed@example.com", enabled: false },
        ],
      }),
      error: null,
    });

    const saved = await saveAdminMetricsReportConfig(
      directSaveRequest({
        recipients: [
          { email: " ZED@example.COM ", enabled: false },
          { email: "alpha@example.com", enabled: true },
        ],
      }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      ADMIN_METRICS_REPORT_CONFIG_SAVE_RPC,
      {
        p_scope_kind: "direct",
        p_partner_id: null,
        p_selection_mode: "all",
        p_reporting_starts_on: "2026-08-01",
        p_enabled: false,
        p_recipients: [
          { email: "alpha@example.com", enabled: true },
          { email: "zed@example.com", enabled: false },
        ],
        p_selected_business_ids: [],
      },
    );
    expect(saved.recipients).toEqual([
      { email: "alpha@example.com", enabled: true },
      { email: "zed@example.com", enabled: false },
    ]);
  });

  it("passes an exact partner identity and sorted selected businesses", async () => {
    mocks.rpc.mockResolvedValue({
      data: saveResponse({
        scope_kind: "partner",
        partner_id: PARTNER_A,
        selection_mode: "selected",
        selected_business_ids: [BUSINESS_PARTNER, BUSINESS_STALE],
      }),
      error: null,
    });

    await saveAdminMetricsReportConfig({
      scopeKind: "partner",
      partnerId: PARTNER_A,
      selectionMode: "selected",
      reportingStartsOn: "2026-08-01",
      enabled: false,
      recipients: [],
      selectedBusinessIds: [BUSINESS_STALE, BUSINESS_PARTNER],
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      ADMIN_METRICS_REPORT_CONFIG_SAVE_RPC,
      expect.objectContaining({
        p_partner_id: PARTNER_A,
        p_selected_business_ids: [BUSINESS_PARTNER, BUSINESS_STALE],
      }),
    );
  });

  it("rejects an invalid replacement before importing or calling the RPC", async () => {
    await expect(
      saveAdminMetricsReportConfig(
        directSaveRequest({
          enabled: true,
          recipients: [{ email: "disabled@example.com", enabled: false }],
        }),
      ),
    ).rejects.toEqual(new AdminMetricsReportConfigError("invalid_request", 400));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["23503", "metrics_report_partner_not_found", "partner_not_found", 404],
    [
      "22023",
      "metrics_report_business_out_of_scope",
      "business_out_of_scope",
      409,
    ],
    [
      "22023",
      "enabled_metrics_report_requires_recipient",
      "enabled_recipient_required",
      422,
    ],
    [
      "22023",
      "invalid_metrics_report_selection_shape",
      "invalid_selection",
      422,
    ],
    [
      "22023",
      "duplicate_metrics_report_selected_business",
      "invalid_selection",
      422,
    ],
    ["22023", "invalid_metrics_report_recipient", "invalid_request", 400],
    ["P0001", "unrecognized_internal_failure", "save_failed", 500],
  ])(
    "maps SQLSTATE %s sentinel %s to stable code %s without raw logs",
    async (sqlState, databaseCode, expectedCode, status) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          code: sqlState,
          message: databaseCode,
          details: "recipient@example.com raw detail",
        },
      });

      await expect(
        saveAdminMetricsReportConfig(directSaveRequest()),
      ).rejects.toMatchObject({ code: expectedCode, status });
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it("does not trust a known sentinel under the wrong SQLSTATE", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "metrics_report_business_out_of_scope",
      },
    });

    await expect(
      saveAdminMetricsReportConfig(directSaveRequest()),
    ).rejects.toMatchObject({ code: "save_failed", status: 500 });
  });

  it("maps a thrown provider client failure to a cause-free safe error", async () => {
    mocks.rpc.mockRejectedValue(new Error("raw recipient@example.com"));

    const error = await saveAdminMetricsReportConfig(
      directSaveRequest(),
    ).catch((cause: unknown) => cause);
    expect(error).toEqual(new AdminMetricsReportConfigError("save_failed", 500));
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("recipient@example.com");
  });

  it("rejects a malformed or request-mismatched RPC response", async () => {
    mocks.rpc.mockResolvedValue({
      data: saveResponse({ enabled: true }),
      error: null,
    });

    await expect(
      saveAdminMetricsReportConfig(directSaveRequest()),
    ).rejects.toMatchObject({ code: "save_failed", status: 500 });
  });
});
