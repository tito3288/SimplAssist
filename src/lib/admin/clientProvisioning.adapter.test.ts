import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  createUser: vi.fn(),
  partnerRead: vi.fn(),
  jobInsert: vi.fn(),
  updatePayload: null as Record<string, unknown> | null,
  updateFilters: [] as Array<[string, string]>,
  updateRange: null as [string, string] | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/conciergeSetup", () => ({
  sendConciergeSetupEmail: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
    auth: {
      admin: {
        createUser: mocks.createUser,
      },
    },
  },
}));

import {
  ClientProvisioningError,
  provisionPartnerClient,
} from "./clientProvisioning.server";

const JOB_ID = "10000000-0000-4000-a000-000000000001";
const PARTNER_ID = "20000000-0000-4000-a000-000000000001";
const USER_ID = "30000000-0000-4000-a000-000000000001";
const ADMIN_ID = "50000000-0000-4000-a000-000000000001";
const NOW = "2026-08-03T12:00:00.000Z";

function storedJob(operation: {
  token: string | null;
  kind: "provision" | "retry" | "send_setup" | null;
}) {
  return {
    id: JOB_ID,
    email: "client@example.com",
    requested_business_name: "Tidy Dogs",
    partner_id: PARTNER_ID,
    billing_mode: "invoiced",
    partner_plan: "sms_and_chat",
    auth_user_id: null,
    business_id: null,
    status: "pending",
    last_error_code: null,
    setup_email_sent_at: null,
    invite_attempt_count: 0,
    dismissed_at: null,
    dismissed_by_admin_id: null,
    operation_token: operation.token,
    operation_kind: operation.kind,
    operation_started_at: operation.token ? NOW : null,
    operation_expires_at: operation.token ? "2026-08-03T12:15:00.000Z" : null,
    created_by_admin_id: ADMIN_ID,
    created_at: NOW,
    updated_at: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updatePayload = null;
  mocks.updateFilters = [];
  mocks.updateRange = null;

  mocks.partnerRead.mockResolvedValue({
    data: {
      id: PARTNER_ID,
      name: "Alpha Dog Agency",
      custom_domain: "app.alphadogagency.ai",
      status: "active",
      domain_status: "connected",
    },
    error: null,
  });
  mocks.jobInsert.mockResolvedValue({
    data: storedJob({ token: null, kind: null }),
    error: null,
  });
  mocks.rpc.mockImplementation(
    async (_name: string, args: Record<string, unknown>) => ({
      data: storedJob({
        token: String(args.p_operation_token),
        kind: args.p_operation_kind as "provision",
      }),
      error: null,
    }),
  );
  mocks.createUser.mockResolvedValue({
    data: {
      user: {
        id: USER_ID,
        email: "client@example.com",
        email_confirmed_at: NOW,
        app_metadata: {
          concierge_provisioning_id: JOB_ID,
          must_set_password: true,
        },
      },
    },
    error: null,
  });

  mocks.from.mockImplementation((table: string) => {
    if (table === "partners") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: mocks.partnerRead })),
        })),
      };
    }
    if (table === "partner_client_provisioning_jobs") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({ single: mocks.jobInsert })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          mocks.updatePayload = payload;
          const builder = {
            eq: vi.fn((field: string, value: string) => {
              mocks.updateFilters.push([field, value]);
              return builder;
            }),
            gt: vi.fn((field: string, value: string) => {
              mocks.updateRange = [field, value];
              return builder;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          };
          return builder;
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
});

describe("client provisioning Supabase adapter", () => {
  it("claims before Auth and fences the first write by token and live expiry", async () => {
    let caught: unknown;
    try {
      await provisionPartnerClient(
        {
          email: "client@example.com",
          businessName: "Tidy Dogs",
          partnerId: PARTNER_ID,
          billingMode: "invoiced",
          partnerPlan: "sms_and_chat",
          sendSetupEmailNow: false,
        },
        ADMIN_ID,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ClientProvisioningError);
    expect(caught).toMatchObject({
      code: "provisioning_outcome_unknown",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_partner_client_provisioning_operation",
      expect.objectContaining({
        p_job_id: JOB_ID,
        p_operation_kind: "provision",
        p_reconciled_operation_token: null,
        p_operation_token: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        p_now: expect.any(String),
      }),
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createUser.mock.invocationCallOrder[0],
    );

    const token = String(mocks.rpc.mock.calls[0][1].p_operation_token);
    expect(mocks.updateFilters).toEqual([
      ["id", JOB_ID],
      ["operation_token", token],
    ]);
    expect(mocks.updateRange?.[0]).toBe("operation_expires_at");
    expect(mocks.updatePayload).toMatchObject({
      auth_user_id: USER_ID,
      status: "auth_created",
      last_error_code: null,
      operation_expires_at: expect.any(String),
    });
    expect(JSON.stringify(caught)).not.toContain(token);
  });
});
