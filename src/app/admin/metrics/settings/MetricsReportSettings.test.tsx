import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminMetricsReportConfig,
  AdminMetricsReportConfigSettings,
} from "@/lib/admin/metricsReportConfigs.shared";
import { ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT } from "@/lib/admin/metricsReportConfigs.shared";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import {
  buildMetricsReportConfigSaveRequest,
  createMetricsReportConfigEditors,
  currentUtcMonthStart,
  MetricsReportSettings,
  metricsReportEditorSaveLock,
  metricsReportConfigValidationError,
  reduceMetricsReportConfigEditor,
  requestMetricsReportConfigSave,
  staleSelectedBusinessIds,
} from "./MetricsReportSettings";

const CONFIG_ID = "10000000-0000-4000-a000-000000000051";
const PARTNER_CONFIG_ID = "10000000-0000-4000-a000-000000000052";
const PARTNER_ID = "20000000-0000-4000-a000-000000000051";
const DIRECT_BUSINESS_ID = "30000000-0000-4000-a000-000000000051";
const PARTNER_BUSINESS_ID = "30000000-0000-4000-a000-000000000052";
const STALE_BUSINESS_ID = "30000000-0000-4000-a000-000000000053";

function config(
  overrides: Partial<AdminMetricsReportConfig> = {},
): AdminMetricsReportConfig {
  return {
    id: CONFIG_ID,
    scopeKind: "direct",
    partnerId: null,
    selectionMode: "all",
    reportingStartsOn: "2026-06-01",
    enabled: false,
    recipients: [],
    selectedBusinessIds: [],
    ...overrides,
  };
}

function settings(
  overrides: Partial<AdminMetricsReportConfigSettings> = {},
): AdminMetricsReportConfigSettings {
  return {
    direct: {
      config: null,
      businesses: [
        { id: DIRECT_BUSINESS_ID, name: "River City Dental" },
      ],
    },
    partners: [
      {
        id: PARTNER_ID,
        name: "Alpha Dog Agency",
        slug: "alpha-dog",
        config: null,
        businesses: [
          { id: PARTNER_BUSINESS_ID, name: "North Star Dental" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("MetricsReportSettings", () => {
  it("renders direct and partner scopes uniformly with safe virtual defaults", () => {
    const html = renderToStaticMarkup(
      <MetricsReportSettings
        settings={settings()}
        defaultReportingStartsOn="2026-08-01"
      />,
    );

    expect(html).toContain("SimplAssist");
    expect(html).toContain("Alpha Dog Agency");
    expect(html.match(/Unsaved · disabled/g)).toHaveLength(2);
    expect(html.match(/All businesses in this brand/g)).toHaveLength(2);
    expect(html.match(/No recipients configured/g)).toHaveLength(2);
    expect(html.match(/value="2026-08"/g)).toHaveLength(2);
    expect(html.match(/Create report settings/g)).toHaveLength(2);
    expect(html).toContain("New configurations start disabled");
    expect(html).toContain("effective at snapshot generation");
    expect(html).toContain("frozen report history is never rewritten");
  });

  it("hydrates saved values and current scoped business choices", () => {
    const savedDirect = config({
      enabled: true,
      selectionMode: "selected",
      recipients: [{ email: "bryan@example.com", enabled: true }],
      selectedBusinessIds: [DIRECT_BUSINESS_ID],
    });
    const html = renderToStaticMarkup(
      <MetricsReportSettings
        settings={settings({
          direct: {
            config: savedDirect,
            businesses: [
              { id: DIRECT_BUSINESS_ID, name: "River City Dental" },
            ],
          },
        })}
      />,
    );

    expect(html).toContain("bryan@example.com");
    expect(html).toContain("River City Dental");
    expect(html).toContain(DIRECT_BUSINESS_ID);
    expect(html).toContain('value="2026-06"');
    expect(html).toContain("Save report settings");
    expect(html).toContain("Snapshot rows use event-time brand attribution");
    expect(html).toContain("Current assignment is checked only when this configuration is saved");
  });

  it("surfaces stale stored selections and prevents saving until removal", () => {
    const stalePartner = config({
      id: PARTNER_CONFIG_ID,
      scopeKind: "partner",
      partnerId: PARTNER_ID,
      selectionMode: "selected",
      selectedBusinessIds: [PARTNER_BUSINESS_ID, STALE_BUSINESS_ID],
    });
    const input = settings();
    input.partners[0]!.config = stalePartner;

    const [directEditor, partnerEditor] = createMetricsReportConfigEditors(
      input,
      "2026-08-01",
    );
    expect(directEditor).toBeDefined();
    expect(staleSelectedBusinessIds(partnerEditor!)).toEqual([
      STALE_BUSINESS_ID,
    ]);
    expect(metricsReportConfigValidationError(partnerEditor!)).toContain(
      "no longer belong",
    );

    const html = renderToStaticMarkup(
      <MetricsReportSettings
        settings={input}
        defaultReportingStartsOn="2026-08-01"
      />,
    );
    expect(html).toContain("saved selections no longer belong to this brand");
    expect(html).toContain(STALE_BUSINESS_ID);
    expect(html).toContain("Remove stale selection");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Save report settings<\/button>/,
    );
  });

  it("applies recipient, selection, month, and enable edits without mutating the input", () => {
    const original = createMetricsReportConfigEditors(
      settings(),
      "2026-08-01",
    )[0]!;
    let edited = reduceMetricsReportConfigEditor(original, {
      type: "add_recipient",
    });
    edited = reduceMetricsReportConfigEditor(edited, {
      type: "recipient_email",
      index: 0,
      email: "Bryan@Example.COM",
    });
    edited = reduceMetricsReportConfigEditor(edited, {
      type: "recipient_enabled",
      index: 0,
      enabled: true,
    });
    edited = reduceMetricsReportConfigEditor(edited, {
      type: "selection_mode",
      mode: "selected",
    });
    edited = reduceMetricsReportConfigEditor(edited, {
      type: "business_selected",
      businessId: DIRECT_BUSINESS_ID,
      selected: true,
    });
    edited = reduceMetricsReportConfigEditor(edited, {
      type: "reporting_starts_on",
      reportingStartsOn: "2026-09-01",
    });
    edited = reduceMetricsReportConfigEditor(edited, {
      type: "enabled",
      enabled: true,
    });

    expect(original).toMatchObject({
      enabled: false,
      selectionMode: "all",
      reportingStartsOn: "2026-08-01",
      recipients: [],
      selectedBusinessIds: [],
    });
    expect(edited).toMatchObject({
      enabled: true,
      selectionMode: "selected",
      reportingStartsOn: "2026-09-01",
      recipients: [{ email: "Bryan@Example.COM", enabled: true }],
      selectedBusinessIds: [DIRECT_BUSINESS_ID],
    });
    expect(metricsReportConfigValidationError(edited)).toBeNull();

    edited = reduceMetricsReportConfigEditor(edited, {
      type: "remove_recipient",
      index: 0,
    });
    expect(edited.recipients).toEqual([]);
    expect(metricsReportConfigValidationError(edited)).toContain(
      "Enable at least one recipient",
    );
  });

  it("clears current and stale selections when switching back to all", () => {
    const original = createMetricsReportConfigEditors(
      settings({
        direct: {
          config: config({
            selectionMode: "selected",
            selectedBusinessIds: [DIRECT_BUSINESS_ID, STALE_BUSINESS_ID],
          }),
          businesses: [
            { id: DIRECT_BUSINESS_ID, name: "River City Dental" },
          ],
        },
      }),
      "2026-08-01",
    )[0]!;

    const edited = reduceMetricsReportConfigEditor(original, {
      type: "selection_mode",
      mode: "all",
    });
    expect(edited.selectedBusinessIds).toEqual([]);
    expect(metricsReportConfigValidationError(edited)).toBeNull();
  });

  it("builds the complete normalized direct replacement without partnerId", () => {
    let editor = createMetricsReportConfigEditors(
      settings(),
      "2026-08-01",
    )[0]!;
    editor = {
      ...editor,
      recipients: [{ email: "  Bryan@Example.COM ", enabled: true }],
      enabled: true,
    };

    expect(buildMetricsReportConfigSaveRequest(editor)).toEqual({
      scopeKind: "direct",
      selectionMode: "all",
      reportingStartsOn: "2026-08-01",
      enabled: true,
      recipients: [{ email: "bryan@example.com", enabled: true }],
      selectedBusinessIds: [],
    });
  });

  it("disables every editor while one configuration is saving", () => {
    expect(metricsReportEditorSaveLock("direct", "direct")).toEqual({
      interactionsDisabled: true,
      isSaving: true,
    });
    expect(
      metricsReportEditorSaveLock("direct", `partner:${PARTNER_ID}`),
    ).toEqual({
      interactionsDisabled: true,
      isSaving: false,
    });
    expect(metricsReportEditorSaveLock(null, "direct")).toEqual({
      interactionsDisabled: false,
      isSaving: false,
    });
  });

  it("surfaces and enforces the bounded recipient and selection limits", () => {
    const editor = createMetricsReportConfigEditors(
      settings(),
      "2026-08-01",
    )[0]!;
    const recipientsAtLimit = {
      ...editor,
      recipients: Array.from(
        { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT },
        (_value, index) => ({
          email: `admin-${index}@example.com`,
          enabled: true,
        }),
      ),
    };
    expect(
      reduceMetricsReportConfigEditor(recipientsAtLimit, {
        type: "add_recipient",
      }),
    ).toBe(recipientsAtLimit);

    const tooManyRecipients = {
      ...recipientsAtLimit,
      recipients: [
        ...recipientsAtLimit.recipients,
        { email: "overflow@example.com", enabled: true },
      ],
    };
    expect(metricsReportConfigValidationError(tooManyRecipients)).toBe(
      `Use no more than ${ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT} recipients.`,
    );

    const selectionsAtLimit = {
      ...editor,
      selectionMode: "selected" as const,
      selectedBusinessIds: Array.from(
        { length: ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT },
        (_value, index) =>
          `30000000-0000-4000-a${String(index).padStart(3, "0")}-000000000051`,
      ),
    };
    expect(
      reduceMetricsReportConfigEditor(selectionsAtLimit, {
        type: "business_selected",
        businessId: "30000000-0000-4000-afff-000000000051",
        selected: true,
      }),
    ).toBe(selectionsAtLimit);

    expect(
      metricsReportConfigValidationError({
        ...selectionsAtLimit,
        selectedBusinessIds: [
          ...selectionsAtLimit.selectedBusinessIds,
          "30000000-0000-4000-afff-000000000051",
        ],
      }),
    ).toBe(
      `Select no more than ${ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT} businesses.`,
    );
  });
});

describe("requestMetricsReportConfigSave", () => {
  it("posts one complete replacement and strictly parses the safe DTO", async () => {
    const request = {
      scopeKind: "partner" as const,
      partnerId: PARTNER_ID,
      selectionMode: "selected" as const,
      reportingStartsOn: "2026-08-01",
      enabled: true,
      recipients: [{ email: "kyle@example.com", enabled: true }],
      selectedBusinessIds: [PARTNER_BUSINESS_ID],
    };
    const saved = config({
      id: PARTNER_CONFIG_ID,
      scopeKind: "partner",
      partnerId: PARTNER_ID,
      selectionMode: "selected",
      reportingStartsOn: "2026-08-01",
      enabled: true,
      recipients: request.recipients,
      selectedBusinessIds: request.selectedBusinessIds,
    });
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => saved,
    })) as unknown as typeof fetch;

    await expect(
      requestMetricsReportConfigSave(request, fetcher),
    ).resolves.toEqual(saved);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/metrics/report-configs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
  });

  it("maps stable errors and rejects malformed success payloads", async () => {
    const request = {
      scopeKind: "direct" as const,
      selectionMode: "all" as const,
      reportingStartsOn: "2026-08-01",
      enabled: false,
      recipients: [],
      selectedBusinessIds: [],
    };
    const rejected = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "enabled_recipient_required" }),
    })) as unknown as typeof fetch;
    const malformed = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...config(), recipients: [], extra: true }),
    })) as unknown as typeof fetch;

    await expect(
      requestMetricsReportConfigSave(request, rejected),
    ).rejects.toThrow("Enable at least one recipient");
    await expect(
      requestMetricsReportConfigSave(request, malformed),
    ).rejects.toThrow("invalid report configuration");
  });
});

describe("currentUtcMonthStart", () => {
  it("uses UTC at a local/year boundary", () => {
    expect(currentUtcMonthStart(new Date("2027-01-01T00:30:00+14:00"))).toBe(
      "2026-12-01",
    );
  });
});
