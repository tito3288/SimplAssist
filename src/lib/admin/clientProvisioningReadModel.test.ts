import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAdminProvisioningRecord } from "./clientProvisioningReadModel";

const JOB_ID = "10000000-0000-4000-a045-000000000001";
const PARTNER_ID = "20000000-0000-4000-a045-000000000001";
const AUTH_USER_ID = "30000000-0000-4000-a045-000000000001";
const BUSINESS_ID = "40000000-0000-4000-a045-000000000001";
const OPERATION_TOKEN = "50000000-0000-4000-a045-000000000001";
const NOW = new Date("2026-08-04T12:00:00.000Z");

function storedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    email: "client@example.com",
    requested_business_name: "Example Client",
    partner_id: PARTNER_ID,
    billing_mode: "invoiced",
    partner_plan: "sms_and_chat",
    auth_user_id: null,
    business_id: null,
    status: "needs_attention",
    last_error_code: "email_in_use",
    setup_email_sent_at: null,
    invite_attempt_count: 0,
    dismissed_at: null,
    operation_token: null,
    operation_kind: null,
    operation_started_at: null,
    operation_expires_at: null,
    created_at: "2026-08-04T10:00:00.000Z",
    updated_at: "2026-08-04T11:00:00.000Z",
    ...overrides,
  };
}

function storedPartner(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_ID,
    name: "Alpha Dog Agency",
    custom_domain: "app.alphadogagency.ai",
    status: "active",
    domain_status: "connected",
    ...overrides,
  };
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    operation_token: OPERATION_TOKEN,
    operation_kind: "retry",
    operation_started_at: "2026-08-04T11:50:00.000Z",
    operation_expires_at: "2026-08-04T12:05:00.000Z",
    updated_at: "2026-08-04T11:50:00.000Z",
    ...overrides,
  };
}

describe("parseAdminProvisioningRecord", () => {
  it("uses the exact fifteen-minute pending boundary", () => {
    const atBoundary = parseAdminProvisioningRecord(
      storedJob({
        status: "pending",
        updated_at: "2026-08-04T11:45:00.000Z",
      }),
      storedPartner(),
      NOW,
    );
    const oneMillisecondRecent = parseAdminProvisioningRecord(
      storedJob({
        status: "pending",
        updated_at: "2026-08-04T11:45:00.001Z",
      }),
      storedPartner(),
      NOW,
    );

    expect(atBoundary?.dismissalState).toBe("dismissible");
    expect(oneMillisecondRecent?.dismissalState).toBe("not_dismissible");
  });

  it("distinguishes idle, active, and expired outcome-unknown operations", () => {
    expect(
      parseAdminProvisioningRecord(storedJob(), storedPartner(), NOW)
        ?.operationState,
    ).toBe("idle");

    const active = parseAdminProvisioningRecord(
      storedJob(operation()),
      storedPartner(),
      NOW,
    );
    expect(active).toMatchObject({
      operationState: "active",
      dismissalState: "in_progress",
    });

    const expiresExactlyNow = parseAdminProvisioningRecord(
      storedJob(
        operation({
          operation_started_at: "2026-08-04T11:45:00.000Z",
          operation_expires_at: "2026-08-04T12:00:00.000Z",
        }),
      ),
      storedPartner(),
      NOW,
    );
    expect(expiresExactlyNow).toMatchObject({
      operationState: "unknown",
      dismissalState: "outcome_unknown",
    });
  });

  it("accepts an expiry refreshed after durable provisioning progress", () => {
    const refreshed = parseAdminProvisioningRecord(
      storedJob(
        operation({
          operation_started_at: "2026-08-04T10:45:00.000Z",
          operation_expires_at: "2026-08-04T12:10:00.000Z",
          updated_at: "2026-08-04T11:55:00.000Z",
        }),
      ),
      storedPartner(),
      NOW,
    );

    expect(refreshed).toMatchObject({
      operationState: "active",
      dismissalState: "in_progress",
    });
  });

  it.each([
    ["partial lease", { operation_token: OPERATION_TOKEN }],
    ["missing operation kind", operation({ operation_kind: null })],
    [
      "invalid start timestamp",
      operation({ operation_started_at: "not-a-timestamp" }),
    ],
    [
      "expiry equal to start",
      operation({
        operation_started_at: "2026-08-04T11:50:00.000Z",
        operation_expires_at: "2026-08-04T11:50:00.000Z",
      }),
    ],
    [
      "operation start after the latest durable update",
      operation({
        operation_started_at: "2026-08-04T11:50:00.001Z",
        updated_at: "2026-08-04T11:50:00.000Z",
      }),
    ],
    [
      "expiry beyond the refreshed fifteen-minute bound",
      operation({
        operation_started_at: "2026-08-04T11:40:00.000Z",
        operation_expires_at: "2026-08-04T12:10:00.001Z",
        updated_at: "2026-08-04T11:55:00.000Z",
      }),
    ],
  ])("rejects a malformed %s", (_label, lease) => {
    expect(
      parseAdminProvisioningRecord(
        storedJob(lease as Record<string, unknown>),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
  });

  it("gives operation state precedence over resources, then detects each resource", () => {
    expect(
      parseAdminProvisioningRecord(
        storedJob({ auth_user_id: AUTH_USER_ID, ...operation() }),
        storedPartner(),
        NOW,
      )?.dismissalState,
    ).toBe("in_progress");

    for (const resource of [
      { auth_user_id: AUTH_USER_ID },
      { business_id: BUSINESS_ID },
      { setup_email_sent_at: "2026-08-04T11:30:00.000Z" },
    ]) {
      expect(
        parseAdminProvisioningRecord(storedJob(resource), storedPartner(), NOW)
          ?.dismissalState,
      ).toBe("has_resources");
    }
  });

  it("resolves only an exact Auth-owned business for account deletion guidance", () => {
    const authOnlyJob = storedJob({ auth_user_id: AUTH_USER_ID });
    const ownerBusiness = { id: BUSINESS_ID, owner_id: AUTH_USER_ID };

    expect(
      parseAdminProvisioningRecord(
        authOnlyJob,
        storedPartner({ status: "inactive" }),
        NOW,
        ownerBusiness,
      ),
    ).toMatchObject({
      accountBusinessId: BUSINESS_ID,
      dismissalState: "has_resources",
      partnerAvailability: "inactive",
    });
    expect(
      parseAdminProvisioningRecord(authOnlyJob, storedPartner(), NOW, {
        id: BUSINESS_ID,
        owner_id: "30000000-0000-4000-a045-000000000099",
      }),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(authOnlyJob, storedPartner(), NOW),
    ).toMatchObject({ accountBusinessId: null });
  });

  it("accepts only the complete resource-free dismissed shape", () => {
    const valid = parseAdminProvisioningRecord(
      storedJob({
        status: "dismissed",
        dismissed_at: "2026-08-04T11:30:00.000Z",
      }),
      storedPartner(),
      NOW,
    );
    expect(valid).toMatchObject({
      dismissalState: "restore",
      operationState: "idle",
      dismissedAt: "2026-08-04T11:30:00.000Z",
    });

    expect(
      parseAdminProvisioningRecord(
        storedJob({ status: "dismissed" }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(
        storedJob({ dismissed_at: "2026-08-04T11:30:00.000Z" }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(
        storedJob({
          status: "dismissed",
          dismissed_at: "2026-08-04T11:30:00.000Z",
          business_id: BUSINESS_ID,
        }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(
        storedJob({
          status: "dismissed",
          dismissed_at: "2026-08-04T11:30:00.000Z",
          ...operation(),
        }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
  });

  it.each([
    [
      "active connected",
      {},
      "active_connected",
      "https://app.alphadogagency.ai",
    ],
    ["inactive", { status: "inactive" }, "inactive", null],
    ["pending domain", { domain_status: "pending" }, "domain_pending", null],
    [
      "connected without a domain",
      { custom_domain: null },
      "unavailable",
      null,
    ],
    [
      "connected with a malformed domain",
      { custom_domain: "https://partner.example.com" },
      "unavailable",
      null,
    ],
    [
      "connected on the canonical domain",
      { custom_domain: "simplassist.com" },
      "unavailable",
      null,
    ],
  ])(
    "classifies an %s partner without hiding the job",
    (_label, partnerOverrides, availability, origin) => {
      const record = parseAdminProvisioningRecord(
        storedJob(),
        storedPartner(partnerOverrides),
        NOW,
      );
      expect(record?.partnerAvailability).toBe(availability);
      expect(record?.partnerOrigin).toBe(origin);
    },
  );

  it("sanitizes unknown stored errors and preserves the allow-listed value", () => {
    expect(
      parseAdminProvisioningRecord(
        storedJob({ last_error_code: "provider said client@example.com" }),
        storedPartner(),
        NOW,
      )?.provisioning.lastErrorCode,
    ).toBe("unknown_error");
    expect(
      parseAdminProvisioningRecord(storedJob(), storedPartner(), NOW)
        ?.provisioning.lastErrorCode,
    ).toBe("email_in_use");
  });

  it("rejects noncanonical stored identity and malformed trusted timestamps", () => {
    expect(
      parseAdminProvisioningRecord(
        storedJob({ email: "Client@example.com" }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(
        storedJob({ requested_business_name: " Example Client " }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(
        storedJob({ updated_at: "invalid" }),
        storedPartner(),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(
        storedJob(),
        storedPartner({ name: "Alpha\nDog" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseAdminProvisioningRecord(storedJob(), storedPartner(), new Date(NaN)),
    ).toBeNull();
  });

  it("never exposes operation fencing data in the public record", () => {
    const record = parseAdminProvisioningRecord(
      storedJob(operation()),
      storedPartner(),
      NOW,
    );
    expect(record).not.toBeNull();
    expect(JSON.stringify(record)).not.toContain(OPERATION_TOKEN);
    expect(JSON.stringify(record)).not.toContain("operation_started_at");
    expect(JSON.stringify(record)).not.toContain("operation_expires_at");
  });
});
