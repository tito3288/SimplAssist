import { describe, expect, it } from "vitest";
import {
  adminAccountServiceControlRequestSchema,
  adminAccountServiceControlResponseSchema,
  adminOperationalControlSnapshotSchema,
  adminServiceControlReasonSchema,
} from "./accountServiceControls.shared";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const EVENT_ID = "20000000-0000-4000-a000-000000000001";
const VALID_REASON = "Account review requires a temporary hold";
const ACTIVE_CONTROLS = {
  businessId: BUSINESS_ID,
  operationsSuspendedAt: null,
  aiRepliesPausedAt: null,
  textingPausedAt: null,
  bookingsPausedAt: null,
};

describe("adminServiceControlReasonSchema", () => {
  it("exports the canonical trimmed admin-reason contract for reuse", () => {
    expect(adminServiceControlReasonSchema.parse(`  ${VALID_REASON}  `)).toBe(
      VALID_REASON,
    );
  });

  it("retains the Unicode-aware bounds and control-character rejection", () => {
    expect(adminServiceControlReasonSchema.safeParse("12345678").success).toBe(
      true,
    );
    expect(
      adminServiceControlReasonSchema.safeParse("😀".repeat(500)).success,
    ).toBe(true);
    expect(adminServiceControlReasonSchema.safeParse("1234567").success).toBe(
      false,
    );
    expect(
      adminServiceControlReasonSchema.safeParse("😀".repeat(501)).success,
    ).toBe(false);
    expect(
      adminServiceControlReasonSchema.safeParse(`${VALID_REASON}\nmore`).success,
    ).toBe(false);
  });
});

describe("adminAccountServiceControlRequestSchema", () => {
  it.each(["suspend", "reactivate"] as const)(
    "accepts %s with a required trimmed reason",
    (action) => {
      expect(
        adminAccountServiceControlRequestSchema.parse({
          action,
          reason: `  ${VALID_REASON}  `,
        }),
      ).toEqual({ action, reason: VALID_REASON });
    },
  );

  it.each(["pause", "resume"] as const)(
    "accepts %s for every service with or without a reason",
    (action) => {
      for (const service of ["ai_replies", "texting", "bookings"] as const) {
        expect(
          adminAccountServiceControlRequestSchema.parse({ action, service }),
        ).toEqual({ action, service });
        expect(
          adminAccountServiceControlRequestSchema.parse({
            action,
            service,
            reason: ` ${VALID_REASON} `,
          }),
        ).toEqual({ action, service, reason: VALID_REASON });
      }
    },
  );

  it("enforces the trimmed 8-to-500-character reason boundaries", () => {
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: "12345678",
      }).success,
    ).toBe(true);
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: "x".repeat(500),
      }).success,
    ).toBe(true);
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: " 1234567 ",
      }).success,
    ).toBe(false);
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: ` ${"x".repeat(501)} `,
      }).success,
    ).toBe(false);
  });

  it("counts Unicode code points the same way PostgreSQL char_length does", () => {
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: "😀".repeat(500),
      }).success,
    ).toBe(true);
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: "😀".repeat(501),
      }).success,
    ).toBe(false);
  });

  it.each(["\u0000", "\n", "\t", "\u007f", "\u0085"])(
    "rejects control character %j before trimming",
    (control) => {
      expect(
        adminAccountServiceControlRequestSchema.safeParse({
          action: "suspend",
          reason: `${VALID_REASON}${control}`,
        }).success,
      ).toBe(false);
      expect(
        adminAccountServiceControlRequestSchema.safeParse({
          action: "pause",
          service: "texting",
          reason: `${control}${VALID_REASON}`,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    null,
    [],
    {},
    { action: "suspend" },
    { action: "reactivate", reason: "short" },
    { action: "pause" },
    { action: "pause", service: "email" },
    { action: "resume", service: "texting", reason: "" },
    { action: "delete", reason: VALID_REASON },
  ])("rejects a malformed request: %j", (request) => {
    expect(
      adminAccountServiceControlRequestSchema.safeParse(request).success,
    ).toBe(false);
  });

  it.each([
    ["actor", "attacker"],
    ["actorAdminUserId", "30000000-0000-4000-a000-000000000001"],
    ["p_actor_admin_user_id", "30000000-0000-4000-a000-000000000001"],
    ["summary", { reason: VALID_REASON }],
  ])("rejects the extra client-controlled key %s", (key, value) => {
    expect(
      adminAccountServiceControlRequestSchema.safeParse({
        action: "suspend",
        reason: VALID_REASON,
        [key]: value,
      }).success,
    ).toBe(false);
  });
});

describe("admin operational-control response schemas", () => {
  it("accepts a complete strict snapshot with timezone-qualified timestamps", () => {
    expect(
      adminOperationalControlSnapshotSchema.parse({
        ...ACTIVE_CONTROLS,
        operationsSuspendedAt: "2026-08-04T12:00:00Z",
        aiRepliesPausedAt: "2026-08-04T12:01:00.123456+00:00",
        textingPausedAt: "2026-08-04T12:02:00-05:00",
      }),
    ).toEqual({
      ...ACTIVE_CONTROLS,
      operationsSuspendedAt: "2026-08-04T12:00:00Z",
      aiRepliesPausedAt: "2026-08-04T12:01:00.123456+00:00",
      textingPausedAt: "2026-08-04T12:02:00-05:00",
    });
  });

  it("accepts changed and unchanged responses with matching audit identity", () => {
    expect(
      adminAccountServiceControlResponseSchema.safeParse({
        changed: true,
        adminEventId: EVENT_ID,
        controls: ACTIVE_CONTROLS,
      }).success,
    ).toBe(true);
    expect(
      adminAccountServiceControlResponseSchema.safeParse({
        changed: false,
        adminEventId: null,
        controls: ACTIVE_CONTROLS,
      }).success,
    ).toBe(true);
  });

  it.each([
    { changed: true, adminEventId: null },
    { changed: false, adminEventId: EVENT_ID },
  ])("rejects an inconsistent audit result: %j", (result) => {
    expect(
      adminAccountServiceControlResponseSchema.safeParse({
        ...result,
        controls: ACTIVE_CONTROLS,
      }).success,
    ).toBe(false);
  });

  it("rejects missing, extra, and ambiguous snapshot fields", () => {
    expect(
      adminOperationalControlSnapshotSchema.safeParse({
        ...ACTIVE_CONTROLS,
        reason: VALID_REASON,
      }).success,
    ).toBe(false);
    expect(
      adminOperationalControlSnapshotSchema.safeParse({
        ...ACTIVE_CONTROLS,
        businessId: undefined,
      }).success,
    ).toBe(false);
    expect(
      adminOperationalControlSnapshotSchema.safeParse({
        ...ACTIVE_CONTROLS,
        bookingsPausedAt: "2026-08-04T12:00:00",
      }).success,
    ).toBe(false);
  });
});
