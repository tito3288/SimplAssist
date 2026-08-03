import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
  requestHeaders: new Map<string, string>(),
  getUser: vi.fn(),
  businessResult: { data: null, error: null } as QueryResult,
  businessThrows: false,
  customerSelects: [] as string[],
  customerFilters: [] as Array<[string, unknown]>,
  partnerSelects: [] as string[],
  partnerById: new Map<string, QueryResult>(),
  partnerByHost: new Map<string, QueryResult>(),
  partnerThrows: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("next/headers", () => ({
  headers: () => ({
    get: (name: string) => mocks.requestHeaders.get(name.toLowerCase()) ?? null,
  }),
}));
vi.mock("react", () => ({ cache: <Value,>(value: Value) => value }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.select = vi.fn((columns: string) => {
        mocks.customerSelects.push(columns);
        return chain;
      });
      chain.eq = vi.fn((field: string, value: unknown) => {
        mocks.customerFilters.push([field, value]);
        return chain;
      });
      chain.maybeSingle = vi.fn(async () => {
        if (mocks.businessThrows) throw new Error("customer lookup failed");
        return mocks.businessResult;
      });
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => {
      const filters = new Map<string, string>();
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      chain.select = vi.fn((columns: string) => {
        mocks.partnerSelects.push(columns);
        return chain;
      });
      chain.eq = vi.fn((field: string, value: string) => {
        filters.set(field, value);
        return chain;
      });
      chain.maybeSingle = vi.fn(async () => {
        if (mocks.partnerThrows) throw new Error("partner lookup failed");
        const id = filters.get("id");
        if (id) {
          return (
            mocks.partnerById.get(id) ?? { data: null, error: null }
          );
        }
        const hostname = filters.get("custom_domain");
        return hostname
          ? (mocks.partnerByHost.get(hostname) ?? {
              data: null,
              error: null,
            })
          : { data: null, error: { message: "missing lookup field" } };
      });
      return chain;
    },
  },
}));

import {
  getFreshWorkspaceAccess,
  getWorkspaceAccess,
} from "./workspaceAccess.server";

const USER_ID = "10000000-0000-4000-a000-000000000001";
const BUSINESS_ID = "20000000-0000-4000-a000-000000000001";
const PARTNER_A_ID = "30000000-0000-4000-a000-000000000001";
const PARTNER_B_ID = "30000000-0000-4000-a000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://simplassist.com";
  mocks.requestHeaders.clear();
  mocks.requestHeaders.set("host", "simplassist.com");
  mocks.getUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: "owner@example.com" } },
    error: null,
  });
  mocks.businessResult = {
    data: { id: BUSINESS_ID, partner_id: null },
    error: null,
  };
  mocks.businessThrows = false;
  mocks.customerSelects.length = 0;
  mocks.customerFilters.length = 0;
  mocks.partnerSelects.length = 0;
  mocks.partnerById.clear();
  mocks.partnerByHost.clear();
  mocks.partnerThrows = false;
});

describe("getWorkspaceAccess", () => {
  it("provides an explicit fresh policy decision after assignment changes", async () => {
    await expect(getFreshWorkspaceAccess()).resolves.toMatchObject({
      status: "resolved",
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    });

    setBusinessPartner(PARTNER_A_ID);
    addPartner(partnerA());

    await expect(getFreshWorkspaceAccess()).resolves.toEqual({
      status: "mismatch",
      expectedOrigin: "https://partner-a.example",
      expectedName: "Partner A",
    });
    expect(mocks.customerSelects).toEqual([
      "id, partner_id",
      "id, partner_id",
    ]);
  });

  it("uses the customer channel and returns unauthenticated without tenant reads", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "unauthenticated",
    });
    expect(mocks.customerSelects).toEqual([]);
    expect(mocks.partnerSelects).toEqual([]);
    expect(mocks.noStore).toHaveBeenCalledOnce();
  });

  it("returns business_not_found for an authenticated owner with no business", async () => {
    mocks.businessResult = { data: null, error: null };

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "business_not_found",
    });
    expect(mocks.customerSelects).toEqual(["id, partner_id"]);
    expect(mocks.customerFilters).toEqual([["owner_id", USER_ID]]);
  });

  it("treats a missing or expired customer credential as unauthenticated", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "unauthenticated",
    });

    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError("Session expired", 401, "session_expired"),
    });
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "unauthenticated",
    });
    expect(mocks.customerSelects).toEqual([]);
  });

  it("maps non-throwing Auth outages to retryable lookup failure", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError("Auth unavailable", 503),
    });
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });

    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError("Auth unavailable", 500, "unexpected_failure"),
    });
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
    expect(mocks.customerSelects).toEqual([]);
  });

  it.each([
    ["customer query error", { data: null, error: { message: "down" } }],
    ["malformed business id", { data: { id: "bad", partner_id: null }, error: null }],
    [
      "malformed partner id",
      { data: { id: BUSINESS_ID, partner_id: "bad" }, error: null },
    ],
  ])("fails closed for %s", async (_label, businessResult) => {
    mocks.businessResult = businessResult;

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it("maps a thrown customer lookup to lookup_failed", async () => {
    mocks.businessThrows = true;

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it("maps a thrown customer auth lookup to lookup_failed", async () => {
    mocks.getUser.mockRejectedValue(new Error("auth unavailable"));

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it.each([
    "simplassist.com",
    "SIMPLASSIST.COM",
    "simplassist.com.",
    "simplassist.com:443",
  ])("allows an unassigned business on normalized canonical Host %s", async (host) => {
    setHost(host);

    await expect(getWorkspaceAccess()).resolves.toMatchObject({
      status: "resolved",
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    });
    expect(mocks.partnerSelects).toEqual([]);
  });

  it.each([
    "partner-a.example",
    "PARTNER-A.EXAMPLE",
    "partner-a.example.",
    "partner-a.example:443",
  ])("allows only the assigned partner on normalized Host %s", async (host) => {
    setHost(host);
    setBusinessPartner(PARTNER_A_ID);
    addPartner(partnerA());

    await expect(getWorkspaceAccess()).resolves.toMatchObject({
      status: "resolved",
      business: { partner_id: PARTNER_A_ID },
      hostKind: "partner",
    });
    expect(mocks.partnerSelects).toEqual([
      "id, name, custom_domain, status, domain_status",
      "id, name, custom_domain, status, domain_status",
    ]);
  });

  it("blocks an assigned business on canonical with only its stored destination", async () => {
    setBusinessPartner(PARTNER_A_ID);
    addPartner(partnerA());

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "mismatch",
      expectedOrigin: "https://partner-a.example",
      expectedName: "Partner A",
    });
  });

  it("blocks an unassigned business on a partner Host with canonical destination", async () => {
    setHost("partner-a.example");
    addPartner(partnerA());

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "mismatch",
      expectedOrigin: "https://simplassist.com",
      expectedName: "SimplAssist",
    });
  });

  it("compares UUIDs and blocks Partner A on Partner B with Partner A destination", async () => {
    setHost("partner-b.example");
    setBusinessPartner(PARTNER_A_ID);
    addPartner(partnerA());
    addPartner(partnerB());

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "mismatch",
      expectedOrigin: "https://partner-a.example",
      expectedName: "Partner A",
    });
  });

  it("resolves a partner Host through its row and compares the assigned UUID", async () => {
    setHost("partner-a.example");
    setBusinessPartner(PARTNER_A_ID);
    addPartner(partnerA());

    await expect(getWorkspaceAccess()).resolves.toMatchObject({
      status: "resolved",
      hostKind: "partner",
    });
    expect(mocks.partnerSelects).toEqual([
      "id, name, custom_domain, status, domain_status",
      "id, name, custom_domain, status, domain_status",
    ]);
  });

  it.each([
    null,
    "",
    "unknown.example",
    "www.simplassist.com",
    "simplassist.com.evil.example",
    "https://simplassist.com",
    "user@simplassist.com",
    " simplassist.com",
    "simplassist.com,partner-a.example",
    "bad..example",
  ])("fails closed for absent, unknown, or malformed Host %s", async (host) => {
    setHost(host);

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "unknown_host",
    });
  });

  it("ignores forwarded and preview headers", async () => {
    setHost("simplassist.com");
    mocks.requestHeaders.set("x-forwarded-host", "partner-a.example");
    mocks.requestHeaders.set("forwarded", "host=partner-a.example");
    mocks.requestHeaders.set("x-sa-brand-preview", "partner-a");
    addPartner(partnerA());

    await expect(getWorkspaceAccess()).resolves.toMatchObject({
      status: "resolved",
      hostKind: "canonical",
    });
    expect(mocks.partnerSelects).toEqual([]);
  });

  it("does not let a forwarded canonical Host rescue an unknown actual Host", async () => {
    setHost("unknown.example");
    mocks.requestHeaders.set("x-forwarded-host", "simplassist.com");

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "unknown_host",
    });
  });

  it.each([
    ["inactive", partnerA({ status: "inactive" })],
    ["pending", partnerA({ domain_status: "pending" })],
  ])("makes an assigned %s partner unavailable everywhere", async (_label, partner) => {
    setBusinessPartner(PARTNER_A_ID);
    addPartner(partner);

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "partner_unavailable",
    });

    setHost("partner-a.example");
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "partner_unavailable",
    });

    setHost(null);
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "partner_unavailable",
    });
  });

  it("makes a deleted assigned partner unavailable", async () => {
    setBusinessPartner(PARTNER_A_ID);

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "partner_unavailable",
    });
  });

  it("fails closed when an unavailable partner domain is requested", async () => {
    setHost("partner-a.example");
    addPartner(partnerA({ status: "inactive" }));

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "partner_unavailable",
    });
  });

  it.each([
    ["assigned query error", "canonical"],
    ["host query error", "partner"],
  ])("maps %s to lookup_failed", async (_label, kind) => {
    if (kind === "canonical") {
      setBusinessPartner(PARTNER_A_ID);
      mocks.partnerById.set(PARTNER_A_ID, {
        data: null,
        error: { message: "down" },
      });
    } else {
      setHost("partner-a.example");
      mocks.partnerByHost.set("partner-a.example", {
        data: null,
        error: { message: "down" },
      });
    }

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it("maps malformed stored partner tenancy data to lookup_failed", async () => {
    setBusinessPartner(PARTNER_A_ID);
    mocks.partnerById.set(PARTNER_A_ID, {
      data: partnerA({ custom_domain: "https://partner-a.example" }),
      error: null,
    });

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it("rejects a stored partner domain without a DNS suffix", async () => {
    setBusinessPartner(PARTNER_A_ID);
    mocks.partnerById.set(PARTNER_A_ID, {
      data: partnerA({ custom_domain: "intranet" }),
      error: null,
    });

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it("treats a partner domain colliding with canonical as unavailable", async () => {
    setBusinessPartner(PARTNER_A_ID);
    addPartner(partnerA({ custom_domain: "simplassist.com" }));

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "partner_unavailable",
    });
  });

  it("rejects a partner row that does not match the exact lookup key", async () => {
    setBusinessPartner(PARTNER_A_ID);
    mocks.partnerById.set(PARTNER_A_ID, {
      data: partnerB(),
      error: null,
    });

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });

    setBusinessPartner(null);
    setHost("partner-a.example");
    mocks.partnerByHost.set("partner-a.example", {
      data: partnerB(),
      error: null,
    });
    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });

  it("fails closed if canonical origin becomes malformed after initialization", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "not a URL";

    await expect(getWorkspaceAccess()).resolves.toEqual({
      status: "lookup_failed",
    });
  });
});

function setHost(value: string | null): void {
  if (value === null || value === "") mocks.requestHeaders.delete("host");
  else mocks.requestHeaders.set("host", value);
}

function setBusinessPartner(partnerId: string | null): void {
  mocks.businessResult = {
    data: { id: BUSINESS_ID, partner_id: partnerId },
    error: null,
  };
}

function addPartner(partner: Record<string, unknown>): void {
  const result = { data: partner, error: null };
  mocks.partnerById.set(partner.id as string, result);
  if (typeof partner.custom_domain === "string") {
    mocks.partnerByHost.set(partner.custom_domain, result);
  }
}

function partnerA(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_A_ID,
    name: "Partner A",
    custom_domain: "partner-a.example",
    status: "active",
    domain_status: "connected",
    ...overrides,
  };
}

function partnerB(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_B_ID,
    name: "Partner B",
    custom_domain: "partner-b.example",
    status: "active",
    domain_status: "connected",
    ...overrides,
  };
}
