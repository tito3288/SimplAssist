import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedWorkspaceAccess } from "@/lib/customer/workspaceAccess.server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  tableResults: {} as Record<string, { data: unknown; error: unknown }>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  queries: [] as Array<{
    table: string;
    columns: string;
    field: string;
    value: string;
  }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/branding/defaultBrand", () => ({
  getCanonicalAppHostname: () => "app.simplassist.test",
  getCanonicalAppOrigin: () => "https://app.simplassist.test",
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import {
  claimGoogleCalendarOAuthHandoff,
  completeGoogleCalendarOAuthConnection,
  createGoogleCalendarOAuthAttempt,
  createGoogleOAuthOpaqueToken,
  digestGoogleOAuthOpaqueToken,
  GoogleOAuthAttemptError,
  isExactCanonicalGoogleCallbackHost,
  parseGoogleOAuthOpaqueToken,
  purgeExpiredGoogleCalendarOAuthAttempts,
  requireGoogleCalendarSettings,
  resolveGoogleOAuthWorkspaceIdentity,
  stageGoogleCalendarOAuthHandoff,
  type GoogleOAuthWorkspaceIdentity,
} from "./oauthAttempt.server";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const ATTEMPT_ID = "10000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "20000000-0000-4000-8000-000000000001";
const OWNER_ID = "30000000-0000-4000-8000-000000000001";
const PARTNER_ID = "40000000-0000-4000-8000-000000000001";
const STATE = Buffer.alloc(32, 0x11).toString("base64url");
const VERIFIER = Buffer.alloc(32, 0x22).toString("base64url");
const HANDOFF = Buffer.alloc(32, 0x33).toString("base64url");

const canonicalIdentity: GoogleOAuthWorkspaceIdentity = {
  businessId: BUSINESS_ID,
  ownerUserId: OWNER_ID,
  partnerId: null,
  hostname: "app.simplassist.test",
  origin: "https://app.simplassist.test",
  hostKind: "canonical",
};

const partnerIdentity: GoogleOAuthWorkspaceIdentity = {
  businessId: BUSINESS_ID,
  ownerUserId: OWNER_ID,
  partnerId: PARTNER_ID,
  hostname: "app.partner.test",
  origin: "https://app.partner.test",
  hostKind: "partner",
};

function workspaceAccess(
  hostKind: "canonical" | "partner",
  partnerId: string | null,
): ResolvedWorkspaceAccess {
  return {
    status: "resolved",
    hostKind,
    user: { id: OWNER_ID },
    business: {
      id: BUSINESS_ID,
      partner_id: partnerId,
      billing_mode: partnerId ? "invoiced" : "stripe",
    },
  } as unknown as ResolvedWorkspaceAccess;
}

function availablePartner(
  overrides: Partial<{
    id: string;
    custom_domain: string | null;
    status: "active" | "inactive";
    domain_status: "pending" | "connected";
  }> = {},
) {
  return {
    id: PARTNER_ID,
    custom_domain: "app.partner.test",
    status: "active" as const,
    domain_status: "connected" as const,
    ...overrides,
  };
}

function expectAttemptError(
  error: unknown,
  code: string,
  status: number,
): void {
  expect(error).toBeInstanceOf(GoogleOAuthAttemptError);
  expect(error).toMatchObject({ code, status, message: code });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.queries.length = 0;
  for (const key of Object.keys(mocks.tableResults)) {
    delete mocks.tableResults[key];
  }
  for (const key of Object.keys(mocks.rpcResults)) {
    delete mocks.rpcResults[key];
  }

  mocks.from.mockImplementation((table: string) => ({
    select: (columns: string) => ({
      eq: (field: string, value: string) => ({
        maybeSingle: async () => {
          mocks.queries.push({ table, columns, field, value });
          const result = mocks.tableResults[table];
          if (!result) throw new Error(`Unexpected table query: ${table}`);
          return result;
        },
      }),
    }),
  }));
  mocks.rpc.mockImplementation(async (name: string) => {
    const result = mocks.rpcResults[name];
    if (!result) throw new Error(`Unexpected RPC: ${name}`);
    return result;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opaque OAuth values", () => {
  it("creates and parses only canonical 256-bit base64url tokens", () => {
    const generated = createGoogleOAuthOpaqueToken();

    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(generated, "base64url")).toHaveLength(32);
    expect(parseGoogleOAuthOpaqueToken(generated)).toBe(generated);
    expect(parseGoogleOAuthOpaqueToken(STATE)).toBe(STATE);

    for (const invalid of [
      null,
      undefined,
      123,
      STATE.slice(1),
      `${STATE}=`,
      `${STATE.slice(0, 42)}+`,
      ` ${STATE}`,
    ]) {
      expect(parseGoogleOAuthOpaqueToken(invalid)).toBeNull();
    }
  });

  it("hashes the canonical token bytes as lowercase SHA-256 hex", () => {
    expect(digestGoogleOAuthOpaqueToken(STATE)).toBe(
      createHash("sha256").update(STATE, "utf8").digest("hex"),
    );
    expect(digestGoogleOAuthOpaqueToken(STATE)).toMatch(/^[0-9a-f]{64}$/);

    try {
      digestGoogleOAuthOpaqueToken(`${STATE}=`);
      throw new Error("Expected invalid token to fail");
    } catch (error) {
      expectAttemptError(error, "invalid_request", 400);
      expect(JSON.stringify(error)).not.toContain(STATE);
    }
  });
});

describe("exact workspace origins", () => {
  it("accepts only a normalized exact canonical callback Host", () => {
    expect(isExactCanonicalGoogleCallbackHost("app.simplassist.test")).toBe(
      true,
    );
    expect(isExactCanonicalGoogleCallbackHost("APP.SIMPLASSIST.TEST:443")).toBe(
      true,
    );
    expect(isExactCanonicalGoogleCallbackHost("app.simplassist.test.")).toBe(
      true,
    );

    for (const host of [
      null,
      "app.partner.test",
      "app.simplassist.test.evil.example",
      "app.simplassist.test,evil.example",
      "https://app.simplassist.test",
    ]) {
      expect(isExactCanonicalGoogleCallbackHost(host)).toBe(false);
    }
  });

  it("binds an unassigned workspace to the configured canonical origin", async () => {
    await expect(
      resolveGoogleOAuthWorkspaceIdentity(
        workspaceAccess("canonical", null),
        "APP.SIMPLASSIST.TEST:443",
      ),
    ).resolves.toEqual(canonicalIdentity);

    for (const [access, host] of [
      [workspaceAccess("canonical", PARTNER_ID), "app.simplassist.test"],
      [workspaceAccess("canonical", null), "app.partner.test"],
      [workspaceAccess("canonical", null), "app.simplassist.test.evil.test"],
    ] as const) {
      await expect(
        resolveGoogleOAuthWorkspaceIdentity(access, host),
      ).rejects.toMatchObject({ code: "workspace_changed", status: 403 });
    }
  });

  it("revalidates a partner UUID and exact active connected stored domain", async () => {
    mocks.tableResults.partners = {
      data: availablePartner(),
      error: null,
    };

    await expect(
      resolveGoogleOAuthWorkspaceIdentity(
        workspaceAccess("partner", PARTNER_ID),
        "APP.PARTNER.TEST:443",
      ),
    ).resolves.toEqual(partnerIdentity);
    expect(mocks.queries).toContainEqual({
      table: "partners",
      columns: "id,custom_domain,status,domain_status",
      field: "id",
      value: PARTNER_ID,
    });

    for (const partner of [
      availablePartner({ custom_domain: "other.partner.test" }),
      availablePartner({ status: "inactive" }),
      availablePartner({ domain_status: "pending" }),
      availablePartner({ custom_domain: "app.simplassist.test" }),
    ]) {
      mocks.tableResults.partners = { data: partner, error: null };
      await expect(
        resolveGoogleOAuthWorkspaceIdentity(
          workspaceAccess("partner", PARTNER_ID),
          "app.partner.test",
        ),
      ).rejects.toMatchObject({ code: "workspace_changed", status: 403 });
    }
  });
});

describe("database adapter contracts", () => {
  it("creates an attempt with digests and the exact ten-minute contract", async () => {
    mocks.rpcResults.create_google_calendar_oauth_attempt = {
      data: ATTEMPT_ID,
      error: null,
    };

    await expect(
      createGoogleCalendarOAuthAttempt({
        identity: canonicalIdentity,
        state: STATE,
        originVerifier: VERIFIER,
      }),
    ).resolves.toBe(ATTEMPT_ID);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_google_calendar_oauth_attempt",
      {
        p_state_digest: digestGoogleOAuthOpaqueToken(STATE),
        p_origin_verifier_digest: digestGoogleOAuthOpaqueToken(VERIFIER),
        p_business_id: BUSINESS_ID,
        p_owner_user_id: OWNER_ID,
        p_origin_partner_id: null,
        p_origin_hostname: "app.simplassist.test",
        p_expires_at: "2026-08-04T12:10:00.000Z",
      },
    );
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(STATE);
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(VERIFIER);
  });

  it("stages canonical success with a fresh digest and bounded expiry", async () => {
    mocks.tableResults.google_calendar_oauth_attempts = {
      data: { expires_at: "2026-08-04T12:10:00.000Z" },
      error: null,
    };
    mocks.rpcResults.stage_google_calendar_oauth_handoff = {
      data: {
        attempt_id: ATTEMPT_ID,
        business_id: BUSINESS_ID,
        owner_user_id: OWNER_ID,
        origin_partner_id: null,
        origin_hostname: "app.simplassist.test",
        sanitized_result: null,
        handoff_expires_at: "2026-08-04T12:05:00.000Z",
      },
      error: null,
    };

    const result = await stageGoogleCalendarOAuthHandoff({
      state: STATE,
      authorizationCode: "one-use-google-code",
      sanitizedResult: null,
    });

    expect(result.returnOrigin).toBe("https://app.simplassist.test");
    expect(parseGoogleOAuthOpaqueToken(result.handoff)).toBe(result.handoff);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "stage_google_calendar_oauth_handoff",
      {
        p_state_digest: digestGoogleOAuthOpaqueToken(STATE),
        p_handoff_digest: digestGoogleOAuthOpaqueToken(result.handoff),
        p_authorization_code: "one-use-google-code",
        p_sanitized_result: null,
        p_handoff_expires_at: "2026-08-04T12:05:00.000Z",
      },
    );
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(
      result.handoff,
    );
  });

  it("stages only sanitized provider outcomes and revalidates partner return origins", async () => {
    mocks.tableResults.google_calendar_oauth_attempts = {
      data: { expires_at: "2026-08-04T12:03:00.000Z" },
      error: null,
    };
    mocks.tableResults.partners = {
      data: availablePartner(),
      error: null,
    };
    mocks.rpcResults.stage_google_calendar_oauth_handoff = {
      data: {
        attempt_id: ATTEMPT_ID,
        business_id: BUSINESS_ID,
        owner_user_id: OWNER_ID,
        origin_partner_id: PARTNER_ID,
        origin_hostname: "app.partner.test",
        sanitized_result: "access_denied",
        handoff_expires_at: "2026-08-04T12:03:00.000Z",
      },
      error: null,
    };

    const result = await stageGoogleCalendarOAuthHandoff({
      state: STATE,
      authorizationCode: null,
      sanitizedResult: "access_denied",
    });
    expect(result.returnOrigin).toBe("https://app.partner.test");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "stage_google_calendar_oauth_handoff",
      expect.objectContaining({
        p_authorization_code: null,
        p_sanitized_result: "access_denied",
        p_handoff_expires_at: "2026-08-04T12:03:00.000Z",
      }),
    );

    mocks.tableResults.partners = {
      data: availablePartner({ custom_domain: "changed.partner.test" }),
      error: null,
    };
    await expect(
      stageGoogleCalendarOAuthHandoff({
        state: STATE,
        authorizationCode: null,
        sanitizedResult: "access_denied",
      }),
    ).rejects.toMatchObject({ code: "workspace_changed", status: 403 });
  });

  it("claims with exact identity digests and deliberately omits p_claimed_at", async () => {
    mocks.rpcResults.claim_google_calendar_oauth_handoff = {
      data: {
        attempt_id: ATTEMPT_ID,
        authorization_code: "one-use-google-code",
        sanitized_result: null,
      },
      error: null,
    };

    await expect(
      claimGoogleCalendarOAuthHandoff({
        identity: partnerIdentity,
        handoff: HANDOFF,
        originVerifier: VERIFIER,
      }),
    ).resolves.toEqual({
      attemptId: ATTEMPT_ID,
      authorizationCode: "one-use-google-code",
      sanitizedResult: null,
    });

    const expectedArguments = {
      p_handoff_digest: digestGoogleOAuthOpaqueToken(HANDOFF),
      p_origin_verifier_digest: digestGoogleOAuthOpaqueToken(VERIFIER),
      p_business_id: BUSINESS_ID,
      p_owner_user_id: OWNER_ID,
      p_origin_partner_id: PARTNER_ID,
      p_origin_hostname: "app.partner.test",
    };
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_google_calendar_oauth_handoff",
      expectedArguments,
    );
    expect(mocks.rpc.mock.calls[0][1]).toEqual(expectedArguments);
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("p_claimed_at");
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(HANDOFF);
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(VERIFIER);
  });

  it("completes with the exact credential RPC contract, cannot clear operational pauses, and requires true", async () => {
    mocks.rpcResults.complete_google_calendar_oauth_connection = {
      data: true,
      error: null,
    };

    await expect(
      completeGoogleCalendarOAuthConnection({
        attemptId: ATTEMPT_ID,
        identity: partnerIdentity,
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        tokenExpiry: "2026-08-04T13:00:00.000Z",
        googleEmail: "client@example.com",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_google_calendar_oauth_connection",
      {
        p_attempt_id: ATTEMPT_ID,
        p_business_id: BUSINESS_ID,
        p_owner_user_id: OWNER_ID,
        p_origin_partner_id: PARTNER_ID,
        p_origin_hostname: "app.partner.test",
        p_access_token: "google-access-token",
        p_refresh_token: "google-refresh-token",
        p_token_expiry: "2026-08-04T13:00:00.000Z",
        p_google_email: "client@example.com",
        p_calendar_id: "primary",
      },
    );
    const completionPayload = mocks.rpc.mock.calls[0]?.[1];
    expect(completionPayload).not.toHaveProperty(
      "operations_suspended_at",
    );
    expect(completionPayload).not.toHaveProperty("bookings_paused_at");
    expect(JSON.stringify(completionPayload)).not.toContain(
      "operations_suspended_at",
    );
    expect(JSON.stringify(completionPayload)).not.toContain(
      "bookings_paused_at",
    );

    mocks.rpcResults.complete_google_calendar_oauth_connection = {
      data: { completed: true, raw_token: "must-not-escape" },
      error: null,
    };
    try {
      await completeGoogleCalendarOAuthConnection({
        attemptId: ATTEMPT_ID,
        identity: partnerIdentity,
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        tokenExpiry: "2026-08-04T13:00:00.000Z",
        googleEmail: null,
      });
      throw new Error("Expected a non-boolean completion result to fail");
    } catch (error) {
      expectAttemptError(error, "service_unavailable", 503);
      expect(JSON.stringify(error)).not.toContain("must-not-escape");
    }
  });

  it("rejects widened composite rows instead of exposing unknown fields", async () => {
    mocks.rpcResults.claim_google_calendar_oauth_handoff = {
      data: {
        attempt_id: ATTEMPT_ID,
        authorization_code: null,
        sanitized_result: "provider_error",
        raw_state: STATE,
        owner_email: "private@example.com",
      },
      error: null,
    };

    try {
      await claimGoogleCalendarOAuthHandoff({
        identity: canonicalIdentity,
        handoff: HANDOFF,
        originVerifier: VERIFIER,
      });
      throw new Error("Expected widened result to fail");
    } catch (error) {
      expectAttemptError(error, "service_unavailable", 503);
      expect(JSON.stringify(error)).not.toContain(STATE);
      expect(JSON.stringify(error)).not.toContain("private@example.com");
    }
  });

  it("maps database failures to fixed public errors without raw details", async () => {
    mocks.rpcResults.claim_google_calendar_oauth_handoff = {
      data: null,
      error: {
        code: "55000",
        message:
          "oauth_handoff_invalid_or_expired token=super-secret customer@example.com",
        details: "provider payload",
      },
    };

    try {
      await claimGoogleCalendarOAuthHandoff({
        identity: canonicalIdentity,
        handoff: HANDOFF,
        originVerifier: VERIFIER,
      });
      throw new Error("Expected claim failure");
    } catch (error) {
      expectAttemptError(error, "handoff_invalid_or_expired", 400);
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain("super-secret");
      expect(serialized).not.toContain("customer@example.com");
      expect(serialized).not.toContain("provider payload");
    }

    mocks.rpcResults.create_google_calendar_oauth_attempt = {
      data: null,
      error: {
        code: "55000",
        message: "oauth_workspace_changed internal row dump",
      },
    };
    await expect(
      createGoogleCalendarOAuthAttempt({
        identity: canonicalIdentity,
        state: STATE,
        originVerifier: VERIFIER,
      }),
    ).rejects.toMatchObject({ code: "workspace_changed", status: 403 });
  });
});

describe("supporting private reads", () => {
  it("requires the exact business ai_settings row", async () => {
    mocks.tableResults.ai_settings = {
      data: { business_id: BUSINESS_ID },
      error: null,
    };
    await expect(
      requireGoogleCalendarSettings(BUSINESS_ID),
    ).resolves.toBeUndefined();
    expect(mocks.queries).toContainEqual({
      table: "ai_settings",
      columns: "business_id",
      field: "business_id",
      value: BUSINESS_ID,
    });

    for (const result of [
      { data: null, error: null },
      { data: { business_id: OWNER_ID }, error: null },
      {
        data: { business_id: BUSINESS_ID, email: "must-not-accept" },
        error: null,
      },
      { data: null, error: { message: "private database error" } },
    ]) {
      mocks.tableResults.ai_settings = result;
      await expect(
        requireGoogleCalendarSettings(BUSINESS_ID),
      ).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
    }
  });

  it("accepts only a nonnegative integer purge scalar", async () => {
    for (const count of [0, 3]) {
      mocks.rpcResults.purge_expired_google_calendar_oauth_attempts = {
        data: count,
        error: null,
      };
      await expect(
        purgeExpiredGoogleCalendarOAuthAttempts(),
      ).resolves.toBeUndefined();
      expect(mocks.rpc).toHaveBeenLastCalledWith(
        "purge_expired_google_calendar_oauth_attempts",
        {},
      );
    }

    for (const data of ["3", -1, 1.5, null, { count: 3 }]) {
      mocks.rpcResults.purge_expired_google_calendar_oauth_attempts = {
        data,
        error: null,
      };
      await expect(
        purgeExpiredGoogleCalendarOAuthAttempts(),
      ).rejects.toMatchObject({ code: "service_unavailable", status: 503 });
    }
  });
});
