import { NextRequest, NextResponse } from "next/server";
import { telnyx } from "@/lib/messaging/client";
import {
  markProcessedOnce,
  releaseProcessedEvent,
  RetryableWebhookError,
} from "@/lib/messaging/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendMissedCallSMS } from "@/lib/messaging/missed-call";
import { buildSmsComplianceCopy } from "@/lib/messaging/complianceCopy";
import { isE164PhoneNumber } from "@/lib/phone/e164";

// Telnyx Voice API delivers all call lifecycle events to the same URL.
// We act on a small subset to drive forwarding and the missed-call voicemail flow:
//
//   call.initiated      -> answer (or reject if number isn't configured)
//   call.answered       -> forward if enabled, otherwise speak greeting
//   call.bridged        -> mark a forwarding attempt connected
//   call.speak.ended    -> start recording
//   call.recording.saved -> hangup + trigger missed-call SMS
//   call.recording.error -> log + still trigger missed-call SMS so customer hears back
//   call.hangup         -> forwarding fallback or terminal log
//
// State (callControlId, businessId, from, businessName) is threaded through every
// command via Base64-encoded client_state because some later events (notably
// call.recording.saved) don't include call_control_id in their payload.
//
// Retry semantics are SELECTIVE (claim/release contract in
// @/lib/messaging/idempotency): failures in the DURABLE_EVENT_TYPES below,
// OR any handler throwing RetryableWebhookError (durable side effects can
// fail under real-time event types — e.g. the missed-call SMS on a
// forwarding dial error under call.answered), release the idempotency
// claim and return 500 so Telnyx redelivers. All other real-time
// call-control failures keep the log-and-200 swallow: retrying
// answer()/speak() seconds later on a dead call cannot help.

const CALL_FORWARD_TIMEOUT_SECS = 18;

const DURABLE_EVENT_TYPES = new Set([
  "call.hangup",
  "call.recording.saved",
  "call.recording.error",
]);

type ForwardingRole = "inbound" | "forward_target";
type ForwardingTerminalStatus = "abandoned" | "fallback_triggered" | "error";

interface VoiceState {
  callControlId: string;
  businessId: string;
  from: string;
  businessName: string;
  businessEmail?: string | null;
  businessPhoneNumber?: string | null;
  smsPhoneNumber?: string;
  telnyxVoiceApplicationId?: string | null;
  callForwardingEnabled?: boolean;
  forwardToNumber?: string | null;
  forwardingRole?: ForwardingRole;
  forwardingAttemptId?: string;
  outboundCallControlId?: string | null;
}

interface ForwardingAttempt {
  id: string;
  business_id: string;
  inbound_call_control_id: string;
  outbound_call_control_id: string | null;
  call_session_id: string;
  caller_phone: string;
  forward_to_number: string;
  status: string;
  fallback_triggered_at: string | null;
}

function encodeState(state: VoiceState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64");
}

function decodeState(b64: string | undefined): VoiceState | null {
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString()) as VoiceState;
  } catch (err) {
    console.warn("[messaging:voice] Failed to decode client_state:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let event: unknown;
  try {
    event = await telnyx.webhooks.unwrap(rawBody, { headers });
  } catch (err) {
    console.warn("[messaging:voice] Signature verification failed:", err);
    return new NextResponse("Forbidden", { status: 403 });
  }

  const eventData = (event as { data?: { id?: string; event_type?: string; payload?: unknown } }).data;
  const eventType = eventData?.event_type;
  const eventId = eventData?.id;
  console.log(`[messaging:voice] event_type=${eventType} event_id=${eventId}`);

  if (eventId) {
    const isFirstTime = await markProcessedOnce(eventId);
    if (!isFirstTime) {
      console.log(`[messaging:voice] Idempotency: event ${eventId} already processed, skipping`);
      return new NextResponse("OK", { status: 200 });
    }
  } else {
    console.warn("[messaging:voice] Missing event.data.id, skipping idempotency check");
  }

  const payload = eventData?.payload as Record<string, unknown> | undefined;
  if (!payload) {
    return new NextResponse("OK", { status: 200 });
  }

  try {
    switch (eventType) {
      case "call.initiated":
        await handleCallInitiated(payload);
        break;
      case "call.answered":
        await handleCallAnswered(payload);
        break;
      case "call.bridged":
        await handleCallBridged(payload);
        break;
      case "call.speak.ended":
        await handleSpeakEnded(payload);
        break;
      case "call.recording.saved":
        await handleRecordingSaved(payload);
        break;
      case "call.recording.error":
        await handleRecordingError(payload);
        break;
      case "call.hangup":
        await handleCallHangup(payload);
        break;
      default:
        console.log(`[messaging:voice] Ignoring event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`[messaging:voice] Error handling ${eventType}:`, err);
    const retryable =
      err instanceof RetryableWebhookError ||
      (typeof eventType === "string" && DURABLE_EVENT_TYPES.has(eventType));
    if (retryable) {
      // Record-and-let-retry: release our claim and 500 so Telnyx
      // redelivers. A failed release dead-letters the row permanently
      // (schema limits — see the claim/release contract); still return
      // an explicit 500 rather than lie with a 200.
      if (eventId) {
        try {
          await releaseProcessedEvent(eventId);
        } catch (releaseErr) {
          console.error(
            `[messaging:voice] claim release failed for ${eventId} — event dead-lettered:`,
            releaseErr
          );
        }
      }
      return new NextResponse("Handler Error", { status: 500 });
    }
  }

  return new NextResponse("OK", { status: 200 });
}

async function handleCallInitiated(payload: Record<string, unknown>) {
  if (payload.direction !== "incoming") {
    console.log(`[messaging:voice] Ignoring non-incoming call.initiated`);
    return;
  }

  const callControlId = payload.call_control_id as string;
  const from = payload.from as string;
  const to = payload.to as string;

  console.log(
    `[messaging:voice] call.initiated from=${from} to=${to} call_control_id=${callControlId}`
  );

  const { data: phoneNumberRow } = await supabaseAdmin
    .from("phone_numbers")
    .select("business_id")
    .eq("phone_number", to)
    .eq("is_active", true)
    .single();

  if (!phoneNumberRow) {
    console.warn(`[messaging:voice] No active business for to=${to}, rejecting call`);
    await telnyx.calls.actions.reject(callControlId, { cause: "USER_BUSY" });
    return;
  }

  const businessId = phoneNumberRow.business_id;
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select(
      "name, email, phone_number, telnyx_voice_application_id, call_forwarding_enabled, forward_to_number"
    )
    .eq("id", businessId)
    .single();
  const businessName = business?.name ?? "us";

  const state = encodeState({
    callControlId,
    businessId,
    from,
    businessName,
    businessEmail: business?.email ?? null,
    businessPhoneNumber: business?.phone_number ?? null,
    smsPhoneNumber: to,
    telnyxVoiceApplicationId: business?.telnyx_voice_application_id ?? null,
    callForwardingEnabled: business?.call_forwarding_enabled ?? false,
    forwardToNumber: business?.forward_to_number ?? null,
  });
  console.log(
    `[messaging:voice] Answering call for businessId=${businessId} (name='${businessName}')`
  );
  await telnyx.calls.actions.answer(callControlId, { client_state: state });
}

async function handleCallAnswered(payload: Record<string, unknown>) {
  const stateB64 = payload.client_state as string | undefined;
  const state = decodeState(stateB64);
  if (!state) {
    console.warn(`[messaging:voice] call.answered missing client_state`);
    return;
  }

  if (state.forwardingRole === "forward_target") {
    console.log(
      `[messaging:voice] forward target answered attempt=${state.forwardingAttemptId}`
    );
    if (state.forwardingAttemptId) {
      await markForwardingConnected(state.forwardingAttemptId, "target_answered");
    }
    return;
  }

  if (shouldAttemptForwarding(state)) {
    await startCallForwarding(payload, state);
    return;
  }

  await speakVoicemailGreeting(state, stateB64);
}

function shouldAttemptForwarding(state: VoiceState): boolean {
  if (!state.callForwardingEnabled) return false;

  if (!state.forwardToNumber || !isE164PhoneNumber(state.forwardToNumber)) {
    console.warn(
      `[messaging:voice] forwarding enabled for businessId=${state.businessId} but forward_to_number is missing or invalid; using missed-call voicemail flow`
    );
    return false;
  }

  if (!state.telnyxVoiceApplicationId) {
    console.warn(
      `[messaging:voice] forwarding enabled for businessId=${state.businessId} but telnyx_voice_application_id is missing; using missed-call voicemail flow`
    );
    return false;
  }

  if (!state.smsPhoneNumber) {
    console.warn(
      `[messaging:voice] forwarding enabled for businessId=${state.businessId} but smsPhoneNumber is missing; using missed-call voicemail flow`
    );
    return false;
  }

  if (state.forwardToNumber === state.smsPhoneNumber) {
    console.warn(
      `[messaging:voice] forwarding enabled for businessId=${state.businessId} but forward_to_number equals the SimplAssist number; using missed-call voicemail flow`
    );
    return false;
  }

  return true;
}

async function speakVoicemailGreeting(state: VoiceState, stateB64: string | undefined) {
  const greeting = buildSmsComplianceCopy({
    business: {
      name: state.businessName,
      email: state.businessEmail ?? null,
      phone_number: state.businessPhoneNumber ?? null,
    },
    smsPhoneNumber: state.smsPhoneNumber ?? "this business number",
    privacyUrl: "the business privacy policy",
  }).voicemailGreeting;

  console.log(
    `[messaging:voice] call.answered, speaking greeting for ${state.businessName}`
  );
  await telnyx.calls.actions.speak(state.callControlId, {
    payload: greeting,
    voice: "AWS.Polly.Joanna-Neural",
    language: "en-US",
    client_state: stateB64,
  });
}

async function startCallForwarding(
  payload: Record<string, unknown>,
  state: VoiceState
) {
  const callSessionId = payload.call_session_id as string | undefined;
  const inboundCallLegId = payload.call_leg_id as string | undefined;
  const forwardToNumber = state.forwardToNumber;
  const voiceApplicationId = state.telnyxVoiceApplicationId;
  const smsPhoneNumber = state.smsPhoneNumber;

  if (!callSessionId || !forwardToNumber || !voiceApplicationId || !smsPhoneNumber) {
    console.warn(
      `[messaging:voice] forwarding prerequisites missing for businessId=${state.businessId}; using missed-call voicemail flow`
    );
    await speakVoicemailGreeting(state, encodeState(state));
    return;
  }

  const attempt = await createForwardingAttempt({
    businessId: state.businessId,
    inboundCallControlId: state.callControlId,
    inboundCallLegId,
    callSessionId,
    callerPhone: state.from,
    forwardToNumber,
  });

  let outboundCallControlId: string | null = null;

  try {
    const targetState = encodeState({
      ...state,
      forwardingRole: "forward_target",
      forwardingAttemptId: attempt.id,
      outboundCallControlId: null,
    });

    console.log(
      `[messaging:voice] forwarding attempt=${attempt.id} dialing owner=${forwardToNumber} timeout=${CALL_FORWARD_TIMEOUT_SECS}s`
    );
    const dialResponse = await telnyx.calls.dial({
      connection_id: voiceApplicationId,
      from: smsPhoneNumber,
      to: forwardToNumber,
      timeout_secs: CALL_FORWARD_TIMEOUT_SECS,
      client_state: targetState,
    });

    outboundCallControlId = dialResponse.data?.call_control_id ?? null;
    if (!outboundCallControlId) {
      throw new Error("Telnyx dial returned no outbound call_control_id");
    }

    await updateForwardingAttemptOutbound(attempt.id, {
      outboundCallControlId,
      outboundCallLegId: dialResponse.data?.call_leg_id ?? null,
    });

    const latestAttempt = await getForwardingAttemptById(attempt.id);
    if (latestAttempt?.fallback_triggered_at) {
      console.log(
        `[messaging:voice] attempt=${attempt.id} already fell back before bridge; canceling owner leg`
      );
      await bestEffortHangup(outboundCallControlId, "forward target after fallback");
      return;
    }

    const inboundBridgeState = encodeState({
      ...state,
      forwardingRole: "inbound",
      forwardingAttemptId: attempt.id,
      outboundCallControlId,
    });

    await telnyx.calls.actions.bridge(state.callControlId, {
      call_control_id_to_bridge_with: outboundCallControlId,
      play_ringtone: true,
      prevent_double_bridge: true,
      client_state: inboundBridgeState,
    });
  } catch (err) {
    console.error(
      `[messaging:voice] forwarding attempt=${attempt.id} failed before connection:`,
      err
    );
    await triggerForwardingFallback({
      attemptId: attempt.id,
      status: "error",
      reason: err instanceof Error ? err.message : "forwarding dial/bridge error",
      hangupInbound: true,
      hangupOutbound: true,
      outboundCallControlId,
    });
  }
}

async function handleCallBridged(payload: Record<string, unknown>) {
  const state = decodeState(payload.client_state as string | undefined);
  const attempt = await findForwardingAttempt(payload, state);

  if (!attempt) {
    console.log(
      `[messaging:voice] call.bridged with no forwarding attempt session=${payload.call_session_id}`
    );
    return;
  }

  await markForwardingConnected(attempt.id, "call_bridged");
}

async function handleCallHangup(payload: Record<string, unknown>) {
  const state = decodeState(payload.client_state as string | undefined);
  const attempt = await findForwardingAttempt(payload, state);

  if (!attempt) {
    console.log(
      `[messaging:voice] call.hangup leg=${payload.call_leg_id} session=${payload.call_session_id}`
    );
    return;
  }

  const callControlId = payload.call_control_id as string | undefined;
  const cause =
    (payload.hangup_cause as string | undefined) ??
    (payload.cause as string | undefined) ??
    "unknown";

  if (attempt.status === "connected") {
    await markForwardingEnded(attempt.id);
    console.log(
      `[messaging:voice] forwarding attempt=${attempt.id} connected call ended cause=${cause}`
    );
    return;
  }

  if (attempt.status === "ended") {
    console.log(
      `[messaging:voice] forwarding attempt=${attempt.id} already ended; ignoring additional hangup cause=${cause}`
    );
    return;
  }

  if (attempt.fallback_triggered_at) {
    console.log(
      `[messaging:voice] forwarding attempt=${attempt.id} fallback already triggered; ignoring hangup cause=${cause}`
    );
    return;
  }

  const isInboundHangup =
    callControlId === attempt.inbound_call_control_id ||
    (state?.forwardingRole === "inbound" &&
      state.forwardingAttemptId === attempt.id);
  const isOutboundHangup =
    callControlId === attempt.outbound_call_control_id ||
    (state?.forwardingRole === "forward_target" &&
      state.forwardingAttemptId === attempt.id);

  if (isInboundHangup) {
    console.log(
      `[messaging:voice] caller abandoned forwarding attempt=${attempt.id}; canceling owner leg`
    );
    await triggerForwardingFallback({
      attemptId: attempt.id,
      status: "abandoned",
      reason: `caller_hangup_before_bridge:${cause}`,
      hangupInbound: false,
      hangupOutbound: true,
    });
    return;
  }

  if (isOutboundHangup) {
    console.log(
      `[messaging:voice] owner leg ended before bridge attempt=${attempt.id} cause=${cause}; triggering missed-call fallback`
    );
    await triggerForwardingFallback({
      attemptId: attempt.id,
      status: "fallback_triggered",
      reason: `owner_hangup_before_bridge:${cause}`,
      hangupInbound: true,
      hangupOutbound: false,
    });
    return;
  }

  console.log(
    `[messaging:voice] forwarding attempt=${attempt.id} hangup did not match known leg cause=${cause}`
  );
}

async function handleSpeakEnded(payload: Record<string, unknown>) {
  const status = payload.status;
  const stateB64 = payload.client_state as string | undefined;
  const state = decodeState(stateB64);

  if (status !== "completed") {
    console.log(
      `[messaging:voice] call.speak.ended status=${status} (skipping recording)`
    );
    return;
  }
  if (!state) {
    console.warn(`[messaging:voice] call.speak.ended missing client_state`);
    return;
  }

  console.log(
    `[messaging:voice] Starting recording for callControlId=${state.callControlId}`
  );
  await telnyx.calls.actions.startRecording(state.callControlId, {
    channels: "single",
    format: "mp3",
    max_length: 60,
    timeout_secs: 5,
    play_beep: true,
    client_state: stateB64,
  });
}

async function handleRecordingSaved(payload: Record<string, unknown>) {
  const stateB64 = payload.client_state as string | undefined;
  const state = decodeState(stateB64);
  if (!state) {
    console.warn(`[messaging:voice] call.recording.saved missing client_state`);
    return;
  }

  // Voicemail recording URL is NOT persisted to the database in this migration —
  // it's logged only. Persisting voicemails (so they're surfaced in the dashboard)
  // is tracked as future work outside this migration.
  console.log(
    `[messaging:voice] call.recording.saved (not persisted) from=${state.from} businessId=${state.businessId} urls=`,
    payload.recording_urls
  );

  // Hangup is a best-effort cleanup. The caller has typically already hung up by
  // the time recording.saved fires (caller hangs up -> recording finalizes -> we
  // get this event), in which case Telnyx returns 422 "Call has already ended".
  // Swallowing the error here prevents it from bubbling and blocking the
  // missed-call SMS, which is the actually-important side effect.
  try {
    await telnyx.calls.actions.hangup(state.callControlId, {});
  } catch (err) {
    console.log(
      `[messaging:voice] hangup skipped (call likely already ended):`,
      err instanceof Error ? err.message : err
    );
  }

  console.log(
    `[messaging:voice] Triggering missed-call SMS to ${state.from} for ${state.businessId}`
  );
  // Awaited so a send failure propagates: the dispatcher releases the event
  // claim and 500s, and Telnyx's redelivered recording event re-attempts.
  await sendMissedCallSMS(state.from, state.businessId);
}

async function handleRecordingError(payload: Record<string, unknown>) {
  const stateB64 = payload.client_state as string | undefined;
  const state = decodeState(stateB64);
  if (!state) {
    console.warn(`[messaging:voice] call.recording.error missing client_state`);
    return;
  }

  console.error(`[messaging:voice] call.recording.error:`, payload);

  // Send the missed-call SMS even though recording failed, so the customer
  // still hears back from the business.
  console.log(
    `[messaging:voice] Triggering missed-call SMS despite recording error`
  );
  // Awaited so a send failure propagates (release + 500 + Telnyx retry).
  await sendMissedCallSMS(state.from, state.businessId);
}

async function createForwardingAttempt(args: {
  businessId: string;
  inboundCallControlId: string;
  inboundCallLegId?: string;
  callSessionId: string;
  callerPhone: string;
  forwardToNumber: string;
}): Promise<ForwardingAttempt> {
  const { data, error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .insert({
      business_id: args.businessId,
      inbound_call_control_id: args.inboundCallControlId,
      inbound_call_leg_id: args.inboundCallLegId ?? null,
      outbound_call_control_id: null,
      outbound_call_leg_id: null,
      call_session_id: args.callSessionId,
      caller_phone: args.callerPhone,
      forward_to_number: args.forwardToNumber,
      status: "dialing",
      fallback_triggered_at: null,
      abandoned_at: null,
      connected_at: null,
      ended_at: null,
      error_message: null,
    })
    .select(forwardingAttemptSelect)
    .single();

  if (error?.code === "23505") {
    const existing = await getForwardingAttemptByColumn(
      "call_session_id",
      args.callSessionId
    );
    if (existing) return existing;
  }

  if (error || !data) {
    throw new Error(
      `[messaging:voice] failed to create forwarding attempt: ${error?.message ?? "no row returned"}`
    );
  }

  return data as ForwardingAttempt;
}

async function updateForwardingAttemptOutbound(
  attemptId: string,
  args: { outboundCallControlId: string; outboundCallLegId: string | null }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .update({
      outbound_call_control_id: args.outboundCallControlId,
      outbound_call_leg_id: args.outboundCallLegId,
    })
    .eq("id", attemptId);

  if (error) {
    throw new Error(
      `[messaging:voice] failed to update forwarding outbound leg: ${error.message}`
    );
  }
}

async function getForwardingAttemptById(
  attemptId: string
): Promise<ForwardingAttempt | null> {
  const { data, error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .select(forwardingAttemptSelect)
    .eq("id", attemptId)
    .maybeSingle();

  if (error) {
    console.warn(
      `[messaging:voice] failed to read forwarding attempt ${attemptId}:`,
      error
    );
    return null;
  }

  return (data as ForwardingAttempt | null) ?? null;
}

async function findForwardingAttempt(
  payload: Record<string, unknown>,
  state: VoiceState | null
): Promise<ForwardingAttempt | null> {
  if (state?.forwardingAttemptId) {
    const attempt = await getForwardingAttemptById(state.forwardingAttemptId);
    if (attempt) return attempt;
  }

  const callControlId = payload.call_control_id as string | undefined;
  if (callControlId) {
    const byInbound = await getForwardingAttemptByColumn(
      "inbound_call_control_id",
      callControlId
    );
    if (byInbound) return byInbound;

    const byOutbound = await getForwardingAttemptByColumn(
      "outbound_call_control_id",
      callControlId
    );
    if (byOutbound) return byOutbound;
  }

  const callSessionId = payload.call_session_id as string | undefined;
  if (callSessionId) {
    return getForwardingAttemptByColumn("call_session_id", callSessionId);
  }

  return null;
}

async function getForwardingAttemptByColumn(
  column:
    | "inbound_call_control_id"
    | "outbound_call_control_id"
    | "call_session_id",
  value: string
): Promise<ForwardingAttempt | null> {
  const { data, error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .select(forwardingAttemptSelect)
    .eq(column, value)
    .maybeSingle();

  if (error) {
    console.warn(
      `[messaging:voice] forwarding attempt lookup failed ${column}=${value}:`,
      error
    );
    return null;
  }

  return (data as ForwardingAttempt | null) ?? null;
}

async function markForwardingConnected(
  attemptId: string,
  source: string
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .update({
      status: "connected",
      connected_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("status", "dialing")
    .is("fallback_triggered_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    // Retryable: a lost connected-mark makes a later hangup fire a spurious
    // missed-call SMS. The CAS (status='dialing') makes the retry a no-op
    // when the first write actually committed.
    throw new RetryableWebhookError(
      `[messaging:voice] failed to mark forwarding attempt=${attemptId} connected: ${error.message}`
    );
  }

  if (!data) {
    console.log(
      `[messaging:voice] forwarding attempt=${attemptId} not marked connected; already fell back or ended`
    );
    return;
  }

  console.log(
    `[messaging:voice] forwarding attempt=${attemptId} connected source=${source}`
  );
}

async function markForwardingEnded(attemptId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("status", "connected");

  if (error) {
    // Retryable: silently losing the 'ended' transition strands the attempt
    // in 'connected' — the durable bookkeeping this route promises to
    // record-and-let-retry. CAS (status='connected') no-ops a redundant retry.
    throw new RetryableWebhookError(
      `[messaging:voice] failed to mark forwarding attempt=${attemptId} ended: ${error.message}`
    );
  }
}

async function triggerForwardingFallback(args: {
  attemptId: string;
  status: ForwardingTerminalStatus;
  reason: string;
  hangupInbound: boolean;
  hangupOutbound: boolean;
  outboundCallControlId?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const updateData: Record<string, string | null> = {
    status: args.status,
    fallback_triggered_at: now,
    error_message: args.reason,
  };

  if (args.status === "abandoned") {
    updateData.abandoned_at = now;
  }

  const { data, error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .update(updateData)
    .eq("id", args.attemptId)
    .is("fallback_triggered_at", null)
    .neq("status", "connected")
    .select(forwardingAttemptSelect)
    .maybeSingle();

  if (error) {
    // Throw — a swallowed claim error loses the fallback (and its SMS)
    // while the event is already consumed; the dispatcher releases the
    // event claim and 500s so the redelivered hangup retries.
    throw new Error(
      `[messaging:voice] failed to claim forwarding fallback attempt=${args.attemptId}: ${error.message}`
    );
  }

  const attempt = (data as ForwardingAttempt | null) ?? null;
  if (!attempt) {
    console.log(
      `[messaging:voice] forwarding fallback already claimed or connected attempt=${args.attemptId}`
    );
    return;
  }

  const outboundCallControlId =
    args.outboundCallControlId ?? attempt.outbound_call_control_id;

  if (args.hangupOutbound && outboundCallControlId) {
    await bestEffortHangup(outboundCallControlId, "forward target cleanup");
  }
  if (args.hangupInbound) {
    await bestEffortHangup(
      attempt.inbound_call_control_id,
      "inbound forwarding cleanup"
    );
  }

  console.log(
    `[messaging:voice] forwarding fallback attempt=${attempt.id} status=${args.status} reason=${args.reason}; sending missed-call SMS`
  );
  try {
    await sendMissedCallSMS(attempt.caller_phone, attempt.business_id);
  } catch (err) {
    // Record the failure AND re-open the fallback claim: handleCallHangup
    // short-circuits on fallback_triggered_at, so without clearing it the
    // redelivered hangup would ack without re-attempting the SMS. Status
    // 'error' + error_message record what happened; the retry re-enters
    // this claim (fallback_triggered_at null, status ≠ connected) and
    // re-sends. Lost-ack caveat: if the SMS actually sent but our client
    // saw an error, the retry double-texts — annoying, and strictly better
    // than a caller who never hears back. Thrown as RetryableWebhookError:
    // this path is reachable under call.answered (forwarding dial error),
    // where a plain throw would be swallowed as a real-time verb failure.
    await reopenForwardingFallbackAfterSmsFailure(attempt.id, err);
    throw new RetryableWebhookError(
      `[messaging:voice] missed-call SMS failed for attempt=${attempt.id}`,
      { cause: err }
    );
  }
}

async function reopenForwardingFallbackAfterSmsFailure(
  attemptId: string,
  cause: unknown
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("call_forwarding_attempts")
    .update({
      status: "error",
      fallback_triggered_at: null,
      abandoned_at: null,
      error_message: `missed_call_sms_failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    })
    .eq("id", attemptId)
    // Defensive symmetry with the claim's own guard: never overwrite a
    // connected attempt (unreachable today per the state machine, cheap
    // to enforce structurally).
    .neq("status", "connected");

  if (error) {
    // The original SMS error still propagates (release + 500), but with the
    // claim timestamp intact the redelivered hangup will short-circuit —
    // this attempt's SMS is lost until the reaper follow-up. Log loudly.
    console.error(
      `[messaging:voice] FAILED TO RE-OPEN fallback attempt=${attemptId} after SMS failure — retry will not re-attempt this SMS:`,
      error
    );
  }
}

async function bestEffortHangup(
  callControlId: string,
  label: string
): Promise<void> {
  try {
    await telnyx.calls.actions.hangup(callControlId, {});
  } catch (err) {
    console.log(
      `[messaging:voice] hangup skipped for ${label}:`,
      err instanceof Error ? err.message : err
    );
  }
}

const forwardingAttemptSelect =
  "id, business_id, inbound_call_control_id, outbound_call_control_id, call_session_id, caller_phone, forward_to_number, status, fallback_triggered_at";
