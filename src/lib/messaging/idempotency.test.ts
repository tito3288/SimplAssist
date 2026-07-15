import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { markProcessedOnce, releaseProcessedEvent } from "./idempotency";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ upsert: mocks.upsert, delete: mocks.delete });
  mocks.upsert.mockReturnValue({ select: mocks.select });
  mocks.delete.mockReturnValue({ eq: mocks.eq });
});

describe("markProcessedOnce", () => {
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
});

describe("releaseProcessedEvent", () => {
  it("deletes the claim row by event id", async () => {
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
