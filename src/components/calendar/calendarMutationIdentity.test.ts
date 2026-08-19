import { describe, expect, it, vi } from "vitest";
import { nextCalendarMutationOperationId } from "./calendarMutationIdentity";

describe("calendar mutation client identity", () => {
  it("retains the exact operation ID for an unchanged retry", () => {
    const createId = vi.fn(() => "new-id");
    expect(
      nextCalendarMutationOperationId(
        "stable-id",
        '{"title":"Estimate"}',
        '{"title":"Estimate"}',
        createId
      )
    ).toBe("stable-id");
    expect(createId).not.toHaveBeenCalled();
  });

  it("rotates identity when the immutable submitted payload changes", () => {
    expect(
      nextCalendarMutationOperationId(
        "old-id",
        '{"title":"Estimate"}',
        '{"title":"Consultation"}',
        () => "new-id"
      )
    ).toBe("new-id");
  });

  it("creates an identity when a modal has none", () => {
    expect(
      nextCalendarMutationOperationId("", null, "payload", () => "new-id")
    ).toBe("new-id");
  });
});
