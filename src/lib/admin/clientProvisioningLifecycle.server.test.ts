import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import {
  ProvisioningLifecycleError,
  dismissAdminProvisioningJob,
  listAdminProvisioningRecords,
  loadAdminProvisioningRecord,
  restoreAdminProvisioningJob,
} from "./clientProvisioningLifecycle.server";

const JOB_ID = "10000000-0000-4000-a045-000000000001";
const OTHER_JOB_ID = "10000000-0000-4000-a045-000000000002";
const PARTNER_ID = "20000000-0000-4000-a045-000000000001";
const AUTH_USER_ID = "30000000-0000-4000-a045-000000000001";
const BUSINESS_ID = "40000000-0000-4000-a045-000000000001";
const ADMIN_ID = "90000000-0000-4000-a045-000000000001";
const SECRET_TOKEN = "50000000-0000-4000-a045-000000000001";
const NOW = new Date("2026-08-04T12:00:00.000Z");

type QueryResult = { data: unknown; error: unknown };

let jobsListResult: QueryResult;
let partnersListResult: QueryResult;
let businessesListResult: QueryResult;
let jobSingleResult: QueryResult;
let partnerSingleResult: QueryResult;
let jobsQuery: {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: PromiseLike<unknown>["then"];
};
let partnersQuery: {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};
let businessesQuery: {
  select: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
};

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

function rpcResultRow(status: "dismissed" | "needs_attention") {
  return {
    ...storedJob({ status }),
    dismissed_at: status === "dismissed" ? "2026-08-04T12:00:00.000Z" : null,
    operation_token: SECRET_TOKEN,
    operation_kind: "retry",
    operation_started_at: "2026-08-04T11:45:00.000Z",
    operation_expires_at: "2026-08-04T12:00:00.000Z",
    dismissed_by_admin_id: ADMIN_ID,
    created_by_admin_id: ADMIN_ID,
    provider_error: "client@example.com must never escape",
  };
}

function createQueries() {
  const mutableJobsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    then: undefined as unknown as PromiseLike<unknown>["then"],
  };
  mutableJobsQuery.select.mockReturnValue(mutableJobsQuery);
  mutableJobsQuery.eq.mockReturnValue(mutableJobsQuery);
  mutableJobsQuery.neq.mockReturnValue(mutableJobsQuery);
  mutableJobsQuery.order.mockReturnValue(mutableJobsQuery);
  mutableJobsQuery.maybeSingle.mockImplementation(async () => jobSingleResult);
  mutableJobsQuery.then = (onfulfilled, onrejected) =>
    Promise.resolve(jobsListResult).then(onfulfilled, onrejected);
  jobsQuery = mutableJobsQuery;

  const mutablePartnersQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(),
  };
  mutablePartnersQuery.select.mockReturnValue(mutablePartnersQuery);
  mutablePartnersQuery.eq.mockReturnValue(mutablePartnersQuery);
  mutablePartnersQuery.in.mockImplementation(async () => partnersListResult);
  mutablePartnersQuery.maybeSingle.mockImplementation(
    async () => partnerSingleResult,
  );
  partnersQuery = mutablePartnersQuery;

  const mutableBusinessesQuery = {
    select: vi.fn(),
    in: vi.fn(),
  };
  mutableBusinessesQuery.select.mockReturnValue(mutableBusinessesQuery);
  mutableBusinessesQuery.in.mockImplementation(async () =>
    Promise.resolve(businessesListResult),
  );
  businessesQuery = mutableBusinessesQuery;

  mocks.from.mockImplementation((table: string) => {
    if (table === "partner_client_provisioning_jobs") return jobsQuery;
    if (table === "partners") return partnersQuery;
    if (table === "businesses") return businessesQuery;
    throw new Error(`Unexpected table: ${table}`);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  jobsListResult = { data: [storedJob()], error: null };
  partnersListResult = { data: [storedPartner()], error: null };
  businessesListResult = { data: [], error: null };
  jobSingleResult = { data: storedJob(), error: null };
  partnerSingleResult = { data: storedPartner(), error: null };
  mocks.rpc.mockResolvedValue({
    data: rpcResultRow("dismissed"),
    error: null,
  });
  createQueries();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("provisioning queue reads", () => {
  it("applies the current filter and stable order, deduplicates partners, and counts invalid rows", async () => {
    jobsListResult = {
      data: [
        storedJob(),
        storedJob({ id: OTHER_JOB_ID, email: "Client@example.com" }),
      ],
      error: null,
    };

    const result = await listAdminProvisioningRecords("current");

    expect(jobsQuery.neq).toHaveBeenCalledWith("status", "dismissed");
    expect(jobsQuery.eq).not.toHaveBeenCalledWith("status", "dismissed");
    expect(jobsQuery.order).toHaveBeenNthCalledWith(1, "updated_at", {
      ascending: false,
    });
    expect(jobsQuery.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: true,
    });
    expect(partnersQuery.in).toHaveBeenCalledWith("id", [PARTNER_ID]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.provisioning.id).toBe(JOB_ID);
    expect(result.invalidRecordCount).toBe(1);
  });

  it("uses the exact dismissed-only history filter", async () => {
    jobsListResult = {
      data: [
        storedJob({
          status: "dismissed",
          dismissed_at: "2026-08-04T11:30:00.000Z",
        }),
      ],
      error: null,
    };

    const result = await listAdminProvisioningRecords("dismissed");

    expect(jobsQuery.eq).toHaveBeenCalledWith("status", "dismissed");
    expect(jobsQuery.neq).not.toHaveBeenCalled();
    expect(result.records[0]).toMatchObject({
      dismissalState: "restore",
      dismissedAt: "2026-08-04T11:30:00.000Z",
    });
  });

  it("does not query partners for an empty queue", async () => {
    jobsListResult = { data: [], error: null };

    await expect(listAdminProvisioningRecords("current")).resolves.toEqual({
      records: [],
      invalidRecordCount: 0,
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(partnersQuery.in).not.toHaveBeenCalled();
  });

  it("counts a missing or malformed partner as an invalid record", async () => {
    partnersListResult = { data: [], error: null };
    await expect(listAdminProvisioningRecords("current")).resolves.toEqual({
      records: [],
      invalidRecordCount: 1,
    });
  });

  it("loads inactive and pending partners without operational filters", async () => {
    partnerSingleResult = {
      data: storedPartner({ status: "inactive", domain_status: "pending" }),
      error: null,
    };

    const result = await loadAdminProvisioningRecord(JOB_ID);

    expect(jobsQuery.eq).toHaveBeenCalledWith("id", JOB_ID);
    expect(partnersQuery.eq).toHaveBeenCalledWith("id", PARTNER_ID);
    expect(partnersQuery.eq).not.toHaveBeenCalledWith("status", "active");
    expect(partnersQuery.eq).not.toHaveBeenCalledWith(
      "domain_status",
      "connected",
    );
    expect(result?.partnerAvailability).toBe("inactive");
    expect(result?.partnerOrigin).toBeNull();
  });

  it("finds exactly one Auth-owned business for an inactive partial job", async () => {
    jobSingleResult = {
      data: storedJob({ auth_user_id: AUTH_USER_ID }),
      error: null,
    };
    partnerSingleResult = {
      data: storedPartner({ status: "inactive" }),
      error: null,
    };
    businessesListResult = {
      data: [{ id: BUSINESS_ID, owner_id: AUTH_USER_ID }],
      error: null,
    };

    const result = await loadAdminProvisioningRecord(JOB_ID);

    expect(businessesQuery.in).toHaveBeenCalledWith("owner_id", [AUTH_USER_ID]);
    expect(result).toMatchObject({
      accountBusinessId: BUSINESS_ID,
      dismissalState: "has_resources",
      partnerAvailability: "inactive",
    });
  });

  it("fails closed on ambiguous Auth-owned businesses", async () => {
    jobSingleResult = {
      data: storedJob({ auth_user_id: AUTH_USER_ID }),
      error: null,
    };
    businessesListResult = {
      data: [
        { id: BUSINESS_ID, owner_id: AUTH_USER_ID },
        {
          id: "40000000-0000-4000-a045-000000000002",
          owner_id: AUTH_USER_ID,
        },
      ],
      error: null,
    };

    await expect(loadAdminProvisioningRecord(JOB_ID)).resolves.toMatchObject({
      accountBusinessId: null,
      dismissalState: "has_resources",
    });
  });

  it("returns null for missing or invalid detail records and sanitizes read failures", async () => {
    jobSingleResult = { data: null, error: null };
    await expect(loadAdminProvisioningRecord(JOB_ID)).resolves.toBeNull();

    jobSingleResult = {
      data: null,
      error: { message: "private client@example.com" },
    };
    await expect(loadAdminProvisioningRecord(JOB_ID)).rejects.toThrow(
      "Could not load the provisioning job",
    );
  });
});

describe("provisioning lifecycle RPC adapters", () => {
  it("calls dismissal with exact server-owned arguments and returns only minimal state", async () => {
    const result = await dismissAdminProvisioningJob(JOB_ID, ADMIN_ID);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "dismiss_partner_client_provisioning_job",
      {
        p_job_id: JOB_ID,
        p_admin_user_id: ADMIN_ID,
      },
    );
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_now");
    expect(result).toEqual({ provisioningId: JOB_ID, status: "dismissed" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized).not.toContain("client@example.com");
    expect(Object.keys(result).sort()).toEqual(["provisioningId", "status"]);
  });

  it("calls restore with exact arguments and accepts the idempotent needs-attention result", async () => {
    mocks.rpc.mockResolvedValue({
      data: [rpcResultRow("needs_attention")],
      error: null,
    });

    await expect(
      restoreAdminProvisioningJob(JOB_ID, ADMIN_ID),
    ).resolves.toEqual({
      provisioningId: JOB_ID,
      status: "needs_attention",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "restore_partner_client_provisioning_job",
      {
        p_job_id: JOB_ID,
        p_admin_user_id: ADMIN_ID,
      },
    );
  });

  it("accepts the idempotent dismissed result without exposing the composite row", async () => {
    mocks.rpc.mockResolvedValue({
      data: [rpcResultRow("dismissed")],
      error: null,
    });
    await expect(
      dismissAdminProvisioningJob(JOB_ID, ADMIN_ID),
    ).resolves.toEqual({
      provisioningId: JOB_ID,
      status: "dismissed",
    });
  });

  it.each([
    ["P0002", "provisioning_job_not_found", "job_not_found", 404],
    ["55000", "provisioning_in_progress", "provisioning_in_progress", 409],
    [
      "55000",
      "provisioning_outcome_unknown",
      "provisioning_outcome_unknown",
      409,
    ],
    ["55000", "provisioning_has_resources", "provisioning_has_resources", 409],
    ["55000", "job_not_dismissible", "job_not_dismissible", 409],
  ] as const)(
    "maps SQLSTATE %s with exact conflict %s",
    async (sqlState, databaseCode, publicCode, status) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: sqlState, details: databaseCode },
      });

      await expect(
        dismissAdminProvisioningJob(JOB_ID, ADMIN_ID),
      ).rejects.toMatchObject({
        code: publicCode,
        status,
      });
    },
  );

  it.each([
    [{ code: "XX000", message: "provisioning_in_progress" }, "wrong SQLSTATE"],
    [
      { code: "55000", message: "not_provisioning_in_progress_extra" },
      "embedded conflict token",
    ],
    [
      { code: "P0002", message: "some_other_missing_resource" },
      "unrecognized P0002",
    ],
  ])("fails closed on a %s", async (error) => {
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(
      dismissAdminProvisioningJob(JOB_ID, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "provisioning_action_failed",
      status: 500,
    });
  });

  it.each([
    ["null", null],
    ["empty array", []],
    ["multiple rows", [rpcResultRow("dismissed"), rpcResultRow("dismissed")]],
    ["wrong id", { id: OTHER_JOB_ID, status: "dismissed" }],
    ["wrong status", { id: JOB_ID, status: "needs_attention" }],
    ["malformed status", { id: JOB_ID, status: "not-a-status" }],
  ])("rejects a %s lifecycle result", async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(
      dismissAdminProvisioningJob(JOB_ID, ADMIN_ID),
    ).rejects.toBeInstanceOf(ProvisioningLifecycleError);
    await expect(
      dismissAdminProvisioningJob(JOB_ID, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "provisioning_action_failed",
      status: 500,
    });
  });

  it("logs only internal action/id/status and redacts raw database details", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: `provider leaked client@example.com and ${SECRET_TOKEN}`,
      },
    });

    await expect(
      restoreAdminProvisioningJob(JOB_ID, ADMIN_ID),
    ).rejects.toMatchObject({ code: "provisioning_action_failed" });

    const logged = consoleError.mock.calls.flat().join(" ");
    expect(logged).toContain("restore");
    expect(logged).toContain(JOB_ID);
    expect(logged).toContain("provisioning_action_failed");
    expect(logged).not.toContain("client@example.com");
    expect(logged).not.toContain(SECRET_TOKEN);
  });
});
