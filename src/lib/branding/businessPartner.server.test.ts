import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  BusinessPartnerResolutionError,
  resolveConnectedBusinessPartner,
  resolveWidgetAttribution,
} from "./businessPartner.server";

type QueryResult = { data?: unknown; error?: unknown; reject?: unknown };

function queueDatabaseResults(...results: QueryResult[]) {
  const queue = [...results];
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq"]) {
      chain[method] = vi.fn(() => chain);
    }
    const { reject, ...resolvedResult } = result;
    chain.maybeSingle = reject
      ? vi.fn().mockRejectedValue(reject)
      : vi.fn().mockResolvedValue({
          data: null,
          error: null,
          ...resolvedResult,
        });
    return chain;
  });
}

const alphaDog = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Alpha Dog Agency",
  custom_domain: "app.alphadogagency.ai",
  status: "active",
  domain_status: "connected",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
  queueDatabaseResults();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveConnectedBusinessPartner", () => {
  it("returns only an active, connected assigned partner with a stored domain", async () => {
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: alphaDog, error: null },
    );

    await expect(resolveConnectedBusinessPartner("business-1")).resolves.toEqual({
      partnerId: alphaDog.id,
      name: "Alpha Dog Agency",
      customDomain: "app.alphadogagency.ai",
      publicOrigin: "https://app.alphadogagency.ai",
    });
    expect(mocks.from).toHaveBeenNthCalledWith(1, "businesses");
    expect(mocks.from).toHaveBeenNthCalledWith(2, "partners");
  });

  it.each([
    ["pending", { domain_status: "pending" }],
    ["inactive", { status: "inactive" }],
  ])("does not expose a %s assigned partner", async (_label, override) => {
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: { ...alphaDog, ...override }, error: null },
    );

    await expect(
      resolveConnectedBusinessPartner("business-1"),
    ).resolves.toBeNull();
  });

  it.each([
    ["missing domain", { custom_domain: null }],
    ["empty name", { name: " " }],
    ["noncanonical domain", { custom_domain: "APP.ALPHADOGAGENCY.AI" }],
    ["invalid status", { status: "enabled" }],
  ])("fails closed for an active connected partner with %s", async (_label, override) => {
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: { ...alphaDog, ...override }, error: null },
    );

    await expect(
      resolveConnectedBusinessPartner("business-1"),
    ).rejects.toBeInstanceOf(BusinessPartnerResolutionError);
  });

  it.each([undefined, "not-a-uuid", 42])(
    "fails closed for a malformed non-null assignment %s",
    async (partnerId) => {
      queueDatabaseResults({ data: { partner_id: partnerId }, error: null });

      await expect(
        resolveConnectedBusinessPartner("business-1"),
      ).rejects.toBeInstanceOf(BusinessPartnerResolutionError);
    },
  );

  it("does not retain another business's partner across sequential calls", async () => {
    const secondPartner = {
      ...alphaDog,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Beta Partner",
      custom_domain: "app.betapartner.example",
    };
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: alphaDog, error: null },
      { data: { partner_id: secondPartner.id }, error: null },
      { data: secondPartner, error: null },
    );

    const first = await resolveConnectedBusinessPartner("business-1");
    const second = await resolveConnectedBusinessPartner("business-2");

    expect(first?.name).toBe("Alpha Dog Agency");
    expect(second?.name).toBe("Beta Partner");
    expect(second?.publicOrigin).toBe("https://app.betapartner.example");
  });
});

describe("resolveWidgetAttribution", () => {
  it("uses the assigned partner regardless of the request Host", async () => {
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: alphaDog, error: null },
    );

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "other-connected-partner.example",
      }),
    ).resolves.toEqual({
      poweredByName: "Alpha Dog Agency",
      poweredByUrl: "https://app.alphadogagency.ai",
    });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("uses the canonical origin for an unassigned business on the canonical Host", async () => {
    queueDatabaseResults({ data: { partner_id: null }, error: null });

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "SIMPLASSIST.COM:443",
      }),
    ).resolves.toEqual({
      poweredByName: "SimplAssist",
      poweredByUrl: "https://simplassist.com",
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("allows an exact active connected request Host but keeps default attribution", async () => {
    queueDatabaseResults(
      { data: { partner_id: null }, error: null },
      { data: alphaDog, error: null },
    );

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "app.alphadogagency.ai",
      }),
    ).resolves.toEqual({
      poweredByName: "SimplAssist",
      poweredByUrl: "https://app.alphadogagency.ai",
    });
    const hostLookup = mocks.from.mock.results[1]?.value as {
      eq: ReturnType<typeof vi.fn>;
    };
    expect(hostLookup.eq).toHaveBeenCalledWith(
      "custom_domain",
      "app.alphadogagency.ai",
    );
    expect(hostLookup.eq).toHaveBeenCalledWith("status", "active");
    expect(hostLookup.eq).toHaveBeenCalledWith("domain_status", "connected");
  });

  it.each([
    "unknown.example",
    "app.alphadogagency.ai.evil.example",
    "app.alphadogagency.ai,evil.example",
    null,
  ])("falls back to canonical for a non-allow-listed Host %s", async (hostHeader) => {
    queueDatabaseResults(
      { data: { partner_id: null }, error: null },
      { data: null, error: null },
    );

    await expect(
      resolveWidgetAttribution({ businessId: "business-1", hostHeader }),
    ).resolves.toEqual({
      poweredByName: "SimplAssist",
      poweredByUrl: "https://simplassist.com",
    });
  });

  it("falls back to canonical when the assigned partner is pending", async () => {
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: { ...alphaDog, domain_status: "pending" }, error: null },
    );

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "simplassist.com",
      }),
    ).resolves.toEqual({
      poweredByName: "SimplAssist",
      poweredByUrl: "https://simplassist.com",
    });
  });

  it("fails closed when an allow-listed Host query returns a malformed active connected row", async () => {
    queueDatabaseResults(
      { data: { partner_id: null }, error: null },
      { data: { ...alphaDog, custom_domain: null }, error: null },
    );

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "app.alphadogagency.ai",
      }),
    ).rejects.toBeInstanceOf(BusinessPartnerResolutionError);
  });

  it.each([
    ["business assignment", [{ data: null, error: { message: "down" } }]],
    [
      "assigned partner",
      [
        { data: { partner_id: alphaDog.id }, error: null },
        { data: null, error: { message: "down" } },
      ],
    ],
    [
      "request Host allow-list",
      [
        { data: { partner_id: null }, error: null },
        { data: null, error: { message: "down" } },
      ],
    ],
  ])("fails closed when the %s lookup errors", async (_label, results) => {
    queueDatabaseResults(...results);

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "partner.example",
      }),
    ).rejects.toBeInstanceOf(BusinessPartnerResolutionError);
  });

  it.each([
    ["business assignment", [{ reject: new Error("network down") }]],
    [
      "assigned partner",
      [
        { data: { partner_id: alphaDog.id }, error: null },
        { reject: new Error("network down") },
      ],
    ],
    [
      "request Host allow-list",
      [
        { data: { partner_id: null }, error: null },
        { reject: new Error("network down") },
      ],
    ],
  ])("translates a rejected %s query into a typed failure", async (_label, results) => {
    queueDatabaseResults(...results);

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "partner.example",
      }),
    ).rejects.toBeInstanceOf(BusinessPartnerResolutionError);
  });

  it("fails closed when a non-null assignment has no partner row", async () => {
    queueDatabaseResults(
      { data: { partner_id: alphaDog.id }, error: null },
      { data: null, error: null },
    );

    await expect(
      resolveWidgetAttribution({
        businessId: "business-1",
        hostHeader: "simplassist.com",
      }),
    ).rejects.toBeInstanceOf(BusinessPartnerResolutionError);
  });
});
