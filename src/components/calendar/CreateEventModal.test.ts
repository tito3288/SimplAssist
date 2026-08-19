import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventCreationStateFromApiFailure } from "./CreateEventModal";

describe("CreateEventModal operational failures", () => {
  it.each(["account_suspended", "bookings_paused"] as const)(
    "maps the private-safe 403 %s response to a disabled creation state",
    (reason) => {
      expect(
        eventCreationStateFromApiFailure(403, {
          error: "booking_creation_unavailable",
          reason,
        })
      ).toBe(reason);
    }
  );

  it("maps retryable state uncertainty to generic unavailable context", () => {
    expect(
      eventCreationStateFromApiFailure(503, {
        error: "service_state_unavailable",
        retryable: true,
      })
    ).toBe("state_unavailable");
  });

  it.each([
    [403, { error: "booking_creation_unavailable", reason: "private_reason" }],
    [403, { error: "some_other_error", reason: "bookings_paused" }],
    [503, { error: "service_state_unavailable", retryable: false }],
    [500, { error: "booking_creation_unavailable", reason: "bookings_paused" }],
    [503, null],
  ])("does not promote an unrecognized %s payload", (status, payload) => {
    expect(eventCreationStateFromApiFailure(status, payload)).toBeNull();
  });

  it("never renders API machine codes as form errors", () => {
    const source = readFileSync(
      new URL("./CreateEventModal.tsx", import.meta.url),
      "utf8"
    );

    expect(source).not.toContain("data.error");
    expect(source).toContain(
      'setError("We couldn\'t create this event. Please try again.")'
    );
    expect(source).toContain("onCreationUnavailable(unavailableState)");
  });

  it("sends one stable operation identity with the canonical payload", () => {
    const source = readFileSync(
      new URL("./CreateEventModal.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("nextCalendarMutationOperationId(");
    expect(source).toContain("operationId: operationIdRef.current");
    expect(source).toContain("submittedPayloadRef.current = payloadKey");
  });
});
