import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));

import {
  claimMessagingWebhookEvent,
  completeMessagingWebhookEvent,
  markProcessedOnce,
  releaseProcessedEvent,
  releaseMessagingWebhookClaim,
} from "./idempotency";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ upsert: mocks.upsert, delete: mocks.delete });
  mocks.upsert.mockReturnValue({ select: mocks.select });
  mocks.delete.mockReturnValue({ eq: mocks.eq });
});

describe("legacy webhook claim lifecycle", () => {
  it("claims an unseen event id", async () => {
    mocks.select.mockResolvedValue({
      data: [{ event_id: "evt_1" }],
      error: null,
    });

    await expect(markProcessedOnce("evt_1")).resolves.toBe(true);
    expect(mocks.from).toHaveBeenCalledWith("processed_webhook_events");
    expect(mocks.upsert).toHaveBeenCalledWith(
      { event_id: "evt_1" },
      { onConflict: "event_id", ignoreDuplicates: true }
    );
  });

  it("returns false for an already-claimed event id", async () => {
    mocks.select.mockResolvedValue({ data: [], error: null });

    await expect(markProcessedOnce("evt_1")).resolves.toBe(false);
  });

  it("throws on a claim query error so callers fail closed", async () => {
    mocks.select.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });

    await expect(markProcessedOnce("evt_1")).rejects.toBeTruthy();
  });

  it("deletes a failed claim row by event id", async () => {
    mocks.eq.mockResolvedValue({ error: null });

    await expect(releaseProcessedEvent("evt_1")).resolves.toBeUndefined();
    expect(mocks.from).toHaveBeenCalledWith("processed_webhook_events");
    expect(mocks.delete).toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("event_id", "evt_1");
  });

  it("throws on a release error so the caller still returns non-2xx", async () => {
    mocks.eq.mockResolvedValue({ error: { message: "connection reset" } });

    await expect(releaseProcessedEvent("evt_1")).rejects.toThrow(
      /Failed to release claim for event evt_1/
    );
  });
});

describe("messaging webhook claim lifecycle", () => {
  it("returns an owned token for a newly claimed event", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: "claimed", token: "token-1" }],
      error: null,
    });

    await expect(claimMessagingWebhookEvent("event-1")).resolves.toEqual({
      outcome: "claimed",
      claimToken: "token-1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_messaging_webhook_event",
      { p_event_id: "event-1" }
    );
  });

  it.each(["in_progress", "completed"] as const)(
    "returns %s without an owner token",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({
        data: [{ outcome, token: null }],
        error: null,
      });

      await expect(claimMessagingWebhookEvent("event-1")).resolves.toEqual({
        outcome,
        claimToken: null,
      });
    }
  );

  it("fails closed when the claim result is malformed", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: "claimed", token: null }],
      error: null,
    });

    await expect(claimMessagingWebhookEvent("event-1")).rejects.toThrow(
      "invalid result"
    );
  });

  it("completes only when the database confirms token ownership", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(
      completeMessagingWebhookEvent("event-1", "token-1")
    ).resolves.toBeUndefined();
    await expect(
      completeMessagingWebhookEvent("event-1", "stale-token")
    ).rejects.toThrow("Lost completion claim");
  });

  it("releases only when the database confirms token ownership", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(
      releaseMessagingWebhookClaim("event-1", "token-1")
    ).resolves.toBeUndefined();
    await expect(
      releaseMessagingWebhookClaim("event-1", "stale-token")
    ).rejects.toThrow("Lost release claim");
  });
});
