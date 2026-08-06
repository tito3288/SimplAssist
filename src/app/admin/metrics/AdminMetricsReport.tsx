import Link from "next/link";
import type { ReactNode } from "react";
import {
  BUSINESS_METRIC_KEYS_V1,
  BUSINESS_METRIC_LABELS_V1,
  type AdminMonthlyBusinessMetricBrandV1,
  type AdminMonthlyBusinessMetricRowV1,
  type AdminMonthlyBusinessMetricsResponseV2,
  type BusinessMetricCountKeyV1,
  type BusinessMetricCountsV1,
  type BusinessMetricDefinitionResponseV1,
} from "@/lib/metrics/contract";
import {
  bodyFaint,
  btnPrimaryCompact,
  card,
  statusDanger,
  statusNeutral,
  tile,
} from "@/lib/theme-v2/theme";
import {
  AdminMetricsExport,
  type AdminMetricsCsvData,
  type AdminMetricsExportFilters,
} from "./AdminMetricsExport";

export type AdminMetricsReportErrorState =
  | "query_failed"
  | "invalid_response"
  | "inconsistent_response";

export type AdminMetricsReportState =
  | {
      state: "ready";
      report: AdminMonthlyBusinessMetricsResponseV2;
    }
  | { state: AdminMetricsReportErrorState };

export type AdminBusinessMetricsReportErrorState =
  | AdminMetricsReportErrorState
  | "business_unavailable";

export type AdminBusinessMetricsReportState =
  | {
      state: "ready";
      report: AdminMonthlyBusinessMetricsResponseV2;
    }
  | { state: AdminBusinessMetricsReportErrorState };

interface AdminMetricsReportProps {
  result: AdminMetricsReportState;
}

const OUTCOME_METRICS = [
  "missed_call_caught",
  "ai_conversation_engaged",
  "booking_confirmed",
  "web_chat_session_engaged",
  "contact_created",
  "hot_lead_classified",
] as const satisfies readonly BusinessMetricCountKeyV1[];

const MESSAGING_METRICS = [
  "sms_message_inbound",
  "sms_message_outbound",
  "sms_parts_inbound",
  "sms_parts_outbound",
  "mms_event_inbound",
  "mms_event_outbound",
] as const satisfies readonly BusinessMetricCountKeyV1[];

const TABLE_COLUMNS = [
  "missed_call_caught",
  "ai_conversation_engaged",
  "booking_confirmed",
  "booking_confirmed_ai",
  "booking_confirmed_dashboard",
  "web_chat_session_engaged",
  "contact_created",
  "hot_lead_classified",
  ...MESSAGING_METRICS,
] as const satisfies readonly BusinessMetricCountKeyV1[];

const COUNT_LABELS: Record<BusinessMetricCountKeyV1, string> = {
  ...BUSINESS_METRIC_LABELS_V1,
  booking_confirmed_ai: "AI bookings",
  booking_confirmed_dashboard: "Dashboard bookings",
};

const METRIC_CSV_HEADERS = TABLE_COLUMNS.map((key) => COUNT_LABELS[key]);

const BRAND_TOTALS_CSV_HEADERS = [
  "Event-time brand",
  "Brand kind",
  "partner_id_at_event",
  ...METRIC_CSV_HEADERS,
];

const PER_BUSINESS_CSV_HEADERS = [
  "Business name",
  "business_id",
  "Event-time brand",
  "partner_id_at_event",
  ...METRIC_CSV_HEADERS,
];

const NO_METRIC_EVENTS_BRAND_LABEL = "No metric events this month";

const ERROR_COPY: Record<
  AdminBusinessMetricsReportErrorState,
  { heading: string; detail: string }
> = {
  query_failed: {
    heading: "Metrics query unavailable",
    detail: "The monthly metrics query could not be completed.",
  },
  invalid_response: {
    heading: "Metrics response unavailable",
    detail: "The monthly metrics response failed strict validation.",
  },
  inconsistent_response: {
    heading: "Metrics totals unavailable",
    detail: "The monthly metrics response did not pass consistency checks.",
  },
  business_unavailable: {
    heading: "Business metrics unavailable",
    detail: "The selected business could not be found.",
  },
};

export function AdminMetricsReport({ result }: AdminMetricsReportProps) {
  if (result.state !== "ready") {
    return <MetricsError state={result.state} />;
  }

  const { report } = result;
  const empty =
    report.brand_totals.length === 0 && report.businesses.length === 0;
  const exportFilters = buildMetricsExportFilters(report);
  const brandTotalsCsv = buildBrandTotalsCsvData(report);
  const perBusinessCsv = buildPerBusinessCsvData(report);

  return (
    <div className="space-y-6">
      <section aria-labelledby="overall-metrics-heading" className="space-y-3">
        <div>
          <h2 id="overall-metrics-heading" className="text-lg font-semibold">
            {formatMonth(report.period.month)} totals
          </h2>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            {`${reportScopeLabel(report)} · UTC range ${report.period.start} to ${report.period.end_exclusive} (exclusive)`}
          </p>
        </div>

        <div
          className="grid gap-4 lg:grid-cols-2"
          aria-label="Overall metric totals"
        >
          <CountGroup
            heading="Engagement and outcomes"
            keys={OUTCOME_METRICS}
            counts={report.totals}
            showBookingBreakdown
          />
          <CountGroup
            heading="SMS and MMS usage"
            keys={MESSAGING_METRICS}
            counts={report.totals}
          />
        </div>
      </section>

      {empty ? (
        <p className={`rounded-2xl px-4 py-5 text-sm ${statusNeutral}`}>
          No metric events were recorded for this UTC month and scope.
        </p>
      ) : (
        <>
          {report.brand_totals.length > 0 ? (
            <MetricTable
              heading="Brand totals"
              ariaLabel="Monthly brand metric totals"
              identityHeading="Event-time brand"
              action={
                <AdminMetricsExport
                  kind="brand-totals"
                  filters={exportFilters}
                  data={brandTotalsCsv}
                />
              }
              rows={report.brand_totals.map((brand) => ({
                key: brandKey(brand),
                primary: brandLabel(
                  brand.partner_id_at_event,
                  brand.partner_name,
                  brand.partner_slug,
                ),
                secondary:
                  brand.partner_id_at_event === null
                    ? "Direct"
                    : brand.partner_id_at_event,
                counts: brand.counts,
              }))}
            />
          ) : null}
          {report.businesses.length > 0 ? (
            <MetricTable
              heading="Per-business metrics"
              ariaLabel="Monthly event-time business metric rows"
              identityHeading="Business and event-time brand"
              action={
                <AdminMetricsExport
                  kind="per-business"
                  filters={exportFilters}
                  data={perBusinessCsv}
                />
              }
              rows={report.businesses.map((business) => ({
                key: businessKey(business),
                primary: (
                  <Link
                    href={`/admin/metrics/${business.business_id}?month=${report.period.month}`}
                    className="text-[#c2410c] underline-offset-2 hover:underline dark:text-[#ff914d]"
                  >
                    {business.business_name}
                  </Link>
                ),
                secondary: `Event-time brand: ${brandLabel(
                  business.partner_id_at_event,
                  business.partner_name,
                  business.partner_slug,
                )}`,
                counts: business.counts,
              }))}
            />
          ) : null}
        </>
      )}

      <MetricDefinitions definitions={report.definitions} />

      <p className={`text-xs ${bodyFaint}`}>
        Counts contain no message content and remain attributed to the business
        brand recorded at event time.
      </p>
    </div>
  );
}

export function AdminBusinessMetricsReport({
  result,
  businessId,
  month,
}: {
  result: AdminBusinessMetricsReportState;
  businessId: string;
  month: string;
}) {
  if (result.state !== "ready") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Business metrics</h1>
        <MonthSelector businessId={businessId} month={month} />
        <MetricsError state={result.state} />
      </div>
    );
  }

  const { report } = result;
  const selectedBusinessId = report.scope.business_id?.toLowerCase() ?? null;
  const businessRows =
    selectedBusinessId === null
      ? []
      : report.businesses.filter(
          (business) =>
            business.business_id.toLowerCase() === selectedBusinessId,
        );
  const businessOption =
    selectedBusinessId === null
      ? undefined
      : report.business_options.find(
          (business) =>
            business.business_id.toLowerCase() === selectedBusinessId,
        );
  const businessName =
    businessOption?.business_name ?? businessRows[0]?.business_name;

  if (selectedBusinessId === null || businessName === undefined) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Business metrics</h1>
        <MonthSelector businessId={businessId} month={month} />
        <MetricsError state="business_unavailable" />
      </div>
    );
  }

  const eventTimeBrands = eventTimeBrandLabels(businessRows);
  const brandHeading =
    eventTimeBrands.length === 0
      ? NO_METRIC_EVENTS_BRAND_LABEL
      : eventTimeBrands.join(" · ");
  const perBusinessCsv = buildSingleBusinessCsvData(
    report,
    selectedBusinessId,
    businessName,
  );

  return (
    <div className="space-y-6">
      <section className={`p-5 sm:p-6 ${card}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{businessName}</h1>
            <p className={`mt-1 text-sm ${bodyFaint}`}>
              {`${eventTimeBrands.length > 1 ? "Event-time brands" : "Event-time brand"}: ${brandHeading}`}
            </p>
            <p className={`mt-2 text-sm font-medium ${bodyFaint}`}>
              Reporting period: {formatMonth(report.period.month)} (UTC)
            </p>
          </div>
          <AdminMetricsExport
            kind="per-business"
            filters={buildMetricsExportFilters(report)}
            data={perBusinessCsv}
            label="Export CSV"
          />
        </div>
      </section>

      <MonthSelector
        businessId={selectedBusinessId}
        month={report.period.month}
      />

      <section
        className={`p-5 sm:p-6 ${card}`}
        aria-labelledby="business-metric-counts-heading"
      >
        <h2
          id="business-metric-counts-heading"
          className="text-lg font-semibold"
        >
          Monthly metrics
        </h2>
        <dl
          className={`mt-4 divide-y divide-[#e8dfd3] overflow-hidden px-4 dark:divide-white/[0.08] ${tile}`}
          aria-label="Monthly business metric counts"
        >
          {TABLE_COLUMNS.map((key) => (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3"
            >
              <dt className={`text-sm ${bodyFaint}`}>{COUNT_LABELS[key]}</dt>
              <dd className="font-semibold tabular-nums">
                {formatCount(report.totals[key])}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className={`text-xs ${bodyFaint}`}>
        Counts contain no message content and remain attributed to the business
        brand recorded at event time.
      </p>
    </div>
  );
}

function MonthSelector({
  businessId,
  month,
}: {
  businessId: string;
  month: string;
}) {
  return (
    <form
      action={`/admin/metrics/${encodeURIComponent(businessId)}`}
      method="get"
      aria-label="Select metrics month"
      className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-end ${card}`}
    >
      <label className="w-full max-w-xs space-y-1 text-sm">
        <span className="block font-medium">UTC month</span>
        <input
          type="month"
          name="month"
          required
          defaultValue={month}
          className="w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5]"
        />
        <span className={`block text-xs ${bodyFaint}`}>
          Month boundaries are calculated in UTC.
        </span>
      </label>
      <button type="submit" className={btnPrimaryCompact}>
        View metrics
      </button>
    </form>
  );
}

function MetricsError({
  state,
}: {
  state: AdminBusinessMetricsReportErrorState;
}) {
  const copy = ERROR_COPY[state];
  return (
    <section
      className={`p-5 sm:p-6 ${card}`}
      aria-labelledby="metrics-error-heading"
    >
      <div className={`rounded-2xl px-4 py-4 ${statusDanger}`} role="alert">
        <h2 id="metrics-error-heading" className="text-sm font-semibold">
          {copy.heading}
        </h2>
        <p className="mt-1 text-sm">{copy.detail}</p>
        <p className="mt-1 text-xs">
          No partial, estimated, or fabricated zero counts are shown.
        </p>
      </div>
    </section>
  );
}

function eventTimeBrandLabels(
  businessRows: readonly AdminMonthlyBusinessMetricRowV1[],
): string[] {
  const segments = new Map<string, { label: string; qualifier: string }>();

  for (const business of businessRows) {
    const identity = business.partner_id_at_event ?? "direct";
    if (segments.has(identity)) continue;
    segments.set(identity, {
      label: brandLabel(
        business.partner_id_at_event,
        business.partner_name,
        business.partner_slug,
      ),
      qualifier:
        business.partner_id_at_event === null
          ? "direct"
          : (business.partner_slug ?? business.partner_id_at_event),
    });
  }

  const labelCounts = new Map<string, number>();
  for (const segment of Array.from(segments.values())) {
    labelCounts.set(segment.label, (labelCounts.get(segment.label) ?? 0) + 1);
  }

  return Array.from(segments.values(), (segment) =>
    labelCounts.get(segment.label) === 1
      ? segment.label
      : `${segment.label} (${segment.qualifier})`,
  );
}

function CountGroup({
  heading,
  keys,
  counts,
  showBookingBreakdown = false,
}: {
  heading: string;
  keys: readonly BusinessMetricCountKeyV1[];
  counts: BusinessMetricCountsV1;
  showBookingBreakdown?: boolean;
}) {
  return (
    <section className={`p-5 ${tile}`}>
      <h3 className="font-semibold">{heading}</h3>
      <dl className="mt-3 divide-y divide-[#e8dfd3] dark:divide-white/[0.08]">
        {keys.map((key) => (
          <div
            key={key}
            className="flex items-start justify-between gap-4 py-2"
          >
            <dt className={`text-sm ${bodyFaint}`}>
              {COUNT_LABELS[key]}
              {showBookingBreakdown && key === "booking_confirmed" ? (
                <span className="mt-0.5 block text-xs">
                  {`AI ${formatCount(counts.booking_confirmed_ai)} · Dashboard ${formatCount(counts.booking_confirmed_dashboard)}`}
                </span>
              ) : null}
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatCount(counts[key])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface MetricTableRow {
  key: string;
  primary: ReactNode;
  secondary: string;
  counts: BusinessMetricCountsV1;
}

function MetricTable({
  heading,
  ariaLabel,
  identityHeading,
  action,
  rows,
}: {
  heading: string;
  ariaLabel: string;
  identityHeading: string;
  action?: ReactNode;
  rows: MetricTableRow[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {action}
      </div>
      <div className={`overflow-hidden ${card}`}>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[2200px] text-left text-sm"
            aria-label={ariaLabel}
          >
            <thead className="border-b border-[#ece4d8] bg-[#faf7f2] text-xs uppercase tracking-wide text-stone-500 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#bdbdbf]">
              <tr>
                <th className="sticky left-0 bg-[#faf7f2] px-4 py-3 font-medium dark:bg-[#151515]">
                  {identityHeading}
                </th>
                {TABLE_COLUMNS.map((key) => (
                  <th key={key} className="px-4 py-3 font-medium">
                    {COUNT_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ece4d8] dark:divide-white/[0.08]">
              {rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-white px-4 py-4 font-normal dark:bg-[#101010]"
                  >
                    <span className="block font-medium">{row.primary}</span>
                    <span className={`mt-1 block text-xs ${bodyFaint}`}>
                      {row.secondary}
                    </span>
                  </th>
                  {TABLE_COLUMNS.map((key) => (
                    <td key={key} className="px-4 py-4 tabular-nums">
                      {formatCount(row.counts[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MetricDefinitions({
  definitions,
}: {
  definitions: readonly BusinessMetricDefinitionResponseV1[];
}) {
  const byKey = new Map(
    definitions.map((definition) => [definition.metric_key, definition]),
  );

  return (
    <section className={`p-5 sm:p-6 ${card}`}>
      <h2 className="text-lg font-semibold">Metric availability</h2>
      <p className={`mt-1 text-sm ${bodyFaint}`}>
        Version and historical coverage labels prevent unrecorded history from
        being mistaken for zero activity.
      </p>
      <dl className="mt-4 grid gap-3 md:grid-cols-2">
        {BUSINESS_METRIC_KEYS_V1.map((key) => {
          const definition = byKey.get(key);
          if (!definition) return null;
          return (
            <div key={key} className={`p-4 ${tile}`}>
              <dt className="font-medium">{BUSINESS_METRIC_LABELS_V1[key]}</dt>
              <dd className={`mt-1 text-xs ${bodyFaint}`}>
                Definition v{definition.definition_version} · Available since{" "}
                <time dateTime={definition.available_since}>
                  {formatUtcDate(definition.available_since)} UTC
                </time>
              </dd>
              <dd className={`mt-1 text-xs ${bodyFaint}`}>
                {definition.supports_historical_backfill
                  ? "Recoverable historical source backfill"
                  : "Live collection only"}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export function buildBrandTotalsCsvData(
  report: AdminMonthlyBusinessMetricsResponseV2,
): AdminMetricsCsvData {
  return {
    headers: BRAND_TOTALS_CSV_HEADERS,
    rows: report.brand_totals.map((brand) => [
      brandLabel(
        brand.partner_id_at_event,
        brand.partner_name,
        brand.partner_slug,
      ),
      brand.brand_kind,
      brand.partner_id_at_event ?? "",
      ...TABLE_COLUMNS.map((key) => brand.counts[key]),
    ]),
  };
}

export function buildPerBusinessCsvData(
  report: AdminMonthlyBusinessMetricsResponseV2,
  zeroEventBusiness?: { businessId: string; businessName: string },
): AdminMetricsCsvData {
  const rows: AdminMetricsCsvData["rows"][number][] = report.businesses.map(
    (business) => [
      business.business_name,
      business.business_id,
      brandLabel(
        business.partner_id_at_event,
        business.partner_name,
        business.partner_slug,
      ),
      business.partner_id_at_event ?? "",
      ...TABLE_COLUMNS.map((key) => business.counts[key]),
    ],
  );

  if (rows.length === 0 && zeroEventBusiness !== undefined) {
    rows.push([
      zeroEventBusiness.businessName,
      zeroEventBusiness.businessId,
      NO_METRIC_EVENTS_BRAND_LABEL,
      "",
      ...TABLE_COLUMNS.map((key) => report.totals[key]),
    ]);
  }

  return {
    headers: PER_BUSINESS_CSV_HEADERS,
    rows,
  };
}

export function buildSingleBusinessCsvData(
  report: AdminMonthlyBusinessMetricsResponseV2,
  businessId: string,
  businessName: string,
): AdminMetricsCsvData {
  const selectedId = businessId.toLowerCase();
  return buildPerBusinessCsvData(
    {
      ...report,
      businesses: report.businesses.filter(
        (business) => business.business_id.toLowerCase() === selectedId,
      ),
    },
    { businessId: selectedId, businessName },
  );
}

export function buildMetricsExportFilters(
  report: AdminMonthlyBusinessMetricsResponseV2,
): AdminMetricsExportFilters {
  const partnerId = report.scope.partner_id;
  const partnerSlug =
    partnerId === null
      ? null
      : (report.partner_options.find(
          (partner) => partner.partner_id === partnerId,
        )?.partner_slug ??
        report.brand_totals.find(
          (brand) => brand.partner_id_at_event === partnerId,
        )?.partner_slug ??
        null);
  const businessId = report.scope.business_id;
  const businessName =
    businessId === null
      ? null
      : (report.business_options.find(
          (business) => business.business_id === businessId,
        )?.business_name ??
        report.businesses.find(
          (business) => business.business_id === businessId,
        )?.business_name ??
        null);

  return {
    month: report.period.month,
    scope: report.scope.kind,
    partnerSlug,
    partnerId,
    businessName,
    businessId,
  };
}

function reportScopeLabel(
  report: AdminMonthlyBusinessMetricsResponseV2,
): string {
  const brandScope = scopeLabel(report);
  if (report.scope.business_id === null) return brandScope;

  const businessId = report.scope.business_id.toLowerCase();
  const option = report.business_options.find(
    (business) => business.business_id.toLowerCase() === businessId,
  );
  return `${option?.business_name ?? selectedBusinessLabel(businessId)} · ${brandScope}`;
}

function scopeLabel(report: AdminMonthlyBusinessMetricsResponseV2): string {
  if (report.scope.kind === "all") return "All brands";
  if (report.scope.kind === "direct") return "SimplAssist direct";

  const option = report.partner_options.find(
    (partner) => partner.partner_id === report.scope.partner_id,
  );
  return brandLabel(
    report.scope.partner_id,
    option?.partner_name ?? null,
    option?.partner_slug ?? null,
  );
}

function selectedBusinessLabel(businessId: string): string {
  return `Selected business (${businessId})`;
}

function brandLabel(
  partnerId: string | null,
  partnerName: string | null,
  partnerSlug: string | null,
): string {
  if (partnerId === null) return "SimplAssist direct";
  return partnerName ?? partnerSlug ?? `Historical partner (${partnerId})`;
}

function brandKey(brand: AdminMonthlyBusinessMetricBrandV1): string {
  return brand.partner_id_at_event ?? "direct";
}

function businessKey(business: AdminMonthlyBusinessMetricRowV1): string {
  return `${business.business_id}:${business.partner_id_at_event ?? "direct"}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}

function formatUtcDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
