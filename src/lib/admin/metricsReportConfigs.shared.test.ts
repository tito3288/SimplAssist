import { describe, expect, it } from "vitest";
import {
  ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT,
  adminMetricsReportConfigSaveRequestSchema,
  adminMetricsReportConfigSchema,
  adminMetricsReportConfigSettingsSchema,
} from "./metricsReportConfigs.shared";

const CONFIG_ID = "10000000-0000-4000-a051-000000000001";
const PARTNER_ID = "20000000-0000-4000-a051-000000000001";
const BUSINESS_A = "30000000-0000-4000-a051-000000000001";
const BUSINESS_B = "30000000-0000-4000-a051-000000000002";

function numberedBusinessId(index: number): string {
  return `70000000-0000-4000-a051-${String(index).padStart(12, "0")}`;
}

function numberedRecipient(index: number) {
  return { email: `recipient${index}@example.com`, enabled: false };
}

function directRequest(overrides: Record<string, unknown> = {}) {
  return {
    scopeKind: "direct",
    selectionMode: "all",
    reportingStartsOn: "2026-08-01",
    enabled: false,
    recipients: [],
    selectedBusinessIds: [],
    ...overrides,
  };
}

function savedConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG_ID,
    scopeKind: "direct",
    partnerId: null,
    selectionMode: "all",
    reportingStartsOn: "2026-08-01",
    enabled: false,
    recipients: [],
    selectedBusinessIds: [],
    ...overrides,
  };
}

describe("adminMetricsReportConfigSaveRequestSchema", () => {
  it("normalizes canonical recipient email and deterministic child ordering", () => {
    const parsed = adminMetricsReportConfigSaveRequestSchema.parse(
      directRequest({
        recipients: [
          { email: " Zed@Example.COM ", enabled: false },
          { email: "alpha@example.com", enabled: true },
        ],
      }),
    );

    expect(parsed).toEqual({
      scopeKind: "direct",
      selectionMode: "all",
      reportingStartsOn: "2026-08-01",
      enabled: false,
      recipients: [
        { email: "alpha@example.com", enabled: true },
        { email: "zed@example.com", enabled: false },
      ],
      selectedBusinessIds: [],
    });
  });

  it("accepts a partner selected-mode replacement and canonicalizes UUIDs", () => {
    const parsed = adminMetricsReportConfigSaveRequestSchema.parse({
      scopeKind: "partner",
      partnerId: PARTNER_ID.toUpperCase(),
      selectionMode: "selected",
      reportingStartsOn: "2026-12-01",
      enabled: true,
      recipients: [{ email: "reports@example.com", enabled: true }],
      selectedBusinessIds: [
        BUSINESS_B.toUpperCase(),
        BUSINESS_A.toUpperCase(),
      ],
    });

    expect(parsed).toMatchObject({
      scopeKind: "partner",
      partnerId: PARTNER_ID,
    });
    expect(parsed.selectedBusinessIds).toEqual([BUSINESS_A, BUSINESS_B]);
  });

  it.each([
    ["unknown field", directRequest({ unexpected: true })],
    ["partner identity on direct", directRequest({ partnerId: PARTNER_ID })],
    [
      "missing partner identity",
      {
        ...directRequest(),
        scopeKind: "partner",
      },
    ],
    ["non-month date", directRequest({ reportingStartsOn: "2026-08-02" })],
    ["invalid calendar month", directRequest({ reportingStartsOn: "2026-13-01" })],
    [
      "invalid email",
      directRequest({
        recipients: [{ email: "admin@example", enabled: false }],
      }),
    ],
    [
      "all mode with selection",
      directRequest({ selectedBusinessIds: [BUSINESS_A] }),
    ],
    [
      "selected mode without selection",
      directRequest({ selectionMode: "selected" }),
    ],
    [
      "enabled without enabled recipient",
      directRequest({
        enabled: true,
        recipients: [{ email: "admin@example.com", enabled: false }],
      }),
    ],
  ])("rejects %s", (_label, input) => {
    expect(adminMetricsReportConfigSaveRequestSchema.safeParse(input).success).toBe(
      false,
    );
  });

  it("rejects recipient duplicates after normalization", () => {
    const parsed = adminMetricsReportConfigSaveRequestSchema.safeParse(
      directRequest({
        recipients: [
          { email: "ADMIN@example.com", enabled: true },
          { email: " admin@example.com ", enabled: false },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects selected-business duplicates after UUID normalization", () => {
    const parsed = adminMetricsReportConfigSaveRequestSchema.safeParse(
      directRequest({
        selectionMode: "selected",
        selectedBusinessIds: [BUSINESS_A, BUSINESS_A.toUpperCase()],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts the explicit child boundary but rejects a potentially truncated recipient set", () => {
    const atLimit = Array.from(
      { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT },
      (_unused, index) => numberedRecipient(index + 1),
    );
    const overLimit = [
      ...atLimit,
      numberedRecipient(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT + 1),
    ];

    expect(
      adminMetricsReportConfigSaveRequestSchema.safeParse(
        directRequest({ recipients: atLimit }),
      ).success,
    ).toBe(true);
    expect(
      adminMetricsReportConfigSaveRequestSchema.safeParse(
        directRequest({ recipients: overLimit }),
      ).success,
    ).toBe(false);
  });

  it("rejects a selected-business replacement above the child cap", () => {
    const selectedBusinessIds = Array.from(
      { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT + 1 },
      (_unused, index) => numberedBusinessId(index + 1),
    );
    expect(
      adminMetricsReportConfigSaveRequestSchema.safeParse(
        directRequest({ selectionMode: "selected", selectedBusinessIds }),
      ).success,
    ).toBe(false);
  });
});

describe("adminMetricsReportConfigSchema", () => {
  it("returns normalized deterministic child arrays", () => {
    const parsed = adminMetricsReportConfigSchema.parse(
      savedConfig({
        scopeKind: "partner",
        partnerId: PARTNER_ID,
        selectionMode: "selected",
        recipients: [
          { email: "zed@example.com", enabled: false },
          { email: "alpha@example.com", enabled: true },
        ],
        selectedBusinessIds: [BUSINESS_B, BUSINESS_A],
      }),
    );

    expect(parsed.recipients.map(({ email }) => email)).toEqual([
      "alpha@example.com",
      "zed@example.com",
    ]);
    expect(parsed.selectedBusinessIds).toEqual([BUSINESS_A, BUSINESS_B]);
  });

  it.each([
    ["extra field", savedConfig({ unexpected: true })],
    ["noncanonical UUID", savedConfig({ id: CONFIG_ID.toUpperCase() })],
    ["direct partner identity", savedConfig({ partnerId: PARTNER_ID })],
    [
      "partner without identity",
      savedConfig({ scopeKind: "partner", partnerId: null }),
    ],
    [
      "noncanonical email",
      savedConfig({
        recipients: [{ email: "Admin@example.com", enabled: true }],
      }),
    ],
    [
      "duplicate recipient",
      savedConfig({
        recipients: [
          { email: "admin@example.com", enabled: true },
          { email: "admin@example.com", enabled: false },
        ],
      }),
    ],
    [
      "selected shape mismatch",
      savedConfig({ selectionMode: "selected" }),
    ],
  ])("rejects %s", (_label, input) => {
    expect(adminMetricsReportConfigSchema.safeParse(input).success).toBe(false);
  });

  it("rejects stored recipient and selection collections at the truncation boundary", () => {
    const recipients = Array.from(
      { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT + 1 },
      (_unused, index) => numberedRecipient(index + 1),
    );
    const selectedBusinessIds = Array.from(
      { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT + 1 },
      (_unused, index) => numberedBusinessId(index + 1),
    );

    expect(
      adminMetricsReportConfigSchema.safeParse(savedConfig({ recipients }))
        .success,
    ).toBe(false);
    expect(
      adminMetricsReportConfigSchema.safeParse(
        savedConfig({ selectionMode: "selected", selectedBusinessIds }),
      ).success,
    ).toBe(false);
  });
});

describe("adminMetricsReportConfigSettingsSchema", () => {
  it("allows a stale stored selection that is absent from current businesses", () => {
    const parsed = adminMetricsReportConfigSettingsSchema.parse({
      direct: {
        config: savedConfig({
          selectionMode: "selected",
          selectedBusinessIds: [BUSINESS_A],
        }),
        businesses: [],
      },
      partners: [],
    });
    expect(parsed.direct.config?.selectedBusinessIds).toEqual([BUSINESS_A]);
  });

  it("rejects a partner card whose configuration belongs to another scope", () => {
    const parsed = adminMetricsReportConfigSettingsSchema.safeParse({
      direct: { config: null, businesses: [] },
      partners: [
        {
          id: PARTNER_ID,
          name: "Agency Alpha",
          slug: "agency-alpha",
          config: savedConfig(),
          businesses: [],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a business duplicated across direct and partner scopes", () => {
    const business = { id: BUSINESS_A, name: "River City Dental" };
    const parsed = adminMetricsReportConfigSettingsSchema.safeParse({
      direct: { config: null, businesses: [business] },
      partners: [
        {
          id: PARTNER_ID,
          name: "Agency Alpha",
          slug: "agency-alpha",
          config: null,
          businesses: [business],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
