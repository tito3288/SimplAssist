import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  recordWidgetOfflineLead,
  WidgetOfflineLeadConflictError,
  WidgetOfflineLeadStateError,
} from "./offlineLead.server";

const INPUT = {
  businessId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  clientLeadId: "00000000-0000-4000-8000-000000000003",
  sourceClientMessageId: "00000000-0000-4000-8000-000000000004",
  message: "Can someone help me tomorrow?",
  visitorName: "Pat",
  visitorEmail: "pat@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({
    data: "00000000-0000-4000-8000-000000000005",
    error: null,
  });
});

describe("recordWidgetOfflineLead", () => {
  it("sends only normalized contact fields and content-free proofs", async () => {
    await expect(recordWidgetOfflineLead(INPUT)).resolves.toBe(
      "00000000-0000-4000-8000-000000000005",
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_widget_offline_lead",
      expect.objectContaining({
        p_business_id: INPUT.businessId,
        p_session_id: INPUT.sessionId,
        p_client_lead_id: INPUT.clientLeadId,
        p_contact_name: "Pat",
        p_contact_email: "pat@example.com",
        p_source_provider_event_id: expect.stringMatching(
          /^widget:[0-9a-f]{64}$/,
        ),
        p_source_message_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_submission_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    const rpcInput = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.values(rpcInput)).not.toContain(INPUT.message);
  });

  it("maps an idempotency collision to a non-retryable conflict", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "widget_offline_lead_idempotency_conflict" },
    });

    await expect(recordWidgetOfflineLead(INPUT)).rejects.toBeInstanceOf(
      WidgetOfflineLeadConflictError,
    );
  });

  it("fails malformed and unavailable database responses closed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "not-a-uuid", error: null });
    await expect(recordWidgetOfflineLead(INPUT)).rejects.toBeInstanceOf(
      WidgetOfflineLeadStateError,
    );

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(recordWidgetOfflineLead(INPUT)).rejects.toBeInstanceOf(
      WidgetOfflineLeadStateError,
    );
  });
});
