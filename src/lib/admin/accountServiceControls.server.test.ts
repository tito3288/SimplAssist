import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  AdminAccountServiceControlsError,
  setAdminAccountServiceControl,
} from "./accountServiceControls.server";
import type { AdminAccountServiceControlRequest } from "./accountServiceControls.shared";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OTHER_BUSINESS_ID = "10000000-0000-4000-a000-000000000002";
const ADMIN_ID = "20000000-0000-4000-a000-000000000001";
const EVENT_ID = "30000000-0000-4000-a000-000000000001";
const REASON = "Account review requires a temporary hold";
const SUSPENDED_AT = "2026-08-04T12:00:00.000Z";
const AI_PAUSED_AT = "2026-08-04T12:01:00.000Z";
const TEXTING_PAUSED_AT = "2026-08-04T12:02:00.000Z";

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    business_id: BUSINESS_ID,
    changed: true,
    admin_event_id: EVENT_ID,
    operations_suspended_at: SUSPENDED_AT,
    ai_replies_paused_at: AI_PAUSED_AT,
    texting_paused_at: TEXTING_PAUSED_AT,
    bookings_paused_at: null,
    ...overrides,
  };
}

async function run(input: AdminAccountServiceControlRequest) {
  return setAdminAccountServiceControl({
    businessId: BUSINESS_ID,
    actorAdminUserId: ADMIN_ID,
    input,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: rpcRow(), error: null });
});

describe("setAdminAccountServiceControl RPC mapping", () => {
  it.each([
    [
      { action: "suspend", reason: REASON },
      "set_admin_business_operations_suspension",
      {
        p_business_id: BUSINESS_ID,
        p_suspended: true,
        p_reason: REASON,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "reactivate", reason: REASON },
      "set_admin_business_operations_suspension",
      {
        p_business_id: BUSINESS_ID,
        p_suspended: false,
        p_reason: REASON,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "pause", service: "ai_replies" },
      "set_admin_business_service_pause",
      {
        p_business_id: BUSINESS_ID,
        p_service: "ai_replies",
        p_paused: true,
        p_reason: null,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "pause", service: "texting", reason: REASON },
      "set_admin_business_service_pause",
      {
        p_business_id: BUSINESS_ID,
        p_service: "texting",
        p_paused: true,
        p_reason: REASON,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "pause", service: "bookings" },
      "set_admin_business_service_pause",
      {
        p_business_id: BUSINESS_ID,
        p_service: "bookings",
        p_paused: true,
        p_reason: null,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "resume", service: "ai_replies", reason: REASON },
      "set_admin_business_service_pause",
      {
        p_business_id: BUSINESS_ID,
        p_service: "ai_replies",
        p_paused: false,
        p_reason: REASON,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "resume", service: "texting" },
      "set_admin_business_service_pause",
      {
        p_business_id: BUSINESS_ID,
        p_service: "texting",
        p_paused: false,
        p_reason: null,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
    [
      { action: "resume", service: "bookings", reason: REASON },
      "set_admin_business_service_pause",
      {
        p_business_id: BUSINESS_ID,
        p_service: "bookings",
        p_paused: false,
        p_reason: REASON,
        p_actor_admin_user_id: ADMIN_ID,
      },
    ],
  ] as const)("maps %j to the exact RPC contract", async (input, rpc, args) => {
    await run(input);

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args);
  });

  it("canonicalizes an uppercase UUID before mutation and response comparison", async () => {
    const result = await setAdminAccountServiceControl({
      businessId: BUSINESS_ID.toUpperCase(),
      actorAdminUserId: ADMIN_ID,
      input: { action: "suspend", reason: REASON },
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "set_admin_business_operations_suspension",
      expect.objectContaining({ p_business_id: BUSINESS_ID }),
    );
    expect(result.controls.businessId).toBe(BUSINESS_ID);
  });

  it("projects the exact complete camel-case response", async () => {
    await expect(run({ action: "suspend", reason: REASON })).resolves.toEqual({
      changed: true,
      adminEventId: EVENT_ID,
      controls: {
        businessId: BUSINESS_ID,
        operationsSuspendedAt: SUSPENDED_AT,
        aiRepliesPausedAt: AI_PAUSED_AT,
        textingPausedAt: TEXTING_PAUSED_AT,
        bookingsPausedAt: null,
      },
    });
  });

  it("returns an idempotent no-op with the complete preserved snapshot", async () => {
    mocks.rpc.mockResolvedValue({
      data: rpcRow({ changed: false, admin_event_id: null }),
      error: null,
    });

    await expect(
      run({ action: "reactivate", reason: REASON }),
    ).resolves.toEqual({
      changed: false,
      adminEventId: null,
      controls: {
        businessId: BUSINESS_ID,
        operationsSuspendedAt: SUSPENDED_AT,
        aiRepliesPausedAt: AI_PAUSED_AT,
        textingPausedAt: TEXTING_PAUSED_AT,
        bookingsPausedAt: null,
      },
    });
  });
});

describe("setAdminAccountServiceControl result validation", () => {
  it.each([
    ["an array", [rpcRow()]],
    ["a mismatched business", rpcRow({ business_id: OTHER_BUSINESS_ID })],
    ["an extra key", rpcRow({ durable_reason: REASON })],
    ["a missing key", { ...rpcRow(), bookings_paused_at: undefined }],
    ["a malformed timestamp", rpcRow({ texting_paused_at: "2026-08-04" })],
    ["an ambiguous timestamp", rpcRow({ texting_paused_at: "2026-08-04T12:00:00" })],
    ["a changed result without an event", rpcRow({ admin_event_id: null })],
    [
      "an unchanged result with an event",
      rpcRow({ changed: false, admin_event_id: EVENT_ID }),
    ],
  ])("fails closed for %s", async (_label, data) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValue({ data, error: null });

    await expect(run({ action: "suspend", reason: REASON })).rejects.toEqual(
      new AdminAccountServiceControlsError("service_controls_failed", 500),
    );
    expect(log).toHaveBeenCalledWith(
      `[admin:service-controls] mutation for business ${BUSINESS_ID}: service_controls_failed`,
    );
  });
});

describe("setAdminAccountServiceControl error mapping", () => {
  it.each([
    ["P0002", "business_not_found", "business_not_found", 404],
    [
      "55000",
      "account_deletion_in_progress",
      "account_deletion_in_progress",
      409,
    ],
  ] as const)(
    "maps SQLSTATE %s plus %s to %s",
    async (sqlState, token, publicCode, status) => {
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: sqlState, message: token },
      });

      await expect(run({ action: "suspend", reason: REASON })).rejects.toEqual(
        new AdminAccountServiceControlsError(publicCode, status),
      );
      expect(log).toHaveBeenCalledWith(
        `[admin:service-controls] mutation for business ${BUSINESS_ID}: ${publicCode}`,
      );
    },
  );

  it.each([
    ["XX000", "business_not_found"],
    ["P0002", "account_deletion_in_progress"],
    ["55000", "business_not_found"],
    ["22023", "invalid_admin_action_reason"],
  ])(
    "does not trust token %s under the wrong SQLSTATE %s",
    async (sqlState, token) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: sqlState, message: token },
      });

      await expect(run({ action: "suspend", reason: REASON })).rejects.toEqual(
        new AdminAccountServiceControlsError("service_controls_failed", 500),
      );
    },
  );

  it("redacts raw RPC details and durable reasons from logs", async () => {
    const secret = "client@example.test +15555550123 provider-secret";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: secret,
        details: REASON,
        hint: "token_hash=secret",
      },
    });

    await expect(run({ action: "suspend", reason: REASON })).rejects.toMatchObject(
      { code: "service_controls_failed", status: 500 },
    );
    const serializedLogs = JSON.stringify(log.mock.calls);
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).not.toContain(REASON);
    expect(serializedLogs).not.toContain("token_hash");
  });

  it("converts a rejected RPC into the same safe generic failure", async () => {
    const secret = `${REASON} client@example.test`;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc.mockRejectedValue(new Error(secret));

    await expect(run({ action: "suspend", reason: REASON })).rejects.toEqual(
      new AdminAccountServiceControlsError("service_controls_failed", 500),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(REASON);
  });
});
