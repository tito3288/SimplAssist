import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}));

import {
  appendRegistrationEvent,
  appendRegistrationEventOrThrow,
  type AppendRegistrationEventInput,
} from "./audit";

const EVENT: AppendRegistrationEventInput = {
  businessId: "ea848911-ef72-44a6-8cf3-c47b3959be26",
  eventType: "campaign_status_refreshed",
  resourceType: "campaign",
  resourceId: "4b30019f-8814-cb6c-1e77-950fa70e0410",
  status: "approved",
  rawPayload: { source: "customer_refresh" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.insert.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("registration audit writes", () => {
  it("preserves the existing best-effort behavior", async () => {
    mocks.insert.mockResolvedValue({
      error: { message: "audit unavailable" },
    });

    await expect(appendRegistrationEvent(EVENT)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });

  it("offers a strict variant for mutation-before-assignment ordering", async () => {
    mocks.insert.mockResolvedValue({
      error: { message: "audit unavailable" },
    });

    await expect(appendRegistrationEventOrThrow(EVENT)).rejects.toThrow(
      "audit unavailable"
    );
  });

  it("writes the same allowlisted event shape in either mode", async () => {
    await appendRegistrationEventOrThrow(EVENT);

    expect(mocks.from).toHaveBeenCalledWith("telnyx_registration_events");
    expect(mocks.insert).toHaveBeenCalledWith({
      business_id: EVENT.businessId,
      event_type: EVENT.eventType,
      telnyx_resource_type: EVENT.resourceType,
      telnyx_resource_id: EVENT.resourceId,
      status: EVENT.status,
      rejection_reason: null,
      raw_payload: EVENT.rawPayload,
    });
  });
});
