import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GoalLinkOfferedAction } from "./engine";

const IMMUTABLE_GOAL_EVENT_COLUMNS =
  "business_id, contact_id, conversation_id, source_message_id, assistant_message_id, goal_at_event, event_type, channel, occurred_at, idempotency_key";

const TIMESTAMPTZ_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

interface GoalEventImmutableRow {
  business_id: string;
  contact_id: string;
  conversation_id: string;
  source_message_id: string;
  assistant_message_id: string;
  goal_at_event: string;
  event_type: string;
  channel: string;
  occurred_at: string;
  idempotency_key: string;
}

export class GoalEventInvariantCollisionError extends Error {
  constructor(
    readonly businessId: string,
    readonly idempotencyKey: string,
    options: { cause?: unknown } = {}
  ) {
    super(
      `Goal event unique collision did not match the finalized event for business ${businessId}.`,
      options
    );
    this.name = "GoalEventInvariantCollisionError";
  }
}

export interface FinalizeGoalLinkEventInput {
  businessId: string;
  action: GoalLinkOfferedAction;
  assistantMessageId: string;
  occurredAt: Date;
}

export async function finalizeGoalLinkEvent({
  businessId,
  action,
  assistantMessageId,
  occurredAt,
}: FinalizeGoalLinkEventInput): Promise<"inserted" | "duplicate"> {
  const occurredAtIso = occurredAt.toISOString();
  const occurredAtCanonical = canonicalizeTimestamptz(occurredAtIso);
  const row = {
    business_id: businessId,
    contact_id: action.contactId,
    conversation_id: action.conversationId,
    source_message_id: action.sourceMessageId,
    assistant_message_id: assistantMessageId,
    goal_at_event: action.goalAtEvent,
    event_type: "link_sent",
    channel: action.channel,
    occurred_at: occurredAtIso,
    idempotency_key: action.idempotencyKey,
  };

  const { error: insertError } = await supabaseAdmin
    .from("goal_events")
    .insert(row);

  if (!insertError) return "inserted";
  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("goal_events")
    .select(IMMUTABLE_GOAL_EVENT_COLUMNS)
    .eq("business_id", businessId)
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle<GoalEventImmutableRow>();

  if (lookupError) throw lookupError;
  if (
    occurredAtCanonical &&
    existing &&
    immutableFieldsMatch(existing, row, occurredAtCanonical)
  ) {
    return "duplicate";
  }

  throw new GoalEventInvariantCollisionError(
    businessId,
    row.idempotency_key,
    { cause: insertError }
  );
}

function immutableFieldsMatch(
  existing: GoalEventImmutableRow,
  expected: Omit<GoalEventImmutableRow, "occurred_at"> & {
    occurred_at: string;
  },
  occurredAtCanonical: string
): boolean {
  return (
    existing.business_id === expected.business_id &&
    existing.contact_id === expected.contact_id &&
    existing.conversation_id === expected.conversation_id &&
    existing.source_message_id === expected.source_message_id &&
    existing.assistant_message_id === expected.assistant_message_id &&
    existing.goal_at_event === expected.goal_at_event &&
    existing.event_type === expected.event_type &&
    existing.channel === expected.channel &&
    existing.idempotency_key === expected.idempotency_key &&
    canonicalizeTimestamptz(existing.occurred_at) === occurredAtCanonical
  );
}

function canonicalizeTimestamptz(value: string): string | null {
  const match = TIMESTAMPTZ_PATTERN.exec(value);
  if (!match) return null;

  const [, date, time, fraction = "", offset] = match;
  const wholeSecondMillis = Date.parse(`${date}T${time}${offset}`);
  if (!Number.isFinite(wholeSecondMillis)) return null;

  return `${wholeSecondMillis}:${fraction.padEnd(9, "0")}`;
}
