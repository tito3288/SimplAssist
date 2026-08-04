import { describe, expect, it } from "vitest";
import { getAdminBusinessLifecycle } from "./accountLifecycle";

describe("getAdminBusinessLifecycle", () => {
  it("classifies an untouched account as active", () => {
    expect(
      getAdminBusinessLifecycle({
        deletedAt: null,
        deletionScheduledFor: null,
      }),
    ).toBe("active");
  });

  it("classifies an account with both deletion timestamps as scheduled", () => {
    expect(
      getAdminBusinessLifecycle({
        deletedAt: "2026-08-04T12:00:00.000Z",
        deletionScheduledFor: "2026-10-03T12:00:00.000Z",
      }),
    ).toBe("scheduled");
  });

  it("classifies a scrubbed tombstone as terminal", () => {
    expect(
      getAdminBusinessLifecycle({
        deletedAt: "2026-08-04T12:00:00.000Z",
        deletionScheduledFor: null,
      }),
    ).toBe("terminal");
  });

  it("fails closed when a schedule exists without a deletion timestamp", () => {
    expect(
      getAdminBusinessLifecycle({
        deletedAt: null,
        deletionScheduledFor: "2026-10-03T12:00:00.000Z",
      }),
    ).toBe("terminal");
  });
});
