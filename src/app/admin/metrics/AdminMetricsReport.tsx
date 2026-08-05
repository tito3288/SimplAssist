import {
  BUSINESS_METRIC_KEYS_V1,
  BUSINESS_METRIC_LABELS_V1,
  type AdminMonthlyBusinessMetricBrandV1,
  type AdminMonthlyBusinessMetricRowV1,
  type AdminMonthlyBusinessMetricsResponseV1,
  type BusinessMetricCountKeyV1,
  type BusinessMetricCountsV1,
  type BusinessMetricDefinitionResponseV1,
} from "@/lib/metrics/contract";
import {
  bodyFaint,
  card,
  statusDanger,
  statusNeutral,
  tile,
} from "@/lib/theme-v2/theme";

export type AdminMetricsReportErrorState =
  | "query_failed"
  | "invalid_response"
  | "inconsistent_response";

export type AdminMetricsReportState =
  | {
      state: "ready";
      report: AdminMonthlyBusinessMetricsResponseV1;
    }
  | { state: AdminMetricsReportErrorState };

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

const ERROR_COPY: Record<
  AdminMetricsReportErrorState,
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
};

export function AdminMetricsReport({ result }: AdminMetricsReportProps) {
  if (result.state !== "ready") {
    const copy = ERROR_COPY[result.state];
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

  const { report } = result;
  const empty = report.businesses.length === 0;

  return (
    <div className="space-y-6">
      <section aria-labelledby="overall-metrics-heading" className="space-y-3">
        <div>
          <h2 id="overall-metrics-heading" className="text-lg font-semibold">
            {formatMonth(report.period.month)} totals
          </h2>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            {`${scopeLabel(report)} · UTC range ${report.period.start} to ${report.period.end_exclusive} (exclusive)`}
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
          <MetricTable
            heading="Brand totals"
            ariaLabel="Monthly brand metric totals"
            identityHeading="Event-time brand"
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
          <MetricTable
            heading="Per-business metrics"
            ariaLabel="Monthly event-time business metric rows"
            identityHeading="Business and event-time brand"
            rows={report.businesses.map((business) => ({
              key: businessKey(business),
              primary: business.business_name,
              secondary: `Event-time brand: ${brandLabel(
                business.partner_id_at_event,
                business.partner_name,
                business.partner_slug,
              )}`,
              counts: business.counts,
            }))}
          />
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
          <div key={key} className="flex items-start justify-between gap-4 py-2">
            <dt className={`text-sm ${bodyFaint}`}>
              {COUNT_LABELS[key]}
              {showBookingBreakdown && key === "booking_confirmed" ? (
                <span className="mt-0.5 block text-xs">
                  {`AI ${formatCount(counts.booking_confirmed_ai)} · Dashboard ${formatCount(counts.booking_confirmed_dashboard)}`}
                </span>
              ) : null}
            </dt>
            <dd className="font-semibold tabular-nums">{formatCount(counts[key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface MetricTableRow {
  key: string;
  primary: string;
  secondary: string;
  counts: BusinessMetricCountsV1;
}

function MetricTable({
  heading,
  ariaLabel,
  identityHeading,
  rows,
}: {
  heading: string;
  ariaLabel: string;
  identityHeading: string;
  rows: MetricTableRow[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
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

function scopeLabel(report: AdminMonthlyBusinessMetricsResponseV1): string {
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
