import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  reconcile: vi.fn(),
  reconcilerModuleLoads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("@/lib/stripe/accountDeletionReconciler", () => {
  mocks.reconcilerModuleLoads += 1;
  return { reconcileAccountDeletionStripeAction: mocks.reconcile };
});

import {
  AccountDeletionServiceError,
  accountDeletionErrorBody,
  getAdminAccountDeletionPreview,
  parseAccountDeletionPreview,
  parseAdminAccountDeletionRun,
  parseScheduledAccountDeletion,
  processScheduledAccountDeletion,
  scheduleAdminAccountDeletion,
  scheduleCustomerAccountDeletion,
} from "./deletion.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_ID = "00000000-0000-4000-8000-000000000003";
const DELETION_REASON = "Duplicate test account requested by operations";

function scheduledAction(
  status: "pending" | "applied" | "blocked" = "pending",
) {
  return {
    business_id: BUSINESS_ID,
    deleted_at: "2026-08-03T16:00:00.000Z",
    deletion_scheduled_for: "2026-10-02T16:00:00.000Z",
    stripe_action: {
      business_id: BUSINESS_ID,
      desired_action: "pause",
      generation: 7,
      status,
      applied_action: status === "applied" ? "pause" : null,
      stripe_subscription_id: "sub_private",
      last_error_message: "provider detail must be discarded",
    },
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    business_id: BUSINESS_ID,
    business_name: "Alpha Dental",
    billing_mode: "invoiced",
    partner_id: PARTNER_ID,
    partner_slug: "alpha-dog",
    lifecycle_stage: "onboarding",
    deletion_scheduled_for: null,
    subscription_status: null,
    campaign_status: null,
    assigned_phone_count: 0,
    has_pending_phone_number: false,
    provisioning_job_count: 1,
    provisioning_operation_state: "idle",
    requires_live_acknowledgement: false,
    ...overrides,
  };
}

function suspendedPreview(overrides: Record<string, unknown> = {}) {
  return preview({
    lifecycle_stage: "suspended",
    deletion_scheduled_for: "2026-10-02T16:00:00.000Z",
    ...overrides,
  });
}

function adminRun(overrides: Record<string, unknown> = {}) {
  return {
    scheduled: scheduledAction(),
    preview: suspendedPreview({
      billing_mode: "stripe",
      partner_id: null,
      partner_slug: null,
    }),
    admin_event_created: true,
    previously_scheduled_by_admin: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("account deletion service", () => {
  it("keeps the service module free of a runtime Stripe reconciler import", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./deletion.server.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toMatch(
      /await import\(\s*"@\/lib\/stripe\/accountDeletionReconciler"\s*\)/,
    );
    expect(source).not.toMatch(
      /import\s+\{\s*reconcileAccountDeletionStripeAction\s*\}\s+from/,
    );
  });

  it.each(["invoiced", "comped"] as const)(
    "does not evaluate reconciliation for a null %s action",
    async (billingMode) => {
      const reconcile = vi.fn();
      const deletion = parseScheduledAccountDeletion(
        { ...scheduledAction(), stripe_action: null },
        BUSINESS_ID,
      );
      expect(deletion).not.toBeNull();

      await processScheduledAccountDeletion({
        deletion: deletion!,
        billingMode,
      });

      expect(reconcile).not.toHaveBeenCalled();
      expect(mocks.reconcilerModuleLoads).toBe(0);
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );

  it("rejects a partner Stripe action before reconciliation", async () => {
    const reconcile = vi.fn();
    const deletion = parseScheduledAccountDeletion(
      scheduledAction(),
      BUSINESS_ID,
    );

    await expect(
      processScheduledAccountDeletion({
        deletion: deletion!,
        billingMode: "invoiced",
        dependencies: { reconcileStripeAction: reconcile },
      }),
    ).rejects.toMatchObject({ code: "account_deletion_failed" });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("reconciles only an exact pending Stripe generation", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: 7,
      appliedAction: "pause",
    });
    const deletion = parseScheduledAccountDeletion(
      scheduledAction(),
      BUSINESS_ID,
    );

    await processScheduledAccountDeletion({
      deletion: deletion!,
      billingMode: "stripe",
      dependencies: { reconcileStripeAction: reconcile },
    });

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      generation: 7,
    });
    expect(deletion?.stripeAction).toEqual({
      generation: 7,
      status: "pending",
      appliedAction: null,
    });
    expect(JSON.stringify(deletion)).not.toContain("sub_private");
    expect(JSON.stringify(deletion)).not.toContain("provider detail");
  });

  it.each(["applied", "blocked"] as const)(
    "does not retry a durably %s Stripe action",
    async (status) => {
      const reconcile = vi.fn();
      const deletion = parseScheduledAccountDeletion(
        scheduledAction(status),
        BUSINESS_ID,
      );

      await processScheduledAccountDeletion({
        deletion: deletion!,
        billingMode: "stripe",
        dependencies: { reconcileStripeAction: reconcile },
      });

      expect(reconcile).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed schedule timestamps and applied actions", () => {
    expect(
      parseScheduledAccountDeletion(
        { ...scheduledAction(), deleted_at: "not-a-date" },
        BUSINESS_ID,
      ),
    ).toBeNull();
    expect(
      parseScheduledAccountDeletion(
        {
          ...scheduledAction("applied"),
          stripe_action: {
            ...scheduledAction("applied").stripe_action,
            applied_action: "resume",
          },
        },
        BUSINESS_ID,
      ),
    ).toBeNull();
  });

  it("parses the exact safe preview and recomputes live acknowledgement", () => {
    expect(parseAccountDeletionPreview(preview(), BUSINESS_ID)).toEqual({
      businessId: BUSINESS_ID,
      businessName: "Alpha Dental",
      billingMode: "invoiced",
      partnerId: PARTNER_ID,
      partnerSlug: "alpha-dog",
      lifecycleStage: "onboarding",
      deletionScheduledFor: null,
      subscriptionStatus: null,
      campaignStatus: null,
      assignedPhoneCount: 0,
      hasPendingPhoneNumber: false,
      provisioningJobCount: 1,
      provisioningOperationState: "idle",
      requiresLiveAcknowledgement: false,
    });
    expect(
      parseAccountDeletionPreview(
        preview({
          subscription_status: "active",
          requires_live_acknowledgement: false,
        }),
        BUSINESS_ID,
      ),
    ).toBeNull();
  });

  it("normalizes the database's nullable no-risk acknowledgement to false", () => {
    expect(
      parseAccountDeletionPreview(
        preview({ requires_live_acknowledgement: null }),
        BUSINESS_ID,
      ),
    ).toMatchObject({ requiresLiveAcknowledgement: false });
    expect(
      parseAccountDeletionPreview(
        preview({
          assigned_phone_count: 1,
          requires_live_acknowledgement: null,
        }),
        BUSINESS_ID,
      ),
    ).toBeNull();
  });

  it("loads the safe admin preview with exact RPC arguments and accepts an exact whitespace name", async () => {
    mocks.rpc.mockResolvedValue({
      data: preview({
        business_name: "   ",
        customer_email: "owner@example.test",
        pending_phone_number: "+13175550100",
      }),
      error: null,
    });

    const loaded = await getAdminAccountDeletionPreview(BUSINESS_ID);

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("get_account_deletion_preview", {
      p_business_id: BUSINESS_ID,
    });
    expect(loaded.businessName).toBe("   ");
    expect(JSON.stringify(loaded)).not.toContain("owner@example.test");
    expect(JSON.stringify(loaded)).not.toContain("+13175550100");
  });

  it("schedules a partner account with exact RPC arguments and never invokes Stripe", async () => {
    const reconcile = vi.fn();
    mocks.rpc.mockResolvedValue({
      data: adminRun({
        scheduled: {
          ...scheduledAction(),
          stripe_action: null,
          raw_schedule_secret: "must be discarded",
        },
        preview: suspendedPreview({
          business_name: "  Exact Legacy Name  ",
          raw_customer_email: "owner@example.test",
        }),
        raw_admin_note: "must be discarded",
      }),
      error: null,
    });

    const result = await scheduleAdminAccountDeletion({
      businessId: BUSINESS_ID,
      confirmationName: "  Exact Legacy Name  ",
      acknowledgeLiveResources: false,
      reason: DELETION_REASON,
      actorAdminUserId: OWNER_ID,
      dependencies: { reconcileStripeAction: reconcile },
    });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("schedule_admin_account_deletion", {
      p_business_id: BUSINESS_ID,
      p_confirmation_name: "  Exact Legacy Name  ",
      p_acknowledge_live_resources: false,
      p_reason: DELETION_REASON,
      p_actor_admin_user_id: OWNER_ID,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(result.scheduled.stripeAction).toBeNull();
    expect(result.preview.businessName).toBe("  Exact Legacy Name  ");
    expect(JSON.stringify(result)).not.toContain("must be discarded");
    expect(JSON.stringify(result)).not.toContain("owner@example.test");
  });

  it("keeps an already-admin-scheduled result audit-free and does not expose the submitted reason", async () => {
    const reconcile = vi.fn();
    mocks.rpc.mockResolvedValue({
      data: adminRun({
        scheduled: { ...scheduledAction(), stripe_action: null },
        preview: suspendedPreview(),
        admin_event_created: false,
        previously_scheduled_by_admin: true,
      }),
      error: null,
    });

    const result = await scheduleAdminAccountDeletion({
      businessId: BUSINESS_ID,
      confirmationName: "Alpha Dental",
      acknowledgeLiveResources: false,
      reason: DELETION_REASON,
      actorAdminUserId: OWNER_ID,
      dependencies: { reconcileStripeAction: reconcile },
    });

    expect(result).toMatchObject({
      adminEventCreated: false,
      previouslyScheduledByAdmin: true,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(DELETION_REASON);
  });

  it("reconciles one exact pending Stripe generation and strips raw Stripe fields", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: 7,
      appliedAction: "pause",
    });
    mocks.rpc.mockResolvedValue({ data: adminRun(), error: null });

    const result = await scheduleAdminAccountDeletion({
      businessId: BUSINESS_ID,
      confirmationName: "Alpha Dental",
      acknowledgeLiveResources: true,
      reason: DELETION_REASON,
      actorAdminUserId: OWNER_ID,
      dependencies: { reconcileStripeAction: reconcile },
    });

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      generation: 7,
    });
    expect(result.scheduled.stripeAction).toEqual({
      generation: 7,
      status: "pending",
      appliedAction: null,
    });
    expect(JSON.stringify(result)).not.toContain("sub_private");
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it("parses a coherent nested admin result without retaining extra payload fields", () => {
    const parsed = parseAdminAccountDeletionRun(
      adminRun({
        raw_admin_note: "must be discarded",
      }),
      BUSINESS_ID,
    );

    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("raw_admin_note");
  });

  it.each([
    {
      label: "both idempotency flags true",
      value: adminRun({ previously_scheduled_by_admin: true }),
    },
    {
      label: "a non-suspended post-run preview",
      value: adminRun({ preview: preview() }),
    },
    {
      label: "mismatched nested schedule timestamps",
      value: adminRun({
        preview: suspendedPreview({
          billing_mode: "stripe",
          partner_id: null,
          partner_slug: null,
          deletion_scheduled_for: "2026-10-03T16:00:00.000Z",
        }),
      }),
    },
  ])("rejects $label", ({ value }) => {
    expect(parseAdminAccountDeletionRun(value, BUSINESS_ID)).toBeNull();
  });

  it("rejects a malformed admin RPC payload before Stripe reconciliation", async () => {
    const reconcile = vi.fn();
    mocks.rpc.mockResolvedValue({
      data: adminRun({ previously_scheduled_by_admin: true }),
      error: null,
    });

    await expect(
      scheduleAdminAccountDeletion({
        businessId: BUSINESS_ID,
        confirmationName: "Alpha Dental",
        acknowledgeLiveResources: false,
        reason: DELETION_REASON,
        actorAdminUserId: OWNER_ID,
        dependencies: { reconcileStripeAction: reconcile },
      }),
    ).rejects.toMatchObject({
      code: "account_deletion_failed",
      status: 500,
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    ["business_not_found", 404],
    ["confirmation_mismatch", 409],
    ["live_ack_required", 409],
    ["provisioning_in_progress", 409],
    ["provisioning_outcome_unknown", 409],
  ] as const)(
    "maps admin RPC error %s without retaining raw details",
    async (code, status) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          message: `rejected: ${code}`,
          details:
            "owner@example.test +13175550100 confidential message content",
        },
      });

      await expect(
        scheduleAdminAccountDeletion({
          businessId: BUSINESS_ID,
          confirmationName: "Alpha Dental",
          acknowledgeLiveResources: false,
          reason: DELETION_REASON,
          actorAdminUserId: OWNER_ID,
        }),
      ).rejects.toMatchObject({ code, status });

      const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logs).not.toContain("owner@example.test");
      expect(logs).not.toContain("+13175550100");
      expect(logs).not.toContain("confidential message content");
    },
  );

  it.each([
    "provisioning_in_progress",
    "provisioning_outcome_unknown",
    "partner_subscription_conflict",
    "stripe_action_in_progress",
    "stripe_action_outcome_unknown",
  ])(
    "maps %s by exact token and does not log raw RPC details",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          message: `rejected: ${code}`,
          details:
            "owner@example.com +15555550100 confidential message content",
        },
      });

      let caught: unknown;
      try {
        await scheduleCustomerAccountDeletion({
          businessId: BUSINESS_ID,
          ownerId: OWNER_ID,
          billingMode: "invoiced",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AccountDeletionServiceError);
      expect(caught).toMatchObject({ code, status: 409 });
      expect(
        accountDeletionErrorBody(caught as AccountDeletionServiceError),
      ).toMatchObject({ error: code, code });
      const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logs).not.toContain("owner@example.com");
      expect(logs).not.toContain("+15555550100");
      expect(logs).not.toContain("confidential message content");
    },
  );

  it("does not match stable codes as substrings", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "not_provisioning_in_progress_extra" },
    });

    await expect(
      scheduleCustomerAccountDeletion({
        businessId: BUSINESS_ID,
        ownerId: OWNER_ID,
        billingMode: "stripe",
      }),
    ).rejects.toMatchObject({
      code: "account_deletion_failed",
      status: 500,
    });
  });
});
