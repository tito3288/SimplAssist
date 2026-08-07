import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARTNER_DOMAIN = "app.alphadogagency.ai";
const PARTNER_ID = "20000000-0000-4000-a000-000000000001";
const USER_ID = "10000000-0000-4000-a000-000000000001";
const PASSWORD_RESET_INTENT_COOKIE = "simplassist-reset-intent";
const PASSWORD_RESET_INTENT = "reset-intent-payload.reset-intent-signature";
const SUPABASE_AUTH_COOKIE = "sb-test-project-auth-token";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  cookiesGetAll: vi.fn(),
  verifyPasswordResetState: vi.fn(),
  createPasswordResetIntent: vi.fn(),
  passwordResetUserMatchesOrigin: vi.fn(),
  from: vi.fn(),
  partnerResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: mocks.cookiesGetAll }),
}));
vi.mock("@/lib/auth/recovery.server", () => ({
  PASSWORD_RESET_INTENT_COOKIE: "simplassist-reset-intent",
  createPasswordResetIntent: mocks.createPasswordResetIntent,
  verifyPasswordResetState: mocks.verifyPasswordResetState,
  passwordResetUserMatchesOrigin: mocks.passwordResetUserMatchesOrigin,
}));

import { GET } from "./route";

function connectedPartnerRow(customDomain = PARTNER_DOMAIN) {
  return {
    id: PARTNER_ID,
    custom_domain: customDomain,
    status: "active",
    domain_status: "connected",
  };
}

function request(
  query = "",
  headers: Record<string, string> = { host: "simplassist.com" },
) {
  return new NextRequest(`http://localhost:8080/api/auth/callback${query}`, {
    headers,
  });
}

function expectForcedResetSessionCleanup(response: NextResponse) {
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.cookiesGetAll).toHaveBeenCalledOnce();

  const expiredCookieNames = [
    PASSWORD_RESET_INTENT_COOKIE,
    SUPABASE_AUTH_COOKIE,
    ...Array.from(
      { length: 8 },
      (_, index) => `${SUPABASE_AUTH_COOKIE}.${index}`,
    ),
    `${SUPABASE_AUTH_COOKIE}.12`,
  ];
  for (const name of expiredCookieNames) {
    expect(response.cookies.get(name)).toEqual(
      expect.objectContaining({
        name,
        value: "",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      }),
    );
  }
  expect(response.cookies.get("unrelated-cookie")).toBeUndefined();
  expect(response.cookies.getAll()).toHaveLength(expiredCookieNames.length);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
  mocks.createClient.mockResolvedValue({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
      signOut: mocks.signOut,
    },
  });
  mocks.verifyOtp.mockResolvedValue({
    data: {
      user: { id: USER_ID },
      session: { access_token: "session-token" },
    },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cookiesGetAll.mockReturnValue([
    { name: `${SUPABASE_AUTH_COOKIE}.12`, value: "request-cookie-value" },
    { name: "unrelated-cookie", value: "keep-me" },
  ]);
  mocks.verifyPasswordResetState.mockReturnValue(true);
  mocks.createPasswordResetIntent.mockReturnValue(PASSWORD_RESET_INTENT);
  mocks.passwordResetUserMatchesOrigin.mockResolvedValue(true);
  mocks.partnerResult = { data: null, error: null };
  mocks.from.mockImplementation(() => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockImplementation(async () => mocks.partnerResult);
    return chain;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("auth callback", () => {
  it("exchanges a code and sends the canonical Host to dashboard guards", async () => {
    const response = await GET(
      request("?code=valid-code", { host: "SIMPLASSIST.COM:443" }),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });

  it("does not treat an unrelated OAuth state parameter as password recovery", async () => {
    const response = await GET(
      request("?code=valid-code&state=oauth-state", {
        host: "simplassist.com",
      }),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(mocks.verifyPasswordResetState).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });

  it("keeps an exact active, connected partner Host on its stored domain", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request("?code=partner-code", {
        host: "APP.ALPHADOGAGENCY.AI:443",
      }),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("partner-code");
    expect(response.headers.get("location")).toBe(
      "https://app.alphadogagency.ai/dashboard",
    );

    const chain = mocks.from.mock.results[0]?.value;
    expect(mocks.from).toHaveBeenCalledWith("partners");
    expect(chain.select).toHaveBeenCalledWith(
      "custom_domain, status, domain_status",
    );
    expect(chain.eq).toHaveBeenCalledWith("custom_domain", PARTNER_DOMAIN);
    expect(chain.eq).toHaveBeenCalledWith("status", "active");
    expect(chain.eq).toHaveBeenCalledWith("domain_status", "connected");
  });

  it("uses the same exact partner-origin rule for OTP verification", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request("?token_hash=otp-token&type=signup", {
        host: PARTNER_DOMAIN,
      }),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "otp-token",
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://app.alphadogagency.ai/dashboard",
    );
  });

  it("verifies an exact signed direct reset before opening its recovery session", async () => {
    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
      ),
    );

    expect(mocks.verifyPasswordResetState).toHaveBeenCalledWith(
      "https://simplassist.com",
      "reset-token",
      "signed-state",
    );
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "reset-token",
    });
    expect(mocks.passwordResetUserMatchesOrigin).toHaveBeenCalledWith(USER_ID, {
      origin: "https://simplassist.com",
      kind: "direct",
      partnerId: null,
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.createPasswordResetIntent).toHaveBeenCalledWith(
      USER_ID,
      "https://simplassist.com",
    );
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset",
    );
    expect(response.cookies.get(PASSWORD_RESET_INTENT_COOKIE)).toEqual(
      expect.objectContaining({
        name: PASSWORD_RESET_INTENT_COOKIE,
        value: PASSWORD_RESET_INTENT,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 900,
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("keeps a signed reset on its exact active, connected partner origin", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=partner-state",
        { host: PARTNER_DOMAIN },
      ),
    );

    const chain = mocks.from.mock.results[0]?.value;
    expect(chain.select).toHaveBeenCalledWith(
      "id, custom_domain, status, domain_status",
    );
    expect(mocks.verifyPasswordResetState).toHaveBeenCalledWith(
      `https://${PARTNER_DOMAIN}`,
      "reset-token",
      "partner-state",
    );
    expect(mocks.passwordResetUserMatchesOrigin).toHaveBeenCalledWith(USER_ID, {
      origin: `https://${PARTNER_DOMAIN}`,
      kind: "partner",
      partnerId: PARTNER_ID,
    });
    expect(response.headers.get("location")).toBe(
      `https://${PARTNER_DOMAIN}/set-password?mode=reset`,
    );
  });

  it.each([
    "?type=recovery&token_hash=reset-token&state=signed-state",
    "?flow=reset&type=recovery&token_hash=reset-token",
    "?flow=reset&type=signup&token_hash=reset-token&state=signed-state",
    "?flow=reset&type=recovery&token_hash=%20&state=signed-state",
    "?flow=reset&type=recovery&token_hash=reset-token&state=%20",
    "?flow=reset&flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
    "?flow=reset&type=recovery&type=recovery&token_hash=reset-token&state=signed-state",
    "?flow=reset&type=recovery&token_hash=reset-token&token_hash=second&state=signed-state",
    "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state&state=second",
    "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state&code=code",
    "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state&next=%2Fdashboard",
  ])("rejects malformed signed reset callback %s before verification", async (query) => {
    const response = await GET(request(query));

    expect(mocks.verifyPasswordResetState).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("does not let stripped reset state fall through to ordinary recovery verification", async () => {
    const response = await GET(
      request("?type=recovery&token_hash=reset-token"),
    );

    expect(mocks.verifyPasswordResetState).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects an invalid reset signature before consuming the token", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };
    mocks.verifyPasswordResetState.mockReturnValue(false);

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=wrong-state",
        { host: PARTNER_DOMAIN },
      ),
    );

    expect(mocks.verifyPasswordResetState).toHaveBeenCalledOnce();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      `https://${PARTNER_DOMAIN}/set-password?mode=reset&status=invalid-link`,
    );
  });

  it.each([
    {
      label: "inactive partner",
      result: {
        data: { ...connectedPartnerRow(), status: "inactive" },
        error: null,
      },
    },
    {
      label: "unconnected partner",
      result: {
        data: { ...connectedPartnerRow(), domain_status: "pending" },
        error: null,
      },
    },
    {
      label: "partner without a valid identity",
      result: {
        data: { ...connectedPartnerRow(), id: "not-a-uuid" },
        error: null,
      },
    },
    {
      label: "partner lookup error",
      result: { data: null, error: { message: "database unavailable" } },
    },
  ])("does not consume a reset token for $label", async ({ result }) => {
    mocks.partnerResult = result;

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
        { host: PARTNER_DOMAIN },
      ),
    );

    expect(mocks.verifyPasswordResetState).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
  });

  it.each([
    "unknown.example.com",
    "app.alphadogagency.ai.evil.example",
    "app.alphadogagency.ai,evil.example",
  ])("does not consume a reset token for untrusted Host %s", async (host) => {
    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
        { host },
      ),
    );

    expect(mocks.verifyPasswordResetState).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
  });

  it.each([
    {
      label: "expired token",
      result: {
        data: { user: null, session: null },
        error: { message: "raw OTP error that must not escape" },
      },
    },
    {
      label: "already-used token",
      result: {
        data: { user: null, session: null },
        error: { message: "raw OTP error that must not escape" },
      },
    },
    {
      label: "missing user",
      result: {
        data: { user: null, session: { access_token: "session-token" } },
        error: null,
      },
    },
    {
      label: "missing session",
      result: { data: { user: { id: USER_ID }, session: null }, error: null },
    },
  ])("shows the fixed invalid-link destination for $label", async ({ result }) => {
    mocks.verifyOtp.mockResolvedValue(result);

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=used-token&state=signed-state",
      ),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    expect(mocks.passwordResetUserMatchesOrigin).not.toHaveBeenCalled();
    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
    expect(response.headers.get("location")).not.toContain("raw");
  });

  it("turns verification throws into the same invalid-link destination", async () => {
    mocks.verifyOtp.mockRejectedValue(new Error("sensitive provider detail"));

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=expired-token&state=signed-state",
      ),
    );

    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
    expect(response.headers.get("location")).not.toContain("sensitive");
  });

  it("clears a verified reset session when the user no longer matches the origin", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };
    mocks.passwordResetUserMatchesOrigin.mockResolvedValue(false);

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
        { host: PARTNER_DOMAIN },
      ),
    );

    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      `https://${PARTNER_DOMAIN}/set-password?mode=reset&status=invalid-link`,
    );
  });

  it("clears the reset session when the post-verification origin check throws", async () => {
    mocks.passwordResetUserMatchesOrigin.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
      ),
    );

    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
  });

  it("forces auth-cookie expiry when local sign-out resolves with an error", async () => {
    mocks.passwordResetUserMatchesOrigin.mockResolvedValue(false);
    mocks.signOut.mockResolvedValue({
      error: { message: "provider sign-out failure" },
    });

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
      ),
    );

    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
  });

  it("clears the verified session when reset-intent signing throws", async () => {
    mocks.createPasswordResetIntent.mockImplementation(() => {
      throw new Error("reset intent signing failed");
    });

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=reset-token&state=signed-state",
      ),
    );

    expect(mocks.createPasswordResetIntent).toHaveBeenCalledWith(
      USER_ID,
      "https://simplassist.com",
    );
    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/set-password?mode=reset&status=invalid-link",
    );
  });

  it("does not expose a partner provider error for an expired reset token", async () => {
    const providerError = "raw partner OTP detail that must not escape";
    const consoleSpies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };
    mocks.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: providerError },
    });

    const response = await GET(
      request(
        "?flow=reset&type=recovery&token_hash=expired-token&state=signed-state",
        { host: PARTNER_DOMAIN },
      ),
    );

    expectForcedResetSessionCleanup(response);
    expect(response.headers.get("location")).toBe(
      `https://${PARTNER_DOMAIN}/set-password?mode=reset&status=invalid-link`,
    );
    expect(await response.clone().text()).not.toContain(providerError);
    expect(JSON.stringify(Array.from(response.headers.entries()))).not.toContain(
      providerError,
    );
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(providerError);
    }
  });

  it("accepts only an exact successful concierge recovery on a connected partner Host", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request(
        "?token_hash=recovery-token&type=recovery&flow=concierge",
        { host: PARTNER_DOMAIN },
      ),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: "recovery-token",
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://app.alphadogagency.ai/set-password",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    "?token_hash=recovery-token&type=signup&flow=concierge",
    "?type=recovery&flow=concierge",
    "?token_hash=%20&type=recovery&flow=concierge",
    "?token_hash=recovery-token&type=recovery&flow=concierge&flow=concierge",
    "?token_hash=recovery-token&type=recovery&type=signup&flow=concierge",
    "?code=code&token_hash=recovery-token&type=recovery&flow=concierge",
    "?token_hash=recovery-token&type=recovery&flow=unknown",
  ])("rejects malformed reserved recovery callback %s", async (query) => {
    const response = await GET(request(query));

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/login",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["expired", "replayed"])(
    "fails a %s concierge recovery token safely",
    async () => {
      mocks.partnerResult = { data: connectedPartnerRow(), error: null };
      mocks.verifyOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: "OTP is invalid or has expired" },
      });

      const response = await GET(
        request("?token_hash=used-token&type=recovery&flow=concierge", {
          host: PARTNER_DOMAIN,
        }),
      );

      expect(response.headers.get("location")).toBe(
        "https://app.alphadogagency.ai/login",
      );
      expect(response.headers.get("location")).not.toContain("set-password");
      expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      label: "canonical Host",
      host: "simplassist.com",
      result: { data: null, error: null },
    },
    {
      label: "unknown Host",
      host: "unknown.example.com",
      result: { data: null, error: null },
    },
    {
      label: "pending partner",
      host: PARTNER_DOMAIN,
      result: {
        data: { ...connectedPartnerRow(), domain_status: "pending" },
        error: null,
      },
    },
    {
      label: "inactive partner",
      host: PARTNER_DOMAIN,
      result: {
        data: { ...connectedPartnerRow(), status: "inactive" },
        error: null,
      },
    },
    {
      label: "partner lookup failure",
      host: PARTNER_DOMAIN,
      result: { data: null, error: { message: "database unavailable" } },
    },
  ])(
    "does not consume a concierge token on $label",
    async ({ host, result }) => {
      mocks.partnerResult = result;

      const response = await GET(
        request(
          "?token_hash=recovery-token&type=recovery&flow=concierge",
          { host },
        ),
      );

      expect(mocks.verifyOtp).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe(
        "https://simplassist.com/login",
      );
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    },
  );

  it("does not consume a concierge token from forwarded-host spoofing", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request(
        "?token_hash=recovery-token&type=recovery&flow=concierge",
        {
          host: "unknown.example.com",
          "x-forwarded-host": PARTNER_DOMAIN,
          forwarded: `host=${PARTNER_DOMAIN};proto=https`,
        },
      ),
    );

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/login",
    );
  });

  it("ignores an arbitrary next target on successful concierge recovery", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request(
        "?token_hash=recovery-token&type=recovery&flow=concierge&next=https%3A%2F%2Fevil.example",
        { host: PARTNER_DOMAIN },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.alphadogagency.ai/set-password",
    );
    expect(response.headers.get("location")).not.toContain("evil.example");
  });

  it.each([
    ["pending", connectedPartnerRow()],
    ["inactive", connectedPartnerRow()],
  ])("falls back to canonical for a %s partner", async (state, row) => {
    mocks.partnerResult = {
      data:
        state === "pending"
          ? { ...row, domain_status: "pending" }
          : { ...row, status: "inactive" },
      error: null,
    };

    const response = await GET(
      request("?code=valid-code", { host: PARTNER_DOMAIN }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });

  it.each([
    "unknown.example.com",
    "app.alphadogagency.ai.evil.example",
    "www.app.alphadogagency.ai",
    "app.alphadogagency.ai,evil.example",
  ])("falls back to canonical for unknown or invalid Host %s", async (host) => {
    const response = await GET(
      request("?code=valid-code", { host }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });

  it("never redirects to a stored row that does not exactly match Host", async () => {
    mocks.partnerResult = { data: connectedPartnerRow(), error: null };

    const response = await GET(
      request("?code=valid-code", { host: "different.example.com" }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });

  it("ignores X-Forwarded-Host and Forwarded even when they name a partner", async () => {
    const response = await GET(
      request("?code=valid-code", {
        host: "unknown.example.com",
        "x-forwarded-host": PARTNER_DOMAIN,
        forwarded: `host=${PARTNER_DOMAIN};proto=https`,
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
    const chain = mocks.from.mock.results[0]?.value;
    expect(chain.eq).toHaveBeenCalledWith(
      "custom_domain",
      "unknown.example.com",
    );
  });

  it("ignores preview query, header, and cookie when choosing the return origin", async () => {
    const response = await GET(
      request("?code=valid-code&brand=alpha-dog", {
        host: "simplassist.com",
        "x-sa-brand-preview": "alpha-dog",
        cookie: "sa-admin-brand-preview=alpha-dog",
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("falls back to canonical when the partner lookup fails", async () => {
    mocks.partnerResult = {
      data: null,
      error: { message: "database unavailable" },
    };

    const response = await GET(
      request("?code=valid-code", { host: PARTNER_DOMAIN }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });

  it("uses the canonical fallback instead of an arbitrary request origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const response = await GET(
      request("", { host: "preview.example.test" }),
    );

    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard",
    );
  });
});
