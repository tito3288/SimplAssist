import { NextRequest, NextResponse } from "next/server";
import { telnyx } from "@/lib/messaging/client";
import { markProcessedOnce } from "@/lib/messaging/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendMissedCallSMS } from "@/lib/messaging/missed-call";

// Telnyx Voice API delivers all call lifecycle events to the same URL.
// We act on a small subset to drive the missed-call voicemail flow:
//
//   call.initiated      -> answer (or reject if number isn't configured)
//   call.answered       -> speak greeting
//   call.speak.ended    -> start recording
//   call.recording.saved -> hangup + trigger missed-call SMS
//   call.recording.error -> log + still trigger missed-call SMS so customer hears back
//   call.hangup         -> log + ack (terminal)
//
// State (callControlId, businessId, from, businessName) is threaded through every
// command via Base64-encoded client_state because some later events (notably
// call.recording.saved) don't include call_control_id in their payload.

interface VoiceState {
  callControlId: string;
  businessId: string;
  from: string;
  businessName: string;
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
        console.log(
          `[messaging:voice] call.hangup leg=${payload.call_leg_id} session=${payload.call_session_id}`
        );
        break;
      default:
        console.log(`[messaging:voice] Ignoring event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`[messaging:voice] Error handling ${eventType}:`, err);
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

  const { data: twilioNumber } = await supabaseAdmin
    .from("twilio_numbers")
    .select("business_id")
    .eq("phone_number", to)
    .eq("is_active", true)
    .single();

  if (!twilioNumber) {
    console.warn(`[messaging:voice] No active business for to=${to}, rejecting call`);
    await telnyx.calls.actions.reject(callControlId, { cause: "USER_BUSY" });
    return;
  }

  const businessId = twilioNumber.business_id;
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .single();
  const businessName = business?.name ?? "us";

  const state = encodeState({ callControlId, businessId, from, businessName });
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

  const greeting = `Thanks for calling ${state.businessName}. We're unavailable right now but we'll text you right back with assistance. If you prefer not to receive messages, reply STOP to opt out. Please leave a message after the beep.`;

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
  sendMissedCallSMS(state.from, state.businessId).catch((err) => {
    console.error("[messaging:voice] sendMissedCallSMS failed:", err);
  });
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
  sendMissedCallSMS(state.from, state.businessId).catch((err) => {
    console.error("[messaging:voice] sendMissedCallSMS failed:", err);
  });
}
