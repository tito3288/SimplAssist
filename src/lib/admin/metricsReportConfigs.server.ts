import "server-only";

import { z } from "zod";
import {
  ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT,
  adminMetricsReportConfigSaveRequestSchema,
  adminMetricsReportConfigSchema,
  adminMetricsReportConfigSettingsSchema,
  type AdminMetricsReportConfig,
  type AdminMetricsReportConfigSaveRequest,
  type AdminMetricsReportConfigSettings,
} from "./metricsReportConfigs.shared";

export const ADMIN_METRICS_REPORT_CONFIG_COLUMNS =
  "id,scope_kind,partner_id,selection_mode,reporting_starts_on,enabled,metrics_report_recipients!metrics_report_recipients_config_id_fkey(email,enabled),metrics_report_selected_businesses!metrics_report_selected_businesses_config_id_fkey(business_id)";
export const ADMIN_METRICS_REPORT_PARTNER_COLUMNS = "id,name,slug";
export const ADMIN_METRICS_REPORT_BUSINESS_COLUMNS = "id,name,partner_id";
// This is a requested page size, not a completion signal: loadAllRowsById
// continues until the server returns an empty page, so a lower API row cap
// cannot silently truncate top-level configs, partners, or businesses.
export const ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE = 500;
export const ADMIN_METRICS_REPORT_CONFIG_SAVE_RPC =
  "save_metrics_report_config_v1";

const canonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());

const storedConfigSchema = z
  .object({
    id: canonicalUuidSchema,
    scope_kind: z.enum(["direct", "partner"]),
    partner_id: canonicalUuidSchema.nullable(),
    selection_mode: z.enum(["all", "selected"]),
    reporting_starts_on: z.string(),
    enabled: z.boolean(),
    metrics_report_recipients: z
      .array(
        z
          .object({
            email: z.string(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT),
    metrics_report_selected_businesses: z
      .array(z.object({ business_id: canonicalUuidSchema }).strict())
      .max(ADMIN_METRICS_REPORT_CONFIG_CHILD_LIMIT),
  })
  .strict();
const storedPartnerSchema = z
  .object({
    id: canonicalUuidSchema,
    name: z.string(),
    slug: z.string(),
  })
  .strict();
const storedBusinessSchema = z
  .object({
    id: canonicalUuidSchema,
    name: z.string(),
    partner_id: canonicalUuidSchema.nullable(),
  })
  .strict();
const saveRpcResponseSchema = z
  .object({
    id: canonicalUuidSchema,
    scope_kind: z.enum(["direct", "partner"]),
    partner_id: canonicalUuidSchema.nullable(),
    selection_mode: z.enum(["all", "selected"]),
    reporting_starts_on: z.string(),
    enabled: z.boolean(),
    recipients: z.array(
      z
        .object({
          email: z.string(),
          enabled: z.boolean(),
        })
        .strict(),
    ),
    selected_business_ids: z.array(canonicalUuidSchema),
  })
  .strict();

interface QueryResult {
  data: unknown;
  error: unknown;
}

export type AdminMetricsReportConfigsReadErrorCode =
  | "query_failed"
  | "invalid_response"
  | "inconsistent_response";

export class AdminMetricsReportConfigsReadError extends Error {
  constructor(readonly code: AdminMetricsReportConfigsReadErrorCode) {
    super(code);
    this.name = "AdminMetricsReportConfigsReadError";
  }
}

export type AdminMetricsReportConfigErrorCode =
  | "invalid_request"
  | "partner_not_found"
  | "business_out_of_scope"
  | "invalid_selection"
  | "enabled_recipient_required"
  | "save_failed";

export class AdminMetricsReportConfigError extends Error {
  constructor(
    readonly code: AdminMetricsReportConfigErrorCode,
    readonly status: 400 | 404 | 409 | 422 | 500,
  ) {
    super(code);
    this.name = "AdminMetricsReportConfigError";
  }
}

/**
 * Loads report settings through service-role-only tables. The settings page
 * must complete requireAdminUser() before invoking this lazily imported read.
 */
export async function loadAdminMetricsReportConfigSettings(): Promise<AdminMetricsReportConfigSettings> {
  let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
  try {
    ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  } catch {
    throw new AdminMetricsReportConfigsReadError("query_failed");
  }

  const [configs, partners, businesses] = await Promise.all([
    loadAllRowsById(storedConfigSchema, async (afterId) => {
      let query = supabaseAdmin
        .from("metrics_report_configs")
        .select(ADMIN_METRICS_REPORT_CONFIG_COLUMNS)
        .order("id", { ascending: true })
        .limit(ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE);
      if (afterId !== null) query = query.gt("id", afterId);
      return await query;
    }),
    loadAllRowsById(storedPartnerSchema, async (afterId) => {
      let query = supabaseAdmin
        .from("partners")
        .select(ADMIN_METRICS_REPORT_PARTNER_COLUMNS)
        .order("id", { ascending: true })
        .limit(ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE);
      if (afterId !== null) query = query.gt("id", afterId);
      return await query;
    }),
    loadAllRowsById(storedBusinessSchema, async (afterId) => {
      let query = supabaseAdmin
        .from("businesses")
        .select(ADMIN_METRICS_REPORT_BUSINESS_COLUMNS)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .limit(ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE);
      if (afterId !== null) query = query.gt("id", afterId);
      return await query;
    }),
  ]);

  uniqueMap(configs, (config) => config.id);
  const partnerRowsById = uniqueMap(partners, (partner) => partner.id);
  uniqueMap(businesses, (business) => business.id);

  let directConfig: AdminMetricsReportConfig | null = null;
  const configByPartnerId = new Map<string, AdminMetricsReportConfig>();
  for (const configRow of configs) {
    const recipientEmails = configRow.metrics_report_recipients.map(
      (recipient) => recipient.email,
    );
    const selectedBusinessIds =
      configRow.metrics_report_selected_businesses.map(
        (selection) => selection.business_id,
      );
    if (
      new Set(recipientEmails).size !== recipientEmails.length ||
      new Set(selectedBusinessIds).size !== selectedBusinessIds.length
    ) {
      inconsistent();
    }

    const config = parseConfig({
      id: configRow.id,
      scopeKind: configRow.scope_kind,
      partnerId: configRow.partner_id,
      selectionMode: configRow.selection_mode,
      reportingStartsOn: configRow.reporting_starts_on,
      enabled: configRow.enabled,
      recipients: configRow.metrics_report_recipients,
      selectedBusinessIds,
    });

    if (config.scopeKind === "direct") {
      if (directConfig !== null) inconsistent();
      directConfig = config;
      continue;
    }

    const partnerId = config.partnerId;
    if (
      partnerId === null ||
      !partnerRowsById.has(partnerId) ||
      configByPartnerId.has(partnerId)
    ) {
      inconsistent();
    }
    configByPartnerId.set(partnerId, config);
  }

  const directBusinesses: Array<{ id: string; name: string }> = [];
  const businessesByPartnerId = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const business of businesses) {
    const safeBusiness = { id: business.id, name: business.name.trim() };
    if (safeBusiness.name.length === 0) invalid();

    if (business.partner_id === null) {
      directBusinesses.push(safeBusiness);
      continue;
    }
    if (!partnerRowsById.has(business.partner_id)) inconsistent();
    const partnerBusinesses =
      businessesByPartnerId.get(business.partner_id) ?? [];
    partnerBusinesses.push(safeBusiness);
    businessesByPartnerId.set(business.partner_id, partnerBusinesses);
  }

  const settings = adminMetricsReportConfigSettingsSchema.safeParse({
    direct: {
      config: directConfig,
      businesses: sortBusinesses(directBusinesses),
    },
    partners: partners
      .map((partner) => ({
        id: partner.id,
        name: partner.name.trim(),
        slug: partner.slug,
        config: configByPartnerId.get(partner.id) ?? null,
        businesses: sortBusinesses(
          businessesByPartnerId.get(partner.id) ?? [],
        ),
      }))
      .sort(compareNamedRows),
  });
  if (!settings.success) invalid();
  return settings.data;
}

/** Saves one complete direct or partner configuration through the atomic RPC. */
export async function saveAdminMetricsReportConfig(
  input: AdminMetricsReportConfigSaveRequest,
): Promise<AdminMetricsReportConfig> {
  const request = adminMetricsReportConfigSaveRequestSchema.safeParse(input);
  if (!request.success) {
    throw new AdminMetricsReportConfigError("invalid_request", 400);
  }

  let result: QueryResult;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    result = await supabaseAdmin.rpc(ADMIN_METRICS_REPORT_CONFIG_SAVE_RPC, {
      p_scope_kind: request.data.scopeKind,
      p_partner_id:
        request.data.scopeKind === "partner" ? request.data.partnerId : null,
      p_selection_mode: request.data.selectionMode,
      p_reporting_starts_on: request.data.reportingStartsOn,
      p_enabled: request.data.enabled,
      p_recipients: request.data.recipients,
      p_selected_business_ids: request.data.selectedBusinessIds,
    });
  } catch {
    throw new AdminMetricsReportConfigError("save_failed", 500);
  }

  if (result.error) throw mapSaveError(result.error);

  const saved = saveRpcResponseSchema.safeParse(result.data);
  if (!saved.success) {
    throw new AdminMetricsReportConfigError("save_failed", 500);
  }

  const config = adminMetricsReportConfigSchema.safeParse({
    id: saved.data.id,
    scopeKind: saved.data.scope_kind,
    partnerId: saved.data.partner_id,
    selectionMode: saved.data.selection_mode,
    reportingStartsOn: saved.data.reporting_starts_on,
    enabled: saved.data.enabled,
    recipients: saved.data.recipients,
    selectedBusinessIds: saved.data.selected_business_ids,
  });
  if (!config.success || !configMatchesRequest(config.data, request.data)) {
    throw new AdminMetricsReportConfigError("save_failed", 500);
  }
  return config.data;
}

function parseRows<T>(schema: z.ZodType<T>, data: unknown): T[] {
  const parsed = z.array(schema).safeParse(data);
  if (!parsed.success) invalid();
  return parsed.data;
}

async function loadAllRowsById<T extends { id: string }>(
  schema: z.ZodType<T>,
  loadPage: (afterId: string | null) => Promise<QueryResult>,
): Promise<T[]> {
  const rows: T[] = [];
  let afterId: string | null = null;

  for (;;) {
    let result: QueryResult;
    try {
      result = await loadPage(afterId);
    } catch {
      throw new AdminMetricsReportConfigsReadError("query_failed");
    }
    if (result.error) {
      throw new AdminMetricsReportConfigsReadError("query_failed");
    }

    const page = parseRows(schema, result.data);
    if (page.length > ADMIN_METRICS_REPORT_CONFIG_PAGE_SIZE) invalid();

    for (const row of page) {
      if (afterId !== null && row.id <= afterId) inconsistent();
      rows.push(row);
      afterId = row.id;
    }

    if (page.length === 0) return rows;
  }
}

function uniqueMap<T>(rows: T[], keyFor: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = keyFor(row);
    if (result.has(key)) inconsistent();
    result.set(key, row);
  }
  return result;
}

function parseConfig(value: unknown): AdminMetricsReportConfig {
  const parsed = adminMetricsReportConfigSchema.safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data;
}

function sortBusinesses<T extends { id: string; name: string }>(rows: T[]): T[] {
  return [...rows].sort(compareNamedRows);
}

function compareNamedRows(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  return (
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
    left.name.localeCompare(right.name, "en") ||
    left.id.localeCompare(right.id)
  );
}

function configMatchesRequest(
  config: AdminMetricsReportConfig,
  request: AdminMetricsReportConfigSaveRequest,
): boolean {
  const requestPartnerId =
    request.scopeKind === "partner" ? request.partnerId : null;
  return (
    config.scopeKind === request.scopeKind &&
    config.partnerId === requestPartnerId &&
    config.selectionMode === request.selectionMode &&
    config.reportingStartsOn === request.reportingStartsOn &&
    config.enabled === request.enabled &&
    JSON.stringify(config.recipients) === JSON.stringify(request.recipients) &&
    JSON.stringify(config.selectedBusinessIds) ===
      JSON.stringify(request.selectedBusinessIds)
  );
}

function mapSaveError(error: unknown): AdminMetricsReportConfigError {
  const sqlState =
    isRecord(error) && typeof error.code === "string" ? error.code : "";
  const text = isRecord(error)
    ? [error.message, error.details, error.hint]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    : "";

  if (
    sqlState === "23503" &&
    /\bmetrics_report_partner_not_found\b/.test(text)
  ) {
    return new AdminMetricsReportConfigError("partner_not_found", 404);
  }
  if (
    sqlState === "22023" &&
    /\bmetrics_report_business_out_of_scope\b/.test(text)
  ) {
    return new AdminMetricsReportConfigError("business_out_of_scope", 409);
  }
  if (
    sqlState === "22023" &&
    /\benabled_metrics_report_requires_recipient\b/.test(text)
  ) {
    return new AdminMetricsReportConfigError(
      "enabled_recipient_required",
      422,
    );
  }
  if (
    sqlState === "22023" &&
    /\b(?:invalid_metrics_report_selection_shape|duplicate_metrics_report_selected_business)\b/.test(
      text,
    )
  ) {
    return new AdminMetricsReportConfigError("invalid_selection", 422);
  }
  if (
    sqlState === "22023" &&
    /\b(?:invalid_metrics_report_scope|invalid_metrics_report_selection_mode|invalid_metrics_report_start_month|invalid_metrics_report_enabled|invalid_metrics_report_recipients|invalid_metrics_report_recipient|duplicate_metrics_report_recipient|invalid_metrics_report_selected_businesses)\b/.test(
      text,
    )
  ) {
    return new AdminMetricsReportConfigError("invalid_request", 400);
  }
  return new AdminMetricsReportConfigError("save_failed", 500);
}

function invalid(): never {
  throw new AdminMetricsReportConfigsReadError("invalid_response");
}

function inconsistent(): never {
  throw new AdminMetricsReportConfigsReadError("inconsistent_response");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
