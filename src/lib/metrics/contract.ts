export const BUSINESS_METRIC_KEYS_V1 = [
  "missed_call_caught",
  "ai_conversation_engaged",
  "booking_confirmed",
  "web_chat_session_engaged",
  "contact_created",
  "hot_lead_classified",
  "sms_message_inbound",
  "sms_message_outbound",
  "sms_parts_inbound",
  "sms_parts_outbound",
  "mms_event_inbound",
  "mms_event_outbound",
] as const;

export type BusinessMetricKeyV1 = (typeof BUSINESS_METRIC_KEYS_V1)[number];

export const BUSINESS_METRIC_BOOKING_ORIGINS_V1 = ["ai", "dashboard"] as const;

export type BusinessMetricBookingOriginV1 =
  (typeof BUSINESS_METRIC_BOOKING_ORIGINS_V1)[number];

export const BUSINESS_METRIC_LABELS_V1 = {
  missed_call_caught: "Missed calls caught",
  ai_conversation_engaged: "AI conversations engaged",
  booking_confirmed: "Bookings confirmed",
  web_chat_session_engaged: "Web chat sessions engaged",
  contact_created: "Contacts created",
  hot_lead_classified: "Hot leads classified",
  sms_message_inbound: "Inbound SMS messages",
  sms_message_outbound: "Outbound SMS messages",
  sms_parts_inbound: "Inbound SMS parts",
  sms_parts_outbound: "Outbound SMS parts",
  mms_event_inbound: "Inbound MMS events",
  mms_event_outbound: "Outbound MMS events",
} as const satisfies Record<BusinessMetricKeyV1, string>;

export const BUSINESS_METRIC_BOOKING_ORIGIN_LABELS_V1 = {
  ai: "AI",
  dashboard: "Dashboard",
} as const satisfies Record<BusinessMetricBookingOriginV1, string>;

export const BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1 = [
  "booking_confirmed_ai",
  "booking_confirmed_dashboard",
] as const;

export type BusinessMetricBookingCountKeyV1 =
  (typeof BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1)[number];

export type BusinessMetricCountKeyV1 =
  | BusinessMetricKeyV1
  | BusinessMetricBookingCountKeyV1;

export type BusinessMetricCountsV1 = Record<BusinessMetricCountKeyV1, number>;

export const ADMIN_MONTHLY_METRIC_SCOPE_KINDS_V1 = [
  "all",
  "direct",
  "partner",
] as const;

export type AdminMonthlyMetricScopeKindV1 =
  (typeof ADMIN_MONTHLY_METRIC_SCOPE_KINDS_V1)[number];

export interface BusinessMetricDefinitionResponseV1 {
  metric_key: BusinessMetricKeyV1;
  definition_version: 1;
  available_since: string;
  supports_historical_backfill: boolean;
}

export interface AdminMonthlyBusinessMetricBrandV1 {
  brand_kind: "direct" | "partner";
  partner_id_at_event: string | null;
  partner_name: string | null;
  partner_slug: string | null;
  counts: BusinessMetricCountsV1;
}

export interface AdminMonthlyBusinessMetricRowV1 {
  business_id: string;
  business_name: string;
  partner_id_at_event: string | null;
  partner_name: string | null;
  partner_slug: string | null;
  counts: BusinessMetricCountsV1;
}

export interface AdminMonthlyBusinessMetricPartnerOptionV1 {
  partner_id: string;
  partner_name: string | null;
  partner_slug: string | null;
}

/** Exact count-only JSON shape returned by list_admin_monthly_business_metrics_v1. */
export interface AdminMonthlyBusinessMetricsResponseV1 {
  period: {
    month: string;
    start: string;
    end_exclusive: string;
  };
  scope: {
    kind: AdminMonthlyMetricScopeKindV1;
    partner_id: string | null;
  };
  definitions: BusinessMetricDefinitionResponseV1[];
  totals: BusinessMetricCountsV1;
  brand_totals: AdminMonthlyBusinessMetricBrandV1[];
  businesses: AdminMonthlyBusinessMetricRowV1[];
  partner_options: AdminMonthlyBusinessMetricPartnerOptionV1[];
}

const BUSINESS_METRIC_KEY_SET_V1 = new Set<string>(BUSINESS_METRIC_KEYS_V1);
const BUSINESS_METRIC_BOOKING_ORIGIN_SET_V1 = new Set<string>(
  BUSINESS_METRIC_BOOKING_ORIGINS_V1,
);

export function isBusinessMetricKeyV1(
  value: unknown,
): value is BusinessMetricKeyV1 {
  return typeof value === "string" && BUSINESS_METRIC_KEY_SET_V1.has(value);
}

export function isBusinessMetricBookingOriginV1(
  value: unknown,
): value is BusinessMetricBookingOriginV1 {
  return (
    typeof value === "string" &&
    BUSINESS_METRIC_BOOKING_ORIGIN_SET_V1.has(value)
  );
}
