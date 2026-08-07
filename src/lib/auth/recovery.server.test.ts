import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  generateLink: vi.fn(),
  from: vi.fn(),
  resolveStrictOrigin: vi.fn(),
  resolveBrand: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  businessResult: { data: [], error: null } as QueryResult,
  tables: [] as string[],
  operations: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: mocks.listUsers,
        generateLink: mocks.generateLink,
      },
    },
    from: mocks.from,
  },
}));
vi.mock("./callbackOrigin.server", () => ({
  resolveStrictAuthCallbackOrigin: mocks.resolveStrictOrigin,
}));
vi.mock("@/lib/email/businessEmailBrand.server", () => ({
  resolveBusinessEmailBrand: mocks.resolveBrand,
}));
vi.mock("@/lib/email/passwordReset", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

import {
  createPasswordResetIntent,
  createPasswordResetState,
  findAuthUserByExactEmail,
  generateAuthRecoveryLink,
  passwordResetUserMatchesOrigin,
  processPasswordResetRequest,
  verifyPasswordResetIntent,
  verifyPasswordResetState,
} from "./recovery.server";

const USER_ID = "10000000-0000-4000-a000-000000000001";
const BUSINESS_ID = "20000000-0000-4000-a000-000000000001";
const PARTNER_ID = "30000000-0000-4000-a000-000000000001";
const OTHER_PARTNER_ID = "30000000-0000-4000-a000-000000000002";
const EMAIL = "owner@example.com";
const DIRECT_ORIGIN = {
  origin: "https://simplassist.com",
  kind: "direct" as const,
  partnerId: null,
};
const PARTNER_ORIGIN = {
  origin: "https://app.alphadogagency.ai",
  kind: "partner" as const,
  partnerId: PARTNER_ID,
};
const DIRECT_BRAND = {
  partnerId: null,
  name: "SimplAssist",
  publicOrigin: DIRECT_ORIGIN.origin,
  from: "SimplAssist <notifications@simplassist.com>",
  usedFallbackSender: false,
};

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: EMAIL,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

function business(partnerId: string | null = null) {
  return {
    id: BUSINESS_ID,
    owner_id: USER_ID,
    partner_id: partnerId,
    deleted_at: null,
  };
}

function configureBusinessQuery() {
  mocks.from.mockImplementation((table: string) => {
    mocks.tables.push(table);
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
    };
    chain.select.mockImplementation(() => {
      mocks.operations.push(`${table}:select`);
      return chain;
    });
    chain.eq.mockImplementation(() => {
      mocks.operations.push(`${table}:eq`);
      return chain;
    });
    chain.is.mockImplementation(async () => {
      mocks.operations.push(`${table}:is`);
      return mocks.businessResult;
    });
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-secret");
  mocks.tables.length = 0;
  mocks.operations.length = 0;
  mocks.businessResult = { data: [business()], error: null };
  configureBusinessQuery();
  mocks.listUsers.mockResolvedValue({
    data: { users: [authUser()], nextPage: null },
    error: null,
  });
  mocks.resolveStrictOrigin.mockResolvedValue(DIRECT_ORIGIN);
  mocks.resolveBrand.mockResolvedValue(DIRECT_BRAND);
  mocks.generateLink.mockResolvedValue({
    data: {
      properties: {
        hashed_token: "hashed-recovery-token",
        verification_type: "recovery",
      },
      user: authUser(),
    },
    error: null,
  });
  mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
});

describe("password reset callback state", () => {
  it("binds the signature to the exact origin and token hash", () => {
    const state = createPasswordResetState(
      DIRECT_ORIGIN.origin,
      "hashed-recovery-token",
    );

    expect(
      verifyPasswordResetState(
        DIRECT_ORIGIN.origin,
        "hashed-recovery-token",
        state,
      ),
    ).toBe(true);
    expect(
      verifyPasswordResetState(
        PARTNER_ORIGIN.origin,
        "hashed-recovery-token",
        state,
      ),
    ).toBe(false);
    expect(
      verifyPasswordResetState(DIRECT_ORIGIN.origin, "other-token", state),
    ).toBe(false);
    expect(
      verifyPasswordResetState(
        DIRECT_ORIGIN.origin,
        "hashed-recovery-token",
        `${state} `,
      ),
    ).toBe(false);
    expect(
      verifyPasswordResetState(
        DIRECT_ORIGIN.origin,
        "hashed-recovery-token",
        `${state.slice(0, -1)}!`,
      ),
    ).toBe(false);
  });
});

describe("password reset dependency surface", () => {
  const files = [
    new URL("./recovery.server.ts", import.meta.url),
    new URL("../../app/api/auth/forgot-password/route.ts", import.meta.url),
    new URL("../../app/api/auth/callback/route.ts", import.meta.url),
    new URL("../../app/api/auth/set-password/route.ts", import.meta.url),
    new URL("../email/passwordReset.ts", import.meta.url),
  ];
  const sources = files.map((file) => readFileSync(file, "utf8"));
  const source = sources.join("\n");

  it("never uses the client-template reset primitive or audit table", () => {
    expect(source).not.toContain("resetPasswordForEmail");
    expect(source).not.toContain("business_audit_events");
  });

  it("contains no shared-table mutation method", () => {
    for (const moduleSource of sources) {
      const tableChains =
        moduleSource.match(/\.from\([\s\S]*?;/g) ?? [];
      for (const tableChain of tableChains) {
        expect(tableChain).not.toMatch(
          /\.(?:insert|update|upsert|delete)\s*\(/,
        );
      }
      expect(moduleSource).not.toMatch(/supabaseAdmin\s*\.\s*rpc\s*\(/);
    }
  });
});

describe("password reset intent", () => {
  const issuedAt = Date.UTC(2026, 7, 7, 12, 0, 0);

  it("accepts the intended user and exact origin", () => {
    const intent = createPasswordResetIntent(
      USER_ID,
      PARTNER_ORIGIN.origin,
      issuedAt,
    );

    expect(
      verifyPasswordResetIntent(
        USER_ID,
        PARTNER_ORIGIN.origin,
        intent,
        issuedAt,
      ),
    ).toBe(true);
  });

  it("rejects a different user, origin, or tampered value", () => {
    const intent = createPasswordResetIntent(
      USER_ID,
      PARTNER_ORIGIN.origin,
      issuedAt,
    );
    const tampered = `${intent.slice(0, -1)}${intent.endsWith("A") ? "B" : "A"}`;

    expect(
      verifyPasswordResetIntent(
        "10000000-0000-4000-a000-000000000002",
        PARTNER_ORIGIN.origin,
        intent,
        issuedAt,
      ),
    ).toBe(false);
    expect(
      verifyPasswordResetIntent(
        USER_ID,
        DIRECT_ORIGIN.origin,
        intent,
        issuedAt,
      ),
    ).toBe(false);
    expect(
      verifyPasswordResetIntent(
        USER_ID,
        PARTNER_ORIGIN.origin,
        tampered,
        issuedAt,
      ),
    ).toBe(false);
  });

  it("expires immediately after fifteen minutes", () => {
    const intent = createPasswordResetIntent(
      USER_ID,
      DIRECT_ORIGIN.origin,
      issuedAt,
    );

    expect(
      verifyPasswordResetIntent(
        USER_ID,
        DIRECT_ORIGIN.origin,
        intent,
        issuedAt + 15 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      verifyPasswordResetIntent(
        USER_ID,
        DIRECT_ORIGIN.origin,
        intent,
        issuedAt + 15 * 60 * 1000 + 1,
      ),
    ).toBe(false);
  });

  it("rejects an intent issued more than thirty seconds in the future", () => {
    const intent = createPasswordResetIntent(
      USER_ID,
      DIRECT_ORIGIN.origin,
      issuedAt + 30_001,
    );

    expect(
      verifyPasswordResetIntent(
        USER_ID,
        DIRECT_ORIGIN.origin,
        intent,
        issuedAt,
      ),
    ).toBe(false);
  });

  it.each([null, undefined, "", "payload", "payload.signature.extra", "!.!"])(
    "rejects malformed intent value %s",
    (value) => {
      expect(
        verifyPasswordResetIntent(
          USER_ID,
          DIRECT_ORIGIN.origin,
          value,
          issuedAt,
        ),
      ).toBe(false);
    },
  );

  it("rejects malformed intent inputs at creation", () => {
    expect(() =>
      createPasswordResetIntent("not-a-uuid", DIRECT_ORIGIN.origin, issuedAt),
    ).toThrow("Password reset intent input is malformed");
    expect(() =>
      createPasswordResetIntent(
        USER_ID,
        `${DIRECT_ORIGIN.origin}/path`,
        issuedAt,
      ),
    ).toThrow("Password reset state input is malformed");
    expect(() =>
      createPasswordResetIntent(USER_ID, DIRECT_ORIGIN.origin, -1),
    ).toThrow("Password reset intent input is malformed");
  });
});

describe("findAuthUserByExactEmail", () => {
  it("exhaustively scans every Auth page after finding a match", async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        data: { users: [authUser()], nextPage: 2 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [
            authUser({
              id: "10000000-0000-4000-a000-000000000099",
              email: "other@example.com",
            }),
          ],
          nextPage: null,
        },
        error: null,
      });

    await expect(findAuthUserByExactEmail(EMAIL)).resolves.toMatchObject({
      id: USER_ID,
    });
    expect(mocks.listUsers).toHaveBeenNthCalledWith(1, {
      page: 1,
      perPage: 1000,
    });
    expect(mocks.listUsers).toHaveBeenNthCalledWith(2, {
      page: 2,
      perPage: 1000,
    });
  });

  it("rejects duplicate normalized Auth identities", async () => {
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [
          authUser(),
          authUser({ id: "10000000-0000-4000-a000-000000000002" }),
        ],
        nextPage: null,
      },
      error: null,
    });

    await expect(findAuthUserByExactEmail(EMAIL)).rejects.toThrow(
      "Auth email identity is ambiguous",
    );
  });
});

describe("processPasswordResetRequest", () => {
  it("generates and sends a signed direct-domain recovery link", async () => {
    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "simplassist.com",
    });

    expect(mocks.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: EMAIL,
      options: {
        redirectTo: "https://simplassist.com/api/auth/callback",
      },
    });
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const input = mocks.sendPasswordResetEmail.mock.calls[0][0];
    expect(input).toMatchObject({
      brand: DIRECT_BRAND,
      recipient: EMAIL,
    });
    const url = new URL(input.resetUrl);
    expect(url.origin).toBe(DIRECT_ORIGIN.origin);
    expect(url.pathname).toBe("/api/auth/callback");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      flow: "reset",
      type: "recovery",
      token_hash: "hashed-recovery-token",
    });
    expect(
      verifyPasswordResetState(
        url.origin,
        url.searchParams.get("token_hash")!,
        url.searchParams.get("state")!,
      ),
    ).toBe(true);
  });

  it("sends a partner-domain link with the resolved partner brand", async () => {
    const partnerBrand = {
      ...DIRECT_BRAND,
      partnerId: PARTNER_ID,
      name: "Alpha Dog Agency",
      publicOrigin: PARTNER_ORIGIN.origin,
      from: '"Alpha Dog Agency" <hello@alphadogagency.ai>',
    };
    mocks.businessResult = { data: [business(PARTNER_ID)], error: null };
    mocks.resolveBrand.mockResolvedValue(partnerBrand);
    mocks.resolveStrictOrigin.mockResolvedValue(PARTNER_ORIGIN);

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "app.alphadogagency.ai",
    });

    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ brand: partnerBrand }),
    );
    expect(
      new URL(mocks.sendPasswordResetEmail.mock.calls[0][0].resetUrl).origin,
    ).toBe(PARTNER_ORIGIN.origin);
  });

  it("sends a partner-domain link when the partner sender uses fallback", async () => {
    const fallbackPartnerBrand = {
      ...DIRECT_BRAND,
      partnerId: PARTNER_ID,
      name: "Alpha Dog Agency",
      publicOrigin: PARTNER_ORIGIN.origin,
      usedFallbackSender: true,
    };
    mocks.businessResult = { data: [business(PARTNER_ID)], error: null };
    mocks.resolveBrand.mockResolvedValue(fallbackPartnerBrand);
    mocks.resolveStrictOrigin.mockResolvedValue(PARTNER_ORIGIN);

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "app.alphadogagency.ai",
    });

    expect(mocks.generateLink).toHaveBeenCalledTimes(1);
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: fallbackPartnerBrand,
        recipient: EMAIL,
      }),
    );
    expect(
      new URL(mocks.sendPasswordResetEmail.mock.calls[0][0].resetUrl).origin,
    ).toBe(PARTNER_ORIGIN.origin);
  });

  it("does not issue a canonical reset for a partner user", async () => {
    mocks.businessResult = { data: [business(PARTNER_ID)], error: null };
    mocks.resolveStrictOrigin.mockResolvedValue(DIRECT_ORIGIN);

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "simplassist.com",
    });

    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not issue a reset on a different partner's domain", async () => {
    mocks.businessResult = { data: [business(PARTNER_ID)], error: null };
    mocks.resolveStrictOrigin.mockResolvedValue({
      origin: "https://app.other-partner.example",
      kind: "partner",
      partnerId: OTHER_PARTNER_ID,
    });

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "app.other-partner.example",
    });

    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("stops before scanning Auth for an inactive or unknown Host", async () => {
    mocks.resolveStrictOrigin.mockResolvedValue(null);

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "inactive.example",
    });

    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown email", null, [business()], DIRECT_ORIGIN, DIRECT_BRAND],
    ["missing business", authUser(), [], DIRECT_ORIGIN, DIRECT_BRAND],
    [
      "ambiguous business",
      authUser(),
      [business(), business()],
      DIRECT_ORIGIN,
      DIRECT_BRAND,
    ],
    ["unknown host", authUser(), [business()], null, DIRECT_BRAND],
    [
      "direct user on partner host",
      authUser(),
      [business()],
      PARTNER_ORIGIN,
      DIRECT_BRAND,
    ],
  ])(
    "does not generate a token for %s",
    async (_label, user, businesses, origin, brand) => {
      mocks.listUsers.mockResolvedValue({
        data: { users: user ? [user] : [], nextPage: null },
        error: null,
      });
      mocks.businessResult = { data: businesses, error: null };
      mocks.resolveStrictOrigin.mockResolvedValue(origin);
      mocks.resolveBrand.mockResolvedValue(brand);

      await processPasswordResetRequest({
        email: EMAIL,
        rawHost: "request.example",
      });

      expect(mocks.generateLink).not.toHaveBeenCalled();
      expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    },
  );

  it("rejects a generated link for a different Auth identity", async () => {
    mocks.generateLink.mockResolvedValue({
      data: {
        properties: {
          hashed_token: "hashed-recovery-token",
          verification_type: "recovery",
        },
        user: authUser({ id: "10000000-0000-4000-a000-000000000099" }),
      },
      error: null,
    });

    await expect(
      processPasswordResetRequest({ email: EMAIL, rawHost: "simplassist.com" }),
    ).rejects.toThrow("Generated recovery identity did not match");
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("reads only the businesses table and performs no shared-table mutation", async () => {
    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "simplassist.com",
    });

    expect(mocks.tables).toEqual(["businesses"]);
    expect(mocks.operations).toEqual([
      "businesses:select",
      "businesses:eq",
      "businesses:is",
    ]);
  });
});

describe("passwordResetUserMatchesOrigin", () => {
  it("requires the current business assignment and brand to match the Host", async () => {
    mocks.businessResult = { data: [business(PARTNER_ID)], error: null };
    mocks.resolveBrand.mockResolvedValue({
      ...DIRECT_BRAND,
      partnerId: PARTNER_ID,
      publicOrigin: PARTNER_ORIGIN.origin,
    });

    await expect(
      passwordResetUserMatchesOrigin(USER_ID, PARTNER_ORIGIN),
    ).resolves.toBe(true);
    await expect(
      passwordResetUserMatchesOrigin(USER_ID, DIRECT_ORIGIN),
    ).resolves.toBe(false);
  });
});

describe("latest recovery issuance wins across concierge and reset", () => {
  it("models Supabase's one-token pool, replay, replacement, and send failure", async () => {
    let sequence = 0;
    let currentToken: string | null = null;
    mocks.generateLink.mockImplementation(async ({ email }) => {
      currentToken = `token-${++sequence}`;
      return {
        data: {
          properties: {
            hashed_token: currentToken,
            verification_type: "recovery",
          },
          user: authUser({ email }),
        },
        error: null,
      };
    });
    const verify = (token: string) => {
      if (token !== currentToken) return false;
      currentToken = null;
      return true;
    };

    const setupA = await generateAuthRecoveryLink({
      email: EMAIL,
      redirectTo: `${PARTNER_ORIGIN.origin}/api/auth/callback`,
    });

    mocks.resolveStrictOrigin.mockResolvedValueOnce(PARTNER_ORIGIN);
    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "app.alphadogagency.ai",
    });
    expect(sequence).toBe(1);
    expect(currentToken).toBe(setupA.hashedToken);
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "simplassist.com",
    });
    const resetB = mocks.sendPasswordResetEmail.mock.calls[0][0].resetUrl;
    const resetBToken = new URL(resetB).searchParams.get("token_hash")!;
    expect(verify(setupA.hashedToken)).toBe(false);
    expect(verify(resetBToken)).toBe(true);
    expect(verify(resetBToken)).toBe(false);

    await processPasswordResetRequest({
      email: EMAIL,
      rawHost: "simplassist.com",
    });
    const resetB2 = mocks.sendPasswordResetEmail.mock.calls[1][0].resetUrl;
    const resetB2Token = new URL(resetB2).searchParams.get("token_hash")!;
    const setupC = await generateAuthRecoveryLink({
      email: EMAIL,
      redirectTo: `${PARTNER_ORIGIN.origin}/api/auth/callback`,
    });
    expect(verify(resetB2Token)).toBe(false);
    expect(verify(setupC.hashedToken)).toBe(true);

    const setupD = await generateAuthRecoveryLink({
      email: EMAIL,
      redirectTo: `${PARTNER_ORIGIN.origin}/api/auth/callback`,
    });
    mocks.sendPasswordResetEmail.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    await expect(
      processPasswordResetRequest({ email: EMAIL, rawHost: "simplassist.com" }),
    ).rejects.toThrow("provider unavailable");
    expect(verify(setupD.hashedToken)).toBe(false);
    expect(currentToken).toBe(`token-${sequence}`);
  });
});
