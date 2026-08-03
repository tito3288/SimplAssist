import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  result: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  EXTERNAL_BILLING_MESSAGE,
  partnerManagedBillingMessage,
  resolveAssignedPartnerName,
} from "./partnerManagedBilling.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.result = { data: null, error: null };
  mocks.from.mockImplementation(() => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockImplementation(async () => mocks.result);
    return chain;
  });
});

describe("resolveAssignedPartnerName", () => {
  it("uses the service-role partners lookup and returns the stored name", async () => {
    mocks.result = {
      data: { name: "  Alpha Dog Agency  " },
      error: null,
    };

    await expect(
      resolveAssignedPartnerName("10000000-0000-4000-a000-000000000043"),
    ).resolves.toBe("Alpha Dog Agency");

    expect(mocks.from).toHaveBeenCalledWith("partners");
    const chain = mocks.from.mock.results[0]?.value;
    expect(chain.select).toHaveBeenCalledWith("name");
    expect(chain.eq).toHaveBeenCalledWith(
      "id",
      "10000000-0000-4000-a000-000000000043",
    );
    expect(chain.eq).toHaveBeenCalledTimes(1);
  });

  it("does not query for an orphaned assignment", async () => {
    await expect(resolveAssignedPartnerName(null)).resolves.toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([null, { name: "" }, { name: "   " }, { name: null }])(
    "returns null for a missing or unusable partner row %#",
    async (data) => {
      mocks.result = { data, error: null };
      await expect(
        resolveAssignedPartnerName("10000000-0000-4000-a000-000000000043"),
      ).resolves.toBeNull();
    },
  );

  it("fails closed on a partner lookup error", async () => {
    mocks.result = { data: null, error: { message: "database unavailable" } };

    await expect(
      resolveAssignedPartnerName("10000000-0000-4000-a000-000000000043"),
    ).rejects.toThrow("Failed to resolve assigned billing partner");
  });
});

describe("partnerManagedBillingMessage", () => {
  it("interpolates each assigned partner name", () => {
    expect(partnerManagedBillingMessage("Alpha Dog Agency")).toBe(
      "Billing is handled by Alpha Dog Agency.",
    );
    expect(partnerManagedBillingMessage("Second Partner")).toBe(
      "Billing is handled by Second Partner.",
    );
  });

  it("uses the exact orphan fallback", () => {
    expect(partnerManagedBillingMessage(null)).toBe(
      "Billing is managed externally.",
    );
    expect(EXTERNAL_BILLING_MESSAGE).toBe("Billing is managed externally.");
  });
});
