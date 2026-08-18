import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/email/conciergeSetup", () => ({
  sendConciergeSetupEmail: vi.fn(),
}));

import {
  ClientProvisioningError,
  conciergeAuthCreatePayload,
  createClientProvisioningService,
  type ClientProvisioningDependencies,
} from "./clientProvisioning.server";
import type { CreatePartnerClientInput } from "./clientProvisioning.shared";

const JOB_ID = "10000000-0000-4000-a000-000000000001";
const PARTNER_ID = "20000000-0000-4000-a000-000000000001";
const USER_ID = "30000000-0000-4000-a000-000000000001";
const BUSINESS_ID = "40000000-0000-4000-a000-000000000001";
const ADMIN_ID = "50000000-0000-4000-a000-000000000001";
const OTHER_JOB_ID = "60000000-0000-4000-a000-000000000001";
const OPERATION_TOKEN_1 = "70000000-0000-4000-a000-000000000001";
const OPERATION_TOKEN_2 = "70000000-0000-4000-a000-000000000002";
const OPERATION_TOKEN_3 = "70000000-0000-4000-a000-000000000003";
const STALE_OPERATION_TOKEN = "80000000-0000-4000-a000-000000000001";
const NOW = "2026-08-03T12:00:00.000Z";

const ACTIVE_PARTNER = {
  id: PARTNER_ID,
  name: "Alpha Dog Agency",
  custom_domain: "app.alphadogagency.ai",
  status: "active",
  domain_status: "connected",
  origin: "https://app.alphadogagency.ai",
} as const;

const CREATE_INPUT: CreatePartnerClientInput = {
  email: "client@example.com",
  businessName: "Tidy Dogs",
  partnerId: PARTNER_ID,
  billingMode: "invoiced",
  partnerPlan: "sms_and_chat",
  sendSetupEmailNow: false,
};

type HarnessOptions = {
  created?: boolean;
  partner?: Record<string, unknown> | null;
  job?: Record<string, unknown>;
  authUser?: Record<string, unknown> | null;
  generatedAuthUser?: Record<string, unknown>;
  authCreateStatus?: "created" | "email_exists" | "failed";
  businesses?: Array<Record<string, unknown>>;
  assignment?:
    | { ok: true }
    | {
        ok: false;
        code:
          | "business_not_found"
          | "subscription_exists"
          | "partner_required"
          | "partner_inactive"
          | "plan_family_transition_not_supported"
          | "assignment_failed";
      };
  assignmentDoesNotPersist?: boolean;
  reassignAfterLink?: boolean;
  updateBusinessNameError?: boolean;
  sendError?: boolean;
};

function makeHarness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  let generatedCount = 0;
  let operationCount = 0;
  let job = {
    id: JOB_ID,
    email: CREATE_INPUT.email,
    requested_business_name: CREATE_INPUT.businessName,
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
    operation_token: null as string | null,
    operation_kind: null as "provision" | "retry" | "send_setup" | null,
    operation_started_at: null as string | null,
    operation_expires_at: null as string | null,
    created_by_admin_id: ADMIN_ID,
    created_at: NOW,
    updated_at: NOW,
    ...options.job,
  };
  const partner =
    options.partner === null
      ? null
      : {
          ...ACTIVE_PARTNER,
          ...options.partner,
        };
  let authUser =
    options.authUser === null
      ? null
      : {
          id: USER_ID,
          email: CREATE_INPUT.email,
          emailConfirmedAt: NOW,
          appMetadata: {
            concierge_provisioning_id: JOB_ID,
            must_set_password: true,
          },
          ...options.authUser,
        };
  let businesses = options.businesses ?? [
    {
      id: BUSINESS_ID,
      owner_id: USER_ID,
      name: "My Business",
      partner_id: null,
      billing_mode: "stripe",
      partner_plan: null,
      deleted_at: null,
    },
  ];

  const dependencies = {
    createOrLoadJob: vi.fn(async () => {
      calls.push("create-job");
      return { job: { ...job }, created: options.created ?? true };
    }),
    loadJobById: vi.fn(async (id: string) => {
      calls.push("load-job");
      return id === job.id ? { ...job } : null;
    }),
    claimOperation: vi.fn(
      async (input: {
        jobId: string;
        kind: "provision" | "retry" | "send_setup";
        token: string;
        reconciledToken: string | null;
        now: string;
      }) => {
        calls.push(`claim:${input.kind}`);
        if (job.status === "dismissed") {
          throw new ClientProvisioningError("job_dismissed", 409);
        }
        if (job.operation_token) {
          if (Date.parse(job.operation_expires_at!) > Date.parse(input.now)) {
            throw new ClientProvisioningError("provisioning_in_progress", 409);
          }
          if (input.reconciledToken !== job.operation_token) {
            throw new ClientProvisioningError(
              "provisioning_outcome_unknown",
              409,
            );
          }
          if (input.token === job.operation_token) {
            throw new ClientProvisioningError("auth_identity_mismatch", 409);
          }
        } else if (input.reconciledToken !== null) {
          throw new ClientProvisioningError("auth_identity_mismatch", 409);
        }
        job = {
          ...job,
          operation_token: input.token,
          operation_kind: input.kind,
          operation_started_at: input.now,
          operation_expires_at: new Date(
            Date.parse(input.now) + 15 * 60 * 1000,
          ).toISOString(),
          updated_at: input.now,
        };
        return { ...job };
      },
    ),
    updateJob: vi.fn(
      async (
        _id: string,
        operationToken: string,
        patch: Record<string, unknown>,
        release: boolean,
      ) => {
        calls.push(`update-job:${String(patch.status ?? "fields")}`);
        if (job.operation_token !== operationToken) {
          throw new ClientProvisioningError(
            "provisioning_outcome_unknown",
            409,
          );
        }
        job = {
          ...job,
          ...patch,
          ...(release
            ? {
                operation_token: null,
                operation_kind: null,
                operation_started_at: null,
                operation_expires_at: null,
              }
            : {
                operation_expires_at: new Date(
                  Date.parse(NOW) + 15 * 60 * 1000,
                ).toISOString(),
              }),
          updated_at: NOW,
        };
        return { ...job };
      },
    ),
    loadPartner: vi.fn(async () => {
      calls.push("load-partner");
      return partner ? { ...partner } : null;
    }),
    createAuthUser: vi.fn(async () => {
      calls.push("create-auth");
      const status = options.authCreateStatus ?? "created";
      return status === "created"
        ? { status, user: { ...authUser! } }
        : { status };
    }),
    findAuthUserByEmail: vi.fn(async () => {
      calls.push("find-auth");
      return authUser ? { ...authUser } : null;
    }),
    getAuthUserById: vi.fn(async () => {
      calls.push("get-auth");
      return authUser ? { ...authUser } : null;
    }),
    loadBusinessesByOwner: vi.fn(async () => {
      calls.push("load-business");
      return businesses.map((business) => ({ ...business }));
    }),
    updateBusinessName: vi.fn(
      async (businessId: string, ownerId: string, name: string) => {
        calls.push("update-name");
        if (options.updateBusinessNameError) throw new Error("name failed");
        businesses = businesses.map((business) =>
          business.id === businessId && business.owner_id === ownerId
            ? { ...business, name }
            : business,
        );
      },
    ),
    assignPartnerBilling: vi.fn(async () => {
      calls.push("assign");
      const result = options.assignment ?? { ok: true };
      if (result.ok && !options.assignmentDoesNotPersist) {
        businesses = businesses.map((business) =>
          business.id === BUSINESS_ID
            ? {
                ...business,
                partner_id: PARTNER_ID,
                billing_mode: "invoiced",
                partner_plan: "sms_and_chat",
              }
            : business,
        );
      }
      return result;
    }),
    generateRecoveryLink: vi.fn(async () => {
      calls.push("generate-link");
      generatedCount += 1;
      if (options.reassignAfterLink) {
        businesses = businesses.map((business) => ({
          ...business,
          partner_id: null,
          billing_mode: "stripe",
          partner_plan: null,
        }));
      }
      return {
        hashedToken: `secret-token-${generatedCount}`,
        verificationType: "recovery",
        user: { ...(options.generatedAuthUser ?? authUser!) },
      };
    }),
    sendSetupEmail: vi.fn(async () => {
      calls.push("send-email");
      if (options.sendError) throw new Error("provider echoed secret-token");
    }),
    randomPassword: vi.fn(() => "undisclosed-random-password-Aa1!"),
    randomOperationToken: vi.fn(() => {
      const tokens = [OPERATION_TOKEN_1, OPERATION_TOKEN_2, OPERATION_TOKEN_3];
      const token = tokens[operationCount];
      operationCount += 1;
      return token;
    }),
    now: vi.fn(() => NOW),
  } as unknown as ClientProvisioningDependencies;

  return {
    service: createClientProvisioningService(dependencies),
    dependencies,
    calls,
    getJob: () => job,
    setAuthUser: (next: Record<string, unknown>) => {
      authUser = next as typeof authUser;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("conciergeAuthCreatePayload", () => {
  it("uses a confirmed user and the exact recoverable provisioning markers", () => {
    expect(
      conciergeAuthCreatePayload({
        email: CREATE_INPUT.email,
        password: "unknown-password",
        provisioningId: JOB_ID,
      }),
    ).toEqual({
      email: CREATE_INPUT.email,
      password: "unknown-password",
      email_confirm: true,
      app_metadata: {
        concierge_provisioning_id: JOB_ID,
        must_set_password: true,
      },
    });
  });
});

describe("client provisioning service", () => {
  it("rejects chat-only before any durable work when partner rollout is off", async () => {
    vi.stubEnv("CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED", "0");
    const harness = makeHarness();

    await expect(
      harness.service.create(
        { ...CREATE_INPUT, partnerPlan: "chat_only" },
        ADMIN_ID,
      ),
    ).rejects.toMatchObject({
      code: "chat_only_not_available",
      status: 409,
    });
    expect(harness.dependencies.loadPartner).not.toHaveBeenCalled();
    expect(harness.dependencies.createOrLoadJob).not.toHaveBeenCalled();
  });

  it("validates the partner before creating a durable job", async () => {
    const harness = makeHarness({ partner: { domain_status: "pending" } });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({ code: "partner_inactive", status: 409 });
    expect(harness.dependencies.createOrLoadJob).not.toHaveBeenCalled();
    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
  });

  it("releases a newly claimed create operation if the partner changes", async () => {
    const harness = makeHarness();
    vi.mocked(harness.dependencies.loadPartner)
      .mockResolvedValueOnce({ ...ACTIVE_PARTNER })
      .mockResolvedValueOnce({ ...ACTIVE_PARTNER, status: "inactive" });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({ code: "partner_inactive", status: 409 });

    expect(harness.calls).toContain("claim:provision");
    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
    expect(harness.getJob()).toMatchObject({
      status: "needs_attention",
      last_error_code: "partner_inactive",
      operation_token: null,
      operation_kind: null,
      operation_started_at: null,
      operation_expires_at: null,
    });
  });

  it.each(["retry", "send_setup"] as const)(
    "releases an inactive partner %s lease with a safe durable failure",
    async (operation) => {
      const harness = makeHarness({
        partner: { status: "inactive" },
        job: { status: "needs_attention" },
      });

      const result =
        operation === "retry"
          ? harness.service.retry(
              JOB_ID,
              { sendSetupEmailNow: false },
              ADMIN_ID,
            )
          : harness.service.sendSetup(JOB_ID, ADMIN_ID);
      await expect(result).rejects.toMatchObject({
        code: "partner_inactive",
        status: 409,
      });

      expect(harness.calls).toContain(`claim:${operation}`);
      expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
      expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
      expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
      expect(harness.getJob()).toMatchObject({
        status: "needs_attention",
        last_error_code: "partner_inactive",
        operation_token: null,
        operation_kind: null,
        operation_started_at: null,
        operation_expires_at: null,
      });
    },
  );

  it("creates, names, assigns, then returns one memory-only manual setup URL", async () => {
    const harness = makeHarness();

    const result = await harness.service.create(CREATE_INPUT, ADMIN_ID);

    expect(harness.calls.indexOf("update-name")).toBeLessThan(
      harness.calls.indexOf("assign"),
    );
    expect(harness.calls.indexOf("claim:provision")).toBeLessThan(
      harness.calls.indexOf("create-auth"),
    );
    expect(harness.calls.indexOf("assign")).toBeLessThan(
      harness.calls.indexOf("generate-link"),
    );
    expect(harness.dependencies.assignPartnerBilling).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      partnerId: PARTNER_ID,
      billingMode: "invoiced",
      partnerPlan: "sms_and_chat",
      adminId: ADMIN_ID,
    });
    expect(harness.dependencies.createAuthUser).toHaveBeenCalledWith({
      email: CREATE_INPUT.email,
      password: "undisclosed-random-password-Aa1!",
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.generateRecoveryLink).toHaveBeenCalledWith({
      email: CREATE_INPUT.email,
      redirectTo: "https://app.alphadogagency.ai/api/auth/callback",
    });
    expect(result.adminSetupUrl).toBe(
      "https://app.alphadogagency.ai/api/auth/callback?token_hash=secret-token-1&type=recovery&flow=concierge",
    );
    expect(result.provisioning).toMatchObject({
      id: JOB_ID,
      status: "admin_setup",
      authUserId: USER_ID,
      businessId: BUSINESS_ID,
      inviteAttemptCount: 1,
    });
    expect(JSON.stringify(result.provisioning)).not.toContain("secret-token");
    expect(JSON.stringify(harness.getJob())).not.toContain("secret-token");
    expect(JSON.stringify(harness.getJob())).not.toContain(
      "undisclosed-random-password",
    );
    expect(JSON.stringify(result)).not.toContain(OPERATION_TOKEN_1);
    expect(harness.getJob().operation_token).toBeNull();
  });

  it("sends only after assignment and never returns the setup URL", async () => {
    const harness = makeHarness();

    const result = await harness.service.create(
      { ...CREATE_INPUT, sendSetupEmailNow: true },
      ADMIN_ID,
    );

    expect(harness.calls.indexOf("assign")).toBeLessThan(
      harness.calls.indexOf("generate-link"),
    );
    expect(harness.calls.indexOf("generate-link")).toBeLessThan(
      harness.calls.indexOf("send-email"),
    );
    expect(harness.calls.filter((call) => call.startsWith("claim:"))).toEqual([
      "claim:provision",
      "claim:send_setup",
    ]);
    expect(harness.calls.indexOf("claim:send_setup")).toBeLessThan(
      harness.calls.indexOf("generate-link"),
    );
    expect(result).not.toHaveProperty("adminSetupUrl");
    expect(result.provisioning.status).toBe("setup_email_sent");
    expect(result.provisioning.setupEmailSentAt).toBe(NOW);
  });

  it("does not send if the business assignment changes after link generation", async () => {
    const harness = makeHarness({ reassignAfterLink: true });

    await expect(
      harness.service.create(
        { ...CREATE_INPUT, sendSetupEmailNow: true },
        ADMIN_ID,
      ),
    ).rejects.toMatchObject({
      code: "business_identity_mismatch",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.generateRecoveryLink).toHaveBeenCalledOnce();
    expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
    expect(harness.getJob()).toMatchObject({
      status: "invite_pending",
      operation_token: null,
    });
  });

  it("recovers only the Auth user bearing the exact job marker", async () => {
    const harness = makeHarness({
      authCreateStatus: "email_exists",
      authUser: {
        id: USER_ID,
        email: CREATE_INPUT.email,
        emailConfirmedAt: NOW,
        appMetadata: {
          concierge_provisioning_id: JOB_ID,
          must_set_password: true,
        },
      },
    });

    const result = await harness.service.create(CREATE_INPUT, ADMIN_ID);

    expect(harness.dependencies.findAuthUserByEmail).toHaveBeenCalledWith(
      CREATE_INPUT.email,
    );
    expect(result.provisioning.authUserId).toBe(USER_ID);
  });

  it("rejects an unrelated existing email and returns the resumable job ID", async () => {
    const harness = makeHarness({
      authCreateStatus: "email_exists",
      authUser: {
        id: USER_ID,
        email: CREATE_INPUT.email,
        emailConfirmedAt: NOW,
        appMetadata: {
          concierge_provisioning_id: OTHER_JOB_ID,
          must_set_password: true,
        },
      },
    });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "email_in_use",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.loadBusinessesByOwner).not.toHaveBeenCalled();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
  });

  it("fails closed on a completed setup without mutating job or business state", async () => {
    const harness = makeHarness({
      created: false,
      job: { auth_user_id: USER_ID, status: "admin_setup" },
      authUser: {
        id: USER_ID,
        email: CREATE_INPUT.email,
        emailConfirmedAt: NOW,
        appMetadata: {
          concierge_provisioning_id: JOB_ID,
          must_set_password: false,
        },
      },
    });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "setup_already_completed",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.updateJob).toHaveBeenCalledOnce();
    expect(harness.dependencies.updateJob).toHaveBeenCalledWith(
      JOB_ID,
      OPERATION_TOKEN_1,
      {},
      true,
    );
    expect(harness.getJob()).toMatchObject({
      status: "admin_setup",
      operation_token: null,
    });
    expect(harness.dependencies.loadBusinessesByOwner).not.toHaveBeenCalled();
    expect(harness.dependencies.updateBusinessName).not.toHaveBeenCalled();
    expect(harness.dependencies.assignPartnerBilling).not.toHaveBeenCalled();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
    expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
  });

  it("does not mutate or send when the generated-link user completed after preflight", async () => {
    const harness = makeHarness({
      generatedAuthUser: {
        id: USER_ID,
        email: CREATE_INPUT.email,
        emailConfirmedAt: NOW,
        appMetadata: {
          concierge_provisioning_id: JOB_ID,
          must_set_password: false,
        },
      },
    });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "setup_already_completed",
      status: 409,
      provisioningId: JOB_ID,
    });

    const generatedAt = harness.calls.indexOf("generate-link");
    expect(generatedAt).toBeGreaterThan(-1);
    expect(
      harness.calls
        .slice(generatedAt + 1)
        .filter((call) => call.startsWith("update-job:")),
    ).toEqual(["update-job:fields"]);
    expect(harness.calls.slice(generatedAt + 1)).not.toContain("send-email");
    expect(harness.getJob().status).toBe("assigned");
    expect(harness.getJob().invite_attempt_count).toBe(0);
    expect(harness.getJob().operation_token).toBeNull();
  });

  it("stops before assignment and link generation when the business name write fails", async () => {
    const harness = makeHarness({ updateBusinessNameError: true });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "business_update_failed",
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.assignPartnerBilling).not.toHaveBeenCalled();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
  });

  it.each([
    "subscription_exists",
    "plan_family_transition_not_supported",
  ] as const)(
    "does not generate a setup link when assignment conflicts with %s",
    async (code) => {
      const harness = makeHarness({
        assignment: { ok: false, code },
      });

      await expect(
        harness.service.create(CREATE_INPUT, ADMIN_ID),
      ).rejects.toMatchObject({
        code,
        status: 409,
        provisioningId: JOB_ID,
      });
      expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
      expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
    },
  );

  it("rechecks the exact business assignment before generating a partner link", async () => {
    const harness = makeHarness({ assignmentDoesNotPersist: true });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "business_identity_mismatch",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.assignPartnerBilling).toHaveBeenCalledOnce();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
    expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
    expect(harness.getJob()).toMatchObject({
      status: "needs_attention",
      operation_token: null,
    });
  });

  it("regenerates a fresh manual link without duplicating Auth on retry", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        auth_user_id: USER_ID,
        business_id: BUSINESS_ID,
        status: "admin_setup",
        invite_attempt_count: 1,
      },
    });

    const first = await harness.service.retry(
      JOB_ID,
      { sendSetupEmailNow: false },
      ADMIN_ID,
    );
    const second = await harness.service.retry(
      JOB_ID,
      { sendSetupEmailNow: false },
      ADMIN_ID,
    );

    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
    expect(first.adminSetupUrl).toContain("secret-token-1");
    expect(second.adminSetupUrl).toContain("secret-token-2");
    expect(second.provisioning.inviteAttemptCount).toBe(3);
  });

  it("keeps an already-sent retry idempotent but explicit send-setup is fresh", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        auth_user_id: USER_ID,
        business_id: BUSINESS_ID,
        status: "setup_email_sent",
        setup_email_sent_at: NOW,
        invite_attempt_count: 1,
      },
    });

    const retried = await harness.service.retry(
      JOB_ID,
      { sendSetupEmailNow: true },
      ADMIN_ID,
    );
    expect(retried.provisioning.status).toBe("setup_email_sent");
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
    expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();

    const sent = await harness.service.sendSetup(JOB_ID, ADMIN_ID);
    expect(sent.provisioning.status).toBe("setup_email_sent");
    expect(harness.dependencies.generateRecoveryLink).toHaveBeenCalledOnce();
    expect(harness.dependencies.sendSetupEmail).toHaveBeenCalledOnce();
    expect(sent).not.toHaveProperty("adminSetupUrl");
  });

  it("keeps email failures resumable without persisting or returning the URL", async () => {
    const harness = makeHarness({ sendError: true });

    await expect(
      harness.service.create(
        { ...CREATE_INPUT, sendSetupEmailNow: true },
        ADMIN_ID,
      ),
    ).rejects.toMatchObject({
      code: "setup_email_failed",
      provisioningId: JOB_ID,
    });
    expect(harness.getJob()).toMatchObject({
      status: "invite_pending",
      last_error_code: "setup_email_failed",
      invite_attempt_count: 1,
      operation_kind: "send_setup",
      operation_token: OPERATION_TOKEN_2,
    });
    expect(JSON.stringify(harness.getJob())).not.toContain("secret-token");
  });

  it("rejects missing or ambiguous trigger businesses before mutation", async () => {
    for (const businesses of [[], [{}, {}]]) {
      const harness = makeHarness({ businesses });
      await expect(
        harness.service.create(CREATE_INPUT, ADMIN_ID),
      ).rejects.toMatchObject({
        code:
          businesses.length === 0 ? "business_missing" : "business_ambiguous",
        provisioningId: JOB_ID,
      });
      expect(harness.dependencies.updateBusinessName).not.toHaveBeenCalled();
      expect(harness.dependencies.assignPartnerBilling).not.toHaveBeenCalled();
      expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
    }
  });

  it("rejects an active operation before any Auth or provider side effect", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        operation_token: STALE_OPERATION_TOKEN,
        operation_kind: "provision",
        operation_started_at: "2026-08-03T11:55:00.000Z",
        operation_expires_at: "2026-08-03T12:10:00.000Z",
      },
    });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "provisioning_in_progress",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
    expect(harness.dependencies.loadBusinessesByOwner).not.toHaveBeenCalled();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
  });

  it("serializes concurrent create requests before Auth creation", async () => {
    const harness = makeHarness({ created: false });

    const results = await Promise.allSettled([
      harness.service.create(CREATE_INPUT, ADMIN_ID),
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "provisioning_in_progress",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.createAuthUser).toHaveBeenCalledOnce();
    expect(harness.dependencies.generateRecoveryLink).toHaveBeenCalledOnce();
  });

  it("returns the safe existing ID before comparing a dismissed job's old input", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        status: "dismissed",
        dismissed_at: NOW,
        dismissed_by_admin_id: ADMIN_ID,
      },
    });

    await expect(
      harness.service.create(
        {
          ...CREATE_INPUT,
          businessName: "A different requested name",
          billingMode: "comped",
          partnerPlan: "full",
        },
        ADMIN_ID,
      ),
    ).rejects.toMatchObject({
      code: "job_dismissed",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.claimOperation).not.toHaveBeenCalled();
    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
  });

  it("does not let create or send-setup reclaim an expired unknown outcome", async () => {
    for (const action of ["create", "send"] as const) {
      const harness = makeHarness({
        created: false,
        job: {
          operation_token: STALE_OPERATION_TOKEN,
          operation_kind: "send_setup",
          operation_started_at: "2026-08-03T11:30:00.000Z",
          operation_expires_at: "2026-08-03T11:45:00.000Z",
        },
      });

      const promise =
        action === "create"
          ? harness.service.create(CREATE_INPUT, ADMIN_ID)
          : harness.service.sendSetup(JOB_ID, ADMIN_ID);
      await expect(promise).rejects.toMatchObject({
        code: "provisioning_outcome_unknown",
        status: 409,
        provisioningId: JOB_ID,
      });
      expect(harness.dependencies.findAuthUserByEmail).not.toHaveBeenCalled();
      expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
      expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
    }
  });

  it("reconciles an expired operation before retry claims it with a fresh token", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        operation_token: STALE_OPERATION_TOKEN,
        operation_kind: "provision",
        operation_started_at: "2026-08-03T11:30:00.000Z",
        operation_expires_at: "2026-08-03T11:45:00.000Z",
      },
    });

    const result = await harness.service.retry(
      JOB_ID,
      { sendSetupEmailNow: false },
      ADMIN_ID,
    );

    expect(harness.calls.indexOf("find-auth")).toBeLessThan(
      harness.calls.indexOf("claim:retry"),
    );
    expect(harness.calls.indexOf("load-business")).toBeLessThan(
      harness.calls.indexOf("claim:retry"),
    );
    expect(harness.dependencies.claimOperation).toHaveBeenCalledWith({
      jobId: JOB_ID,
      kind: "retry",
      token: OPERATION_TOKEN_1,
      reconciledToken: STALE_OPERATION_TOKEN,
      now: NOW,
    });
    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
    expect(result.provisioning).toMatchObject({
      authUserId: USER_ID,
      businessId: BUSINESS_ID,
      status: "admin_setup",
    });
  });

  it("leaves an expired lease untouched when reconciliation finds the wrong Auth marker", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        operation_token: STALE_OPERATION_TOKEN,
        operation_kind: "retry",
        operation_started_at: "2026-08-03T11:30:00.000Z",
        operation_expires_at: "2026-08-03T11:45:00.000Z",
      },
      authUser: {
        id: USER_ID,
        email: CREATE_INPUT.email,
        emailConfirmedAt: NOW,
        appMetadata: {
          concierge_provisioning_id: OTHER_JOB_ID,
          must_set_password: true,
        },
      },
    });

    await expect(
      harness.service.retry(JOB_ID, { sendSetupEmailNow: false }, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "auth_identity_mismatch",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.claimOperation).not.toHaveBeenCalled();
    expect(harness.getJob().operation_token).toBe(STALE_OPERATION_TOKEN);
  });

  it("reclaims and releases an expired lease for an account that completed setup", async () => {
    const harness = makeHarness({
      created: false,
      job: {
        auth_user_id: USER_ID,
        business_id: BUSINESS_ID,
        status: "admin_setup",
        operation_token: STALE_OPERATION_TOKEN,
        operation_kind: "retry",
        operation_started_at: "2026-08-03T11:30:00.000Z",
        operation_expires_at: "2026-08-03T11:45:00.000Z",
      },
      authUser: {
        id: USER_ID,
        email: CREATE_INPUT.email,
        emailConfirmedAt: NOW,
        appMetadata: {
          concierge_provisioning_id: JOB_ID,
          must_set_password: false,
        },
      },
      businesses: [
        {
          id: BUSINESS_ID,
          owner_id: USER_ID,
          name: CREATE_INPUT.businessName,
          partner_id: PARTNER_ID,
          billing_mode: "invoiced",
          partner_plan: "sms_and_chat",
          deleted_at: null,
        },
      ],
    });

    await expect(
      harness.service.retry(JOB_ID, { sendSetupEmailNow: false }, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "setup_already_completed",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.claimOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        token: OPERATION_TOKEN_1,
        reconciledToken: STALE_OPERATION_TOKEN,
      }),
    );
    expect(harness.getJob()).toMatchObject({
      status: "admin_setup",
      operation_token: null,
    });
    expect(harness.dependencies.updateBusinessName).not.toHaveBeenCalled();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
  });

  it("stops a displaced worker at the first fenced progress write", async () => {
    const harness = makeHarness();
    vi.mocked(harness.dependencies.updateJob).mockRejectedValueOnce(
      new ClientProvisioningError("provisioning_outcome_unknown", 409),
    );

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "provisioning_outcome_unknown",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.createAuthUser).toHaveBeenCalledOnce();
    expect(harness.dependencies.loadBusinessesByOwner).not.toHaveBeenCalled();
    expect(harness.dependencies.updateBusinessName).not.toHaveBeenCalled();
    expect(harness.dependencies.assignPartnerBilling).not.toHaveBeenCalled();
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous Auth failure leased until reconciliation", async () => {
    const harness = makeHarness({ authCreateStatus: "failed" });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "auth_creation_failed",
      provisioningId: JOB_ID,
    });
    expect(harness.getJob()).toMatchObject({
      status: "needs_attention",
      last_error_code: "auth_creation_failed",
      operation_token: OPERATION_TOKEN_1,
      operation_kind: "provision",
    });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "provisioning_in_progress",
      status: 409,
    });
    expect(harness.dependencies.createAuthUser).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous recovery-link failure leased and never sends", async () => {
    const harness = makeHarness();
    vi.mocked(harness.dependencies.generateRecoveryLink).mockRejectedValueOnce(
      new Error("provider response lost"),
    );

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "link_generation_failed",
      provisioningId: JOB_ID,
    });
    expect(harness.getJob()).toMatchObject({
      status: "invite_pending",
      last_error_code: "link_generation_failed",
      invite_attempt_count: 1,
      operation_token: OPERATION_TOKEN_1,
    });
    expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
  });

  it("uses the same exact token for every owned write and clears it only at success", async () => {
    const harness = makeHarness();

    await harness.service.create(CREATE_INPUT, ADMIN_ID);

    const updates = vi.mocked(harness.dependencies.updateJob).mock.calls;
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every(([, token]) => token === OPERATION_TOKEN_1)).toBe(
      true,
    );
    expect(updates.slice(0, -1).every((call) => call[3] === false)).toBe(true);
    expect(updates.at(-1)?.[3]).toBe(true);
    expect(harness.getJob().operation_token).toBeNull();
  });

  it("exposes stable typed errors", () => {
    const error = new ClientProvisioningError(
      "setup_already_completed",
      409,
      "setup_already_completed",
      JOB_ID,
    );
    expect(error).toMatchObject({
      code: "setup_already_completed",
      status: 409,
      provisioningId: JOB_ID,
    });
  });
});
