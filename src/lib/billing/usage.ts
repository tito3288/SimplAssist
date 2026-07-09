import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import { countSmsParts } from "./smsParts";
import type { SubscriptionPlan, SubscriptionStatus } from "@/types/database";

const USAGE_BLOCK_MESSAGES = {
  telnyx_submission_disabled:
    "SMS sending is disabled for this account. Contact SimplAssist support if this looks wrong.",
  billing_required:
    "Choose an active plan before sending SMS.",
  past_due:
    "Your subscription payment needs attention before SMS sending can continue.",
  canceled:
    "Choose an active plan before SMS sending can continue.",
  usage_limit_reached:
    "You have used all included SMS parts for this billing period. Upgrade or enable overages to keep sending.",
};

export type UsageBlockReason = keyof typeof USAGE_BLOCK_MESSAGES;

export type UsagePreflight =
  | {
      allowed: true;
      businessId: string;
      periodId: string;
      smsParts: number;
      warningThresholdReached: boolean;
    }
  | {
      allowed: false;
      reason: UsageBlockReason;
      message: string;
      smsParts: number;
    };

interface BusinessBillingRow {
  id: string;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
  telnyx_submission_disabled: boolean;
  sms_overage_opt_in: boolean;
}

interface SubscriptionBillingRow {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
}

interface UsagePeriodRow {
  id: string;
  included_sms_parts: number;
  inbound_sms_parts: number;
  outbound_sms_parts: number;
  warning_80_sent_at: string | null;
  hard_limit_reached_at: string | null;
}

export async function preflightOutboundSms(args: {
  businessId: string;
  text: string;
}): Promise<UsagePreflight> {
  const smsParts = countSmsParts(args.text);
  const context = await resolveUsageContext(args.businessId);

  if (context.business.telnyx_submission_disabled) {
    return blocked("telnyx_submission_disabled", smsParts);
  }

  if (!context.billingExempt) {
    if (!context.subscription) {
      return blocked("billing_required", smsParts);
    }
    if (context.subscription.status === "past_due") {
      return blocked("past_due", smsParts);
    }
    if (context.subscription.status === "canceled") {
      return blocked("canceled", smsParts);
    }
  }

  const period = await ensureUsagePeriod(context);
  const used = period.inbound_sms_parts + period.outbound_sms_parts;
  const nextUsed = used + smsParts;
  const included = period.included_sms_parts;
  const overageAllowed =
    context.business.sms_overage_opt_in || context.billingExempt;

  if (included > 0 && nextUsed > included && !overageAllowed) {
    await markHardLimitReached(period.id);
    return blocked("usage_limit_reached", smsParts);
  }

  const warningThresholdReached = included > 0 && nextUsed >= included * 0.8;
  if (warningThresholdReached && !period.warning_80_sent_at) {
    await markWarningSent(period.id);
  }

  return {
    allowed: true,
    businessId: args.businessId,
    periodId: period.id,
    smsParts,
    warningThresholdReached,
  };
}

export async function recordOutboundSmsUsage(args: {
  businessId: string;
  text: string;
  source: string;
  providerMessageId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const context = await resolveUsageContext(args.businessId);
  const period = await ensureUsagePeriod(context);
  const smsParts = countSmsParts(args.text);
  await recordUsageEvent({
    businessId: args.businessId,
    periodId: period.id,
    direction: "outbound",
    channel: "sms",
    source: args.source,
    smsParts,
    mmsEvents: 0,
    providerMessageId: args.providerMessageId ?? null,
    idempotencyKey:
      args.idempotencyKey ??
      `outbound:${args.source}:${args.providerMessageId ?? crypto.randomUUID()}`,
    metadata: args.metadata,
  });
}

export async function recordInboundMessagingUsage(args: {
  businessId: string;
  text: string;
  mediaCount: number;
  source: string;
  providerEventId?: string | null;
  providerMessageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const context = await resolveUsageContext(args.businessId);
  const period = await ensureUsagePeriod(context);
  const smsParts = countSmsParts(args.text);
  const hasMms = args.mediaCount > 0;
  await recordUsageEvent({
    businessId: args.businessId,
    periodId: period.id,
    direction: "inbound",
    channel: hasMms ? "mms" : "sms",
    source: args.source,
    smsParts,
    mmsEvents: hasMms ? 1 : 0,
    providerMessageId: args.providerMessageId ?? null,
    idempotencyKey:
      args.providerEventId ??
      `inbound:${args.source}:${args.providerMessageId ?? crypto.randomUUID()}`,
    metadata: {
      mediaCount: args.mediaCount,
      ...(args.metadata ?? {}),
    },
  });
}

export function usageBlockMessage(reason: UsageBlockReason): string {
  return USAGE_BLOCK_MESSAGES[reason];
}

function blocked(reason: UsageBlockReason, smsParts: number): UsagePreflight {
  return {
    allowed: false,
    reason,
    message: usageBlockMessage(reason),
    smsParts,
  };
}

async function resolveUsageContext(businessId: string): Promise<{
  business: BusinessBillingRow;
  subscription: SubscriptionBillingRow | null;
  billingExempt: boolean;
  plan: SubscriptionPlan;
  periodStart: string;
  periodEnd: string;
}> {
  const [{ data: business, error: businessError }, { data: subscription }] =
    await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select(
          "id, billing_pilot, billing_comped, billing_exempt, telnyx_submission_disabled, sms_overage_opt_in"
        )
        .eq("id", businessId)
        .single<BusinessBillingRow>(),
      supabaseAdmin
        .from("subscriptions")
        .select("plan, status, current_period_start, current_period_end")
        .eq("business_id", businessId)
        .maybeSingle<SubscriptionBillingRow>(),
    ]);

  if (businessError || !business) {
    throw new Error(
      `[billing:usage] Failed to read business ${businessId}: ${businessError?.message ?? "not found"}`
    );
  }

  const billingExempt =
    business.billing_exempt || business.billing_comped || business.billing_pilot;
  const plan = subscription?.plan ?? "sms_only";
  const { start, end } =
    subscription?.current_period_start && subscription.current_period_end
      ? {
          start: subscription.current_period_start,
          end: subscription.current_period_end,
        }
      : currentUtcMonthPeriod();

  return {
    business,
    subscription: subscription ?? null,
    billingExempt,
    plan,
    periodStart: start,
    periodEnd: end,
  };
}

async function ensureUsagePeriod(context: {
  business: BusinessBillingRow;
  plan: SubscriptionPlan;
  periodStart: string;
  periodEnd: string;
}): Promise<UsagePeriodRow> {
  const included = SUBSCRIPTION_PLANS[context.plan].includedSmsParts;
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("billing_usage_periods")
    .select(
      "id, included_sms_parts, inbound_sms_parts, outbound_sms_parts, warning_80_sent_at, hard_limit_reached_at"
    )
    .eq("business_id", context.business.id)
    .eq("period_start", context.periodStart)
    .maybeSingle<UsagePeriodRow>();

  if (existingError) {
    throw new Error(
      `[billing:usage] Failed to read usage period for ${context.business.id}: ${existingError.message}`
    );
  }

  if (existing) {
    if (included > existing.included_sms_parts) {
      const { data: upgraded, error: upgradeError } = await supabaseAdmin
        .from("billing_usage_periods")
        .update({
          plan: context.plan,
          included_sms_parts: included,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select(
          "id, included_sms_parts, inbound_sms_parts, outbound_sms_parts, warning_80_sent_at, hard_limit_reached_at"
        )
        .single<UsagePeriodRow>();

      if (upgradeError || !upgraded) {
        throw new Error(
          `[billing:usage] Failed to upgrade usage period ${existing.id}: ${upgradeError?.message ?? "not found"}`
        );
      }
      return upgraded;
    }
    return existing;
  }

  const { data, error } = await supabaseAdmin
    .from("billing_usage_periods")
    .insert({
      business_id: context.business.id,
      period_start: context.periodStart,
      period_end: context.periodEnd,
      plan: context.plan,
      included_sms_parts: included,
    })
    .select(
      "id, included_sms_parts, inbound_sms_parts, outbound_sms_parts, warning_80_sent_at, hard_limit_reached_at"
    )
    .single<UsagePeriodRow>();

  if (error || !data) {
    throw new Error(
      `[billing:usage] Failed to ensure usage period for ${context.business.id}: ${error?.message ?? "not found"}`
    );
  }
  return data;
}

async function recordUsageEvent(args: {
  businessId: string;
  periodId: string;
  direction: "inbound" | "outbound";
  channel: "sms" | "mms";
  source: string;
  smsParts: number;
  mmsEvents: number;
  providerMessageId: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("billing_usage_events").insert({
    business_id: args.businessId,
    usage_period_id: args.periodId,
    idempotency_key: args.idempotencyKey,
    direction: args.direction,
    channel: args.channel,
    source: args.source,
    sms_parts: args.smsParts,
    mms_events: args.mmsEvents,
    provider_message_id: args.providerMessageId,
    metadata: args.metadata ?? null,
  });

  if (error) {
    if (error.code === "23505") return;
    throw new Error(
      `[billing:usage] Failed to insert usage event ${args.idempotencyKey}: ${error.message}`
    );
  }

  const { error: incrementError } = await supabaseAdmin.rpc(
    "increment_billing_usage_period",
    {
      p_usage_period_id: args.periodId,
      p_direction: args.direction,
      p_channel: args.channel,
      p_sms_parts: args.smsParts,
      p_mms_events: args.mmsEvents,
    }
  );

  if (incrementError) {
    throw new Error(
      `[billing:usage] Failed to increment usage period ${args.periodId}: ${incrementError.message}`
    );
  }
}

async function markWarningSent(periodId: string): Promise<void> {
  await supabaseAdmin
    .from("billing_usage_periods")
    .update({ warning_80_sent_at: new Date().toISOString() })
    .eq("id", periodId)
    .is("warning_80_sent_at", null);
}

async function markHardLimitReached(periodId: string): Promise<void> {
  await supabaseAdmin
    .from("billing_usage_periods")
    .update({ hard_limit_reached_at: new Date().toISOString() })
    .eq("id", periodId)
    .is("hard_limit_reached_at", null);
}

function currentUtcMonthPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}
