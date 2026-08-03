import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARTNER_DOMAIN = "app.alphadogagency.ai";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  from: vi.fn(),
  partnerResult: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { GET } from "./route";

function connectedPartnerRow(customDomain = PARTNER_DOMAIN) {
  return {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
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
