"use client";

import { secondaryCtaCompactClass } from "@/lib/glass";
import type { AdminMonthlyMetricScopeKindV1 } from "@/lib/metrics/contract";

export type AdminMetricsCsvCell = string | number;

export interface AdminMetricsCsvData {
  headers: readonly string[];
  rows: readonly (readonly AdminMetricsCsvCell[])[];
}

export interface AdminMetricsExportFilters {
  month: string;
  scope: AdminMonthlyMetricScopeKindV1;
  partnerSlug: string | null;
  partnerId: string | null;
  businessName: string | null;
  businessId: string | null;
}

type AdminMetricsExportKind = "brand-totals" | "per-business";

const EXPORT_LABELS: Record<AdminMetricsExportKind, string> = {
  "brand-totals": "Export brand totals (CSV)",
  "per-business": "Export per-business (CSV)",
};

interface AdminMetricsExportProps {
  kind: AdminMetricsExportKind;
  filters: AdminMetricsExportFilters;
  data: AdminMetricsCsvData;
}

export function AdminMetricsExport({
  kind,
  filters,
  data,
}: AdminMetricsExportProps) {
  if (data.rows.length === 0) return null;

  return (
    <button
      type="button"
      className={secondaryCtaCompactClass}
      onClick={() => {
        downloadAdminMetricsCsv(
          buildAdminMetricsExportFilename(kind, filters),
          buildAdminMetricsCsv(data),
        );
      }}
    >
      {EXPORT_LABELS[kind]}
    </button>
  );
}

export function buildAdminMetricsCsv(data: AdminMetricsCsvData): string {
  return [data.headers, ...data.rows]
    .map((row) => row.map(escapeAdminMetricsCsvField).join(","))
    .join("\r\n")
    .concat("\r\n");
}

export function escapeAdminMetricsCsvField(value: AdminMetricsCsvCell): string {
  let field = String(value);
  if (/^[=+\-@]/.test(field)) field = `'${field}`;
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function buildAdminMetricsExportFilename(
  kind: AdminMetricsExportKind,
  filters: AdminMetricsExportFilters,
): string {
  const filterParts = [filters.month, filters.scope];

  if (filters.scope === "partner") {
    if (filters.partnerSlug !== null) {
      filterParts.push(filenameSegment(filters.partnerSlug));
    } else if (filters.partnerId !== null) {
      filterParts.push("historical", filenameSegment(filters.partnerId));
    } else {
      filterParts.push("unknown");
    }
  }

  if (filters.businessId !== null) {
    filterParts.push("business");
    if (filters.businessName !== null) {
      filterParts.push(filenameSegment(filters.businessName));
    }
    filterParts.push(filenameSegment(filters.businessId));
  }

  return `simplassist-${kind}-${filterParts.join("-")}.csv`;
}

export function downloadAdminMetricsCsv(filename: string, csv: string): void {
  const objectUrl = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  let anchor: HTMLAnchorElement | null = null;

  try {
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

function filenameSegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return normalized || "unknown";
}
