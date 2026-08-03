import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  businessResult: { data: null, error: null } as QueryResult,
  partnerResult: { data: null, error: null } as QueryResult,
  businessThrows: false,
  partnerThrows: false,
  selects: [] as Array<[string, string]>,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({
  RESEND_FROM: "SimplAssist <notifications@simplassist.com>",
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  BusinessEmailBrandResolutionError,
  resolveBusinessEmailBrand,
} from "./businessEmailBrand.server";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const PARTNER_ID = "20000000-0000-4000-a000-000000000001";
const ADMIN_ID = "30000000-0000-4000-a000-000000000001";
const DEFAULT_BRAND = {
  partnerId: null,
  name: "SimplAssist",
  publicOrigin: "https://simplassist.com",
  from: "SimplAssist <notifications@simplassist.com>",
  usedFallbackSender: false,
};

function partner(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_ID,
    name: "Alpha Dog Agency",
    custom_domain: "app.alphadogagency.ai",
    status: "active",
    domain_status: "connected",
    email_from: null,
    email_from_status: "unconfigured",
    email_from_verified_at: null,
    email_from_verified_by: null,
    ...overrides,
  };
}

function configureQueries() {
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn((columns: string) => {
      mocks.selects.push([table, columns]);
      return chain;
    });
    chain.eq = vi.fn((field: string, value: unknown) => {
      mocks.filters.push([table, field, value]);
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => {
      if (table === "businesses") {
        if (mocks.businessThrows) throw new Error("business offline");
        return mocks.businessResult;
      }
      if (table === "partners") {
        if (mocks.partnerThrows) throw new Error("partner offline");
        return mocks.partnerResult;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
  mocks.businessResult = {
    data: { partner_id: PARTNER_ID },
    error: null,
  };
  mocks.partnerResult = { data: partner(), error: null };
  mocks.businessThrows = false;
  mocks.partnerThrows = false;
  mocks.selects.length = 0;
  mocks.filters.length = 0;
  configureQueries();
});

describe("resolveBusinessEmailBrand", () => {
  it("returns the exact default without a business lookup for null", async () => {
    await expect(resolveBusinessEmailBrand(null)).resolves.toEqual(DEFAULT_BRAND);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns the exact default for an existing unassigned business", async () => {
    mocks.businessResult = { data: { partner_id: null }, error: null };

    await expect(resolveBusinessEmailBrand(BUSINESS_ID)).resolves.toEqual(
      DEFAULT_BRAND,
    );
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unconfigured", null],
    ["pending", "billing@alphadogagency.ai"],
  ])(
    "keeps partner presentation but uses the fallback sender when %s",
    async (status, emailFrom) => {
      mocks.partnerResult = {
        data: partner({
          email_from_status: status,
          email_from: emailFrom,
        }),
        error: null,
      };

      await expect(resolveBusinessEmailBrand(BUSINESS_ID)).resolves.toEqual({
        partnerId: PARTNER_ID,
        name: "Alpha Dog Agency",
        publicOrigin: "https://app.alphadogagency.ai",
        from: "SimplAssist <notifications@simplassist.com>",
        usedFallbackSender: true,
      });
    },
  );

  it("uses a verified normalized mailbox with a safely quoted display name", async () => {
    mocks.partnerResult = {
      data: partner({
        name: 'Alpha "Dogs" \\ Agency',
        email_from: "billing@alphadogagency.ai",
        email_from_status: "verified",
        email_from_verified_at: "2026-08-03T12:00:00.000Z",
        email_from_verified_by: ADMIN_ID,
      }),
      error: null,
    };

    await expect(resolveBusinessEmailBrand(BUSINESS_ID)).resolves.toEqual({
      partnerId: PARTNER_ID,
      name: 'Alpha "Dogs" \\ Agency',
      publicOrigin: "https://app.alphadogagency.ai",
      from:
        '"Alpha \\"Dogs\\" \\\\ Agency" <billing@alphadogagency.ai>',
      usedFallbackSender: false,
    });
  });

  it("keeps different assigned partners isolated without Host or preview input", async () => {
    const secondPartnerId = "20000000-0000-4000-a000-000000000002";
    mocks.businessResult = {
      data: { partner_id: secondPartnerId },
      error: null,
    };
    mocks.partnerResult = {
      data: partner({
        id: secondPartnerId,
        name: "Beta Partner",
        custom_domain: "app.beta.example",
        email_from: "hello@beta.example",
        email_from_status: "verified",
        email_from_verified_at: "2026-08-03T12:00:00.000Z",
        email_from_verified_by: ADMIN_ID,
      }),
      error: null,
    };

    const brand = await resolveBusinessEmailBrand(BUSINESS_ID);

    expect(brand).toMatchObject({
      partnerId: secondPartnerId,
      name: "Beta Partner",
      publicOrigin: "https://app.beta.example",
      from: '"Beta Partner" <hello@beta.example>',
    });
    expect(mocks.filters).toContainEqual([
      "partners",
      "id",
      secondPartnerId,
    ]);
  });

  it.each([
    ["business query error", "business_lookup_failed", () => {
      mocks.businessResult = { data: null, error: { message: "offline" } };
    }],
    ["business throw", "business_lookup_failed", () => {
      mocks.businessThrows = true;
    }],
    ["missing business", "business_missing", () => {
      mocks.businessResult = { data: null, error: null };
    }],
    ["malformed assignment", "assignment_malformed", () => {
      mocks.businessResult = { data: { partner_id: "bad" }, error: null };
    }],
    ["partner query error", "partner_lookup_failed", () => {
      mocks.partnerResult = { data: null, error: { message: "offline" } };
    }],
    ["partner throw", "partner_lookup_failed", () => {
      mocks.partnerThrows = true;
    }],
    ["missing partner", "partner_missing", () => {
      mocks.partnerResult = { data: null, error: null };
    }],
    ["inactive partner", "partner_unavailable", () => {
      mocks.partnerResult = { data: partner({ status: "inactive" }), error: null };
    }],
    ["pending domain", "partner_unavailable", () => {
      mocks.partnerResult = {
        data: partner({ domain_status: "pending" }),
        error: null,
      };
    }],
    ["canonical domain collision", "partner_unavailable", () => {
      mocks.partnerResult = {
        data: partner({ custom_domain: "simplassist.com" }),
        error: null,
      };
    }],
  ] as const)("throws a typed error for %s", async (_label, code, arrange) => {
    arrange();

    const promise = resolveBusinessEmailBrand(BUSINESS_ID);
    await expect(promise).rejects.toBeInstanceOf(
      BusinessEmailBrandResolutionError,
    );
    await expect(promise).rejects.toMatchObject({ code });
  });

  it.each([
    ["mismatched partner id", { id: "20000000-0000-4000-a000-000000000099" }],
    ["noncanonical domain", { custom_domain: "APP.ALPHADOGAGENCY.AI" }],
    ["domain with scheme", { custom_domain: "https://app.alphadogagency.ai" }],
    ["empty name", { name: "   " }],
    ["header control in name", { name: "Alpha\r\nBcc: victim@example.com" }],
  ])("rejects malformed partner data: %s", async (_label, overrides) => {
    mocks.partnerResult = { data: partner(overrides), error: null };

    await expect(resolveBusinessEmailBrand(BUSINESS_ID)).rejects.toMatchObject({
      name: "BusinessEmailBrandResolutionError",
      code: "partner_malformed",
    });
  });

  it.each([
    ["uppercase mailbox", { email_from: "Billing@alphadogagency.ai" }],
    ["display header mailbox", { email_from: "Alpha <billing@alphadogagency.ai>" }],
    ["newline mailbox", { email_from: "billing@alpha.example\r\nBcc:x@y.example" }],
    ["bad verified timestamp", { email_from_verified_at: "not-a-date" }],
    ["bad verifier", { email_from_verified_by: "not-a-uuid" }],
    ["unknown status", { email_from_status: "unknown" }],
  ])("rejects malformed verified sender state: %s", async (_label, overrides) => {
    mocks.partnerResult = {
      data: partner({
        email_from: "billing@alphadogagency.ai",
        email_from_status: "verified",
        email_from_verified_at: "2026-08-03T12:00:00.000Z",
        email_from_verified_by: ADMIN_ID,
        ...overrides,
      }),
      error: null,
    };

    await expect(resolveBusinessEmailBrand(BUSINESS_ID)).rejects.toMatchObject({
      name: "BusinessEmailBrandResolutionError",
      code: "sender_state_malformed",
    });
  });

  it.each([
    ["unconfigured with address", { email_from: "billing@alpha.example" }],
    [
      "pending with verification audit",
      {
        email_from: "billing@alpha.example",
        email_from_status: "pending",
        email_from_verified_at: "2026-08-03T12:00:00.000Z",
        email_from_verified_by: ADMIN_ID,
      },
    ],
  ])("rejects inconsistent sender state: %s", async (_label, overrides) => {
    mocks.partnerResult = { data: partner(overrides), error: null };

    await expect(resolveBusinessEmailBrand(BUSINESS_ID)).rejects.toMatchObject({
      code: "sender_state_malformed",
    });
  });
});
