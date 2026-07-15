import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unwrap: vi.fn(),
  reject: vi.fn(),
  answer: vi.fn(),
  hangup: vi.fn(),
  speak: vi.fn(),
  startRecording: vi.fn(),
  dial: vi.fn(),
  markProcessedOnce: vi.fn(),
  releaseProcessedEvent: vi.fn(),
  sendMissedCallSMS: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    webhooks: { unwrap: mocks.unwrap },
    calls: {
      actions: {
        reject: mocks.reject,
        answer: mocks.answer,
        hangup: mocks.hangup,
        speak: mocks.speak,
        startRecording: mocks.startRecording,
        dial: mocks.dial,
      },
    },
  },
}));
vi.mock("@/lib/messaging/idempotency", async (importOriginal) => {
  // Keep the REAL RetryableWebhookError class — the route's instanceof
  // check must see the same constructor the handlers throw.
  const actual =
    await importOriginal<typeof import("@/lib/messaging/idempotency")>();
  return {
    ...actual,
    markProcessedOnce: mocks.markProcessedOnce,
    releaseProcessedEvent: mocks.releaseProcessedEvent,
  };
});
vi.mock("@/lib/messaging/missed-call", () => ({
  sendMissedCallSMS: mocks.sendMissedCallSMS,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { POST as voiceWebhook } from "./route";

const ATTEMPT = {
  id: "att_1",
  business_id: "00000000-0000-4000-8000-00000000b1z1",
  inbound_call_control_id: "cc_inbound",
  outbound_call_control_id: "cc_outbound",
  call_session_id: "sess_1",
  caller_phone: "+15745550100",
  forward_to_number: "+15745550200",
  status: "dialing",
  fallback_triggered_at: null,
};

// Chainable, awaitable supabase mock; from() consumes queued results FIFO
// and records each chain for argument assertions.
const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of [
      "select",
      "update",
      "insert",
      "eq",
      "is",
      "neq",
      "maybeSingle",
      "single",
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    chains.push(chain);
    return chain;
  });
}

function request() {
  return new NextRequest("http://localhost/api/messaging/voice", {
    method: "POST",
    body: "{}",
  });
}

function encodeState(state: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(state)).toString("base64");
}

function voiceEvent(
  eventType: string,
  payload: Record<string, unknown>,
  id = `evt_voice_${eventType.replaceAll(".", "_")}`
) {
  return { data: { id, event_type: eventType, payload } };
}

const HANGUP_STATE = encodeState({
  callControlId: "cc_inbound",
  businessId: ATTEMPT.business_id,
  from: ATTEMPT.caller_phone,
  businessName: "Test Biz",
  forwardingRole: "inbound",
  forwardingAttemptId: ATTEMPT.id,
});

const RECORDING_STATE = encodeState({
  callControlId: "cc_inbound",
  businessId: ATTEMPT.business_id,
  from: ATTEMPT.caller_phone,
  businessName: "Test Biz",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.markProcessedOnce.mockResolvedValue(true);
  mocks.releaseProcessedEvent.mockResolvedValue(undefined);
  mocks.sendMissedCallSMS.mockResolvedValue(undefined);
  mocks.hangup.mockResolvedValue({});
  mocks.reject.mockResolvedValue({});
  queueResults();
});

describe("POST /api/messaging/voice", () => {
  it("sends the fallback SMS and keeps the claim on success", async () => {
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.hangup", {
        call_control_id: "cc_inbound",
        client_state: HANGUP_STATE,
        hangup_cause: "originator_cancel",
      })
    );
    queueResults(
      { data: ATTEMPT, error: null }, // getForwardingAttemptById
      { data: { ...ATTEMPT, status: "abandoned" }, error: null } // fallback claim
    );

    const response = await voiceWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.sendMissedCallSMS).toHaveBeenCalledWith(
      ATTEMPT.caller_phone,
      ATTEMPT.business_id
    );
    expect(mocks.releaseProcessedEvent).not.toHaveBeenCalled();
  });

  it("re-opens the fallback claim, releases the event, and 500s when the SMS send fails", async () => {
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.hangup", {
        call_control_id: "cc_inbound",
        client_state: HANGUP_STATE,
        hangup_cause: "originator_cancel",
      })
    );
    queueResults(
      { data: ATTEMPT, error: null }, // getForwardingAttemptById
      { data: { ...ATTEMPT, status: "abandoned" }, error: null }, // fallback claim
      { error: null } // re-open update
    );
    mocks.sendMissedCallSMS.mockRejectedValue(new Error("telnyx unreachable"));

    const response = await voiceWebhook(request());

    expect(response.status).toBe(500);
    // The re-open write: status 'error' + cleared claim timestamp so the
    // redelivered hangup re-enters the fallback and re-sends.
    const reopenChain = chains[2];
    expect(reopenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", fallback_triggered_at: null })
    );
    expect(mocks.releaseProcessedEvent).toHaveBeenCalledWith(
      "evt_voice_call_hangup"
    );
  });

  it("releases and 500s when the fallback claim query errors", async () => {
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.hangup", {
        call_control_id: "cc_inbound",
        client_state: HANGUP_STATE,
        hangup_cause: "originator_cancel",
      })
    );
    queueResults(
      { data: ATTEMPT, error: null },
      { data: null, error: { message: "connection reset" } } // claim errors
    );

    const response = await voiceWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.sendMissedCallSMS).not.toHaveBeenCalled();
    expect(mocks.releaseProcessedEvent).toHaveBeenCalled();
  });

  it("releases and 500s when the voicemail-path SMS fails on recording.saved", async () => {
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.recording.saved", {
        client_state: RECORDING_STATE,
        recording_urls: { mp3: "https://example.test/rec.mp3" },
      })
    );
    mocks.sendMissedCallSMS.mockRejectedValue(new Error("telnyx unreachable"));

    const response = await voiceWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.releaseProcessedEvent).toHaveBeenCalledWith(
      "evt_voice_call_recording_saved"
    );
  });

  it("keeps the log-and-ack swallow for real-time call-control failures", async () => {
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.initiated", {
        direction: "incoming",
        from: "+15745550100",
        to: "+15745550300",
        call_control_id: "cc_rt",
      })
    );
    queueResults({ data: null, error: null }); // no active phone number row
    mocks.reject.mockRejectedValue(new Error("verb failed"));

    const response = await voiceWebhook(request());

    // Retrying answer()/reject() seconds later on a dead call cannot help:
    // real-time verbs ack 200 and keep the claim.
    expect(response.status).toBe(200);
    expect(mocks.releaseProcessedEvent).not.toHaveBeenCalled();
  });

  it("honors RetryableWebhookError from a non-durable event type (bridged connected-mark failure)", async () => {
    // Durability is a property of the side effect: call.bridged is not in
    // DURABLE_EVENT_TYPES, but a failed connected-mark must retry (a lost
    // mark makes a later hangup fire a spurious missed-call SMS).
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.bridged", {
        call_control_id: "cc_outbound",
        client_state: HANGUP_STATE,
      })
    );
    queueResults(
      { data: ATTEMPT, error: null }, // getForwardingAttemptById
      { data: null, error: { message: "connection reset" } } // connected-mark
    );

    const response = await voiceWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.releaseProcessedEvent).toHaveBeenCalledWith(
      "evt_voice_call_bridged"
    );
  });

  it("dedups duplicate voice events without running handlers", async () => {
    mocks.unwrap.mockResolvedValue(
      voiceEvent("call.hangup", { call_control_id: "cc_inbound" })
    );
    mocks.markProcessedOnce.mockResolvedValue(false);

    const response = await voiceWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
