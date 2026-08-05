import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendRegistrationEvent: vi.fn(),
  createBrand: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    messaging10dlc: {
      brand: {
        create: mocks.createBrand,
      },
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}));
vi.mock("./audit", () => ({
  appendRegistrationEvent: mocks.appendRegistrationEvent,
  serializeError: vi.fn(),
}));
vi.mock("./campaign", () => ({
  archiveAndClearRejectedCampaign: vi.fn(),
}));

import { registerBrand } from "./brand";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const BRAND_ID = "4b20019d-e93e-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

  mocks.from.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: {
            id: BUSINESS_ID,
            name: "Example Dental",
            slug: "example-dental",
            legal_business_name: "Example Dental LLC",
            business_entity_type: "llc",
            business_type: "dentist",
            has_ein: true,
            ein: "12-3456789",
            compliance_info_completed_at: "2026-08-05T12:00:00.000Z",
            telnyx_brand_id: null,
            authorized_rep_name: "Avery Dentist",
            authorized_rep_email: "avery@example.com",
            authorized_rep_phone: "317-555-0100",
            address: "100 Main Street",
            city: "Indianapolis",
            state: "IN",
            zip: "46204",
            website_url: "https://example.com",
          },
          error: null,
        })),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  });
  mocks.createBrand.mockResolvedValue({ brandId: BRAND_ID });
  mocks.appendRegistrationEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registerBrand charged provider submission", () => {
  it("disables SDK retries and invokes brand creation exactly once", async () => {
    await registerBrand(BUSINESS_ID);

    expect(mocks.createBrand).toHaveBeenCalledOnce();
    expect(mocks.createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Example Dental",
        ein: "123456789",
        website: "https://example.com",
      }),
      { maxRetries: 0 },
    );
  });

  it("does not replay a rejected create from the catch path", async () => {
    const providerError = new Error("provider timeout");
    mocks.createBrand.mockRejectedValue(providerError);

    await expect(registerBrand(BUSINESS_ID)).rejects.toBe(providerError);

    expect(mocks.createBrand).toHaveBeenCalledOnce();
    expect(mocks.createBrand).toHaveBeenCalledWith(
      expect.any(Object),
      { maxRetries: 0 },
    );
  });
});
