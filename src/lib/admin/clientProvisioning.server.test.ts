import { beforeEach, describe, expect, it, vi } from "vitest";

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
const NOW = "2026-08-03T12:00:00.000Z";

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
          | "assignment_failed";
      };
  updateBusinessNameError?: boolean;
  sendError?: boolean;
};

function makeHarness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  let generatedCount = 0;
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
    created_by_admin_id: ADMIN_ID,
    created_at: NOW,
    updated_at: NOW,
    ...options.job,
  };
  const partner =
    options.partner === null
      ? null
      : {
          id: PARTNER_ID,
          name: "Alpha Dog Agency",
          custom_domain: "app.alphadogagency.ai",
          status: "active",
          domain_status: "connected",
          origin: "https://app.alphadogagency.ai",
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
    updateJob: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      calls.push(`update-job:${String(patch.status ?? "fields")}`);
      job = { ...job, ...patch, updated_at: NOW };
      return { ...job };
    }),
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
      return options.assignment ?? { ok: true };
    }),
    generateRecoveryLink: vi.fn(async () => {
      calls.push("generate-link");
      generatedCount += 1;
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
  it("validates the partner before creating a durable job", async () => {
    const harness = makeHarness({ partner: { domain_status: "pending" } });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({ code: "partner_inactive", status: 409 });
    expect(harness.dependencies.createOrLoadJob).not.toHaveBeenCalled();
    expect(harness.dependencies.createAuthUser).not.toHaveBeenCalled();
  });

  it("creates, names, assigns, then returns one memory-only manual setup URL", async () => {
    const harness = makeHarness();

    const result = await harness.service.create(CREATE_INPUT, ADMIN_ID);

    expect(harness.calls.indexOf("update-name")).toBeLessThan(
      harness.calls.indexOf("assign"),
    );
    expect(harness.calls.indexOf("assign")).toBeLessThan(
      harness.calls.indexOf("generate-link"),
    );
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
    expect(result).not.toHaveProperty("adminSetupUrl");
    expect(result.provisioning.status).toBe("setup_email_sent");
    expect(result.provisioning.setupEmailSentAt).toBe(NOW);
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
    expect(harness.dependencies.updateJob).not.toHaveBeenCalled();
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
      harness.calls.slice(generatedAt + 1).some((call) =>
        call.startsWith("update-job:"),
      ),
    ).toBe(false);
    expect(harness.calls.slice(generatedAt + 1)).not.toContain("send-email");
    expect(harness.getJob().status).toBe("assigned");
    expect(harness.getJob().invite_attempt_count).toBe(0);
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

  it("does not generate a setup link when assignment conflicts", async () => {
    const harness = makeHarness({
      assignment: { ok: false, code: "subscription_exists" },
    });

    await expect(
      harness.service.create(CREATE_INPUT, ADMIN_ID),
    ).rejects.toMatchObject({
      code: "subscription_exists",
      status: 409,
      provisioningId: JOB_ID,
    });
    expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
    expect(harness.dependencies.sendSetupEmail).not.toHaveBeenCalled();
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
    });
    expect(JSON.stringify(harness.getJob())).not.toContain("secret-token");
  });

  it("rejects missing or ambiguous trigger businesses before mutation", async () => {
    for (const businesses of [[], [{}, {}]]) {
      const harness = makeHarness({ businesses });
      await expect(
        harness.service.create(CREATE_INPUT, ADMIN_ID),
      ).rejects.toMatchObject({
        code: businesses.length === 0 ? "business_missing" : "business_ambiguous",
        provisioningId: JOB_ID,
      });
      expect(harness.dependencies.updateBusinessName).not.toHaveBeenCalled();
      expect(harness.dependencies.assignPartnerBilling).not.toHaveBeenCalled();
      expect(harness.dependencies.generateRecoveryLink).not.toHaveBeenCalled();
    }
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
