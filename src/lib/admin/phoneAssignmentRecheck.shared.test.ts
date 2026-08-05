import { describe, expect, it } from "vitest";
import {
  adminPhoneAssignmentRecheckAuditResultSchema,
  adminPhoneAssignmentRecheckRequestSchema,
  adminPhoneAssignmentRecheckResponseSchema,
} from "./phoneAssignmentRecheck.shared";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const EVENT_ID = "20000000-0000-4000-a000-000000000001";
const REQUESTED_AT = "2026-08-05T12:34:56.123Z";

describe("adminPhoneAssignmentRecheckRequestSchema", () => {
  it("accepts only the empty request object", () => {
    expect(adminPhoneAssignmentRecheckRequestSchema.parse({})).toEqual({});
  });

  it.each([
    null,
    [],
    "{}",
    { requested: true },
    { reason: "Retry the assignment" },
    { actorAdminUserId: EVENT_ID },
    { p_actor_admin_user_id: EVENT_ID },
    { businessId: BUSINESS_ID },
  ])("rejects malformed or client-controlled input: %j", (request) => {
    expect(
      adminPhoneAssignmentRecheckRequestSchema.safeParse(request).success,
    ).toBe(false);
  });
});

describe("adminPhoneAssignmentRecheckResponseSchema", () => {
  it("accepts only the exact acceptance response", () => {
    expect(
      adminPhoneAssignmentRecheckResponseSchema.parse({ requested: true }),
    ).toEqual({ requested: true });
  });

  it.each([
    null,
    {},
    { requested: false },
    { requested: true, businessId: BUSINESS_ID },
    { requested: true, adminEventId: EVENT_ID },
    { requested: true, requestedAt: REQUESTED_AT },
  ])("rejects a non-contract response: %j", (response) => {
    expect(
      adminPhoneAssignmentRecheckResponseSchema.safeParse(response).success,
    ).toBe(false);
  });
});

describe("adminPhoneAssignmentRecheckAuditResultSchema", () => {
  const auditResult = {
    business_id: BUSINESS_ID,
    admin_event_id: EVENT_ID,
    requested_at: REQUESTED_AT,
  };

  it("accepts the exact RPC audit result", () => {
    expect(
      adminPhoneAssignmentRecheckAuditResultSchema.parse(auditResult),
    ).toEqual(auditResult);
  });

  it.each([
    null,
    {},
    { ...auditResult, admin_event_id: "not-a-uuid" },
    { ...auditResult, requested_at: "2026-08-05T12:34:56" },
    { ...auditResult, provider_id: "provider-secret" },
  ])("rejects an incomplete, malformed, or extra-field RPC result: %j", (result) => {
    expect(
      adminPhoneAssignmentRecheckAuditResultSchema.safeParse(result).success,
    ).toBe(false);
  });
});
