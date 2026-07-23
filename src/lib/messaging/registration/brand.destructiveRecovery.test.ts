import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  deleteBrand: vi.fn(),
  archiveCampaign: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    messaging10dlc: {
      brand: {
        create: vi.fn(),
        delete: mocks.deleteBrand,
      },
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
vi.mock("./audit", () => ({
  appendRegistrationEvent: vi.fn(),
  serializeError: vi.fn(),
}));
vi.mock("./campaign", () => ({
  archiveAndClearRejectedCampaign: mocks.archiveCampaign,
}));

import { archiveAndClearRejectedBrand } from "./brand";
import { TelnyxRemoteMutationAuthorizationError } from "../telnyxDestructive";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const BRAND_ID = "4b20019d-e93e-4000-8000-000000000001";
const AUTHORIZATION = {
  authorized: true,
  business_id: BUSINESS_ID,
  context: "rejection_recovery",
  operation: "delete_brand",
  action_id: null,
  provider_id: BRAND_ID,
  canonical_e164: null,
  public_tcr_id: "BRANDTCR",
  config_updated_at: "2026-07-22T05:00:00.000Z",
};

let businessUpdates: Array<Record<string, unknown>>;
let historyUpdates: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELNYX_REMOTE_RELEASE_ENABLED", "1");
  vi.stubEnv(
    "TELNYX_PROTECTED_MESSAGING_PROFILE_ID",
    "00000000-0000-4000-8000-000000000004"
  );
  vi.stubEnv("TELNYX_PROTECTED_VOICE_APPLICATION_ID", "123456789");
  businessUpdates = [];
  historyUpdates = [];

  mocks.from.mockImplementation((table: string) => {
    if (table === "businesses") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: BUSINESS_ID,
                telnyx_brand_id: BRAND_ID,
                telnyx_brand_source: "created_by_simplassist",
                brand_status: "rejected",
                brand_rejection_reason: "Carrier rejection",
              },
              error: null,
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          businessUpdates.push(payload);
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      };
    }
    if (table === "rejected_brands") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { id: "history-id", telnyx_deleted: false },
                error: null,
              })),
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          historyUpdates.push(payload);
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rejected-brand destructive authorization", () => {
  it("preauthorizes the brand before the child campaign and reauthorizes at deletion", async () => {
    const order: string[] = [];
    mocks.rpc.mockImplementation(async () => {
      order.push("authorize-brand");
      return { data: AUTHORIZATION, error: null };
    });
    mocks.archiveCampaign.mockImplementation(async () => {
      order.push("archive-campaign");
    });
    mocks.deleteBrand.mockImplementation(async () => {
      order.push("delete-brand");
    });

    await archiveAndClearRejectedBrand(BUSINESS_ID);

    expect(order).toEqual([
      "authorize-brand",
      "archive-campaign",
      "authorize-brand",
      "authorize-brand",
      "delete-brand",
    ]);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.archiveCampaign).toHaveBeenCalledWith(BUSINESS_ID, {
      cause: "brand_refile",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "authorize_telnyx_remote_mutation",
      expect.objectContaining({
        p_context: "rejection_recovery",
        p_operation: "delete_brand",
        p_provider_id: BRAND_ID,
      })
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "authorize_telnyx_remote_mutation",
      expect.objectContaining({
        p_context: "rejection_recovery",
        p_operation: "delete_brand",
        p_provider_id: BRAND_ID,
      })
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      3,
      "authorize_telnyx_remote_mutation",
      expect.objectContaining({
        p_context: "rejection_recovery",
        p_operation: "delete_brand",
        p_provider_id: BRAND_ID,
      })
    );
    expect(mocks.deleteBrand).toHaveBeenCalledWith(BRAND_ID);
    expect(historyUpdates).toContainEqual({
      telnyx_deleted: true,
      deletion_error: null,
    });
    expect(businessUpdates).toContainEqual(
      expect.objectContaining({ telnyx_brand_id: null })
    );
  });

  it("stops before the child campaign when brand preauthorization is denied", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "telnyx_remote_mutation_protected" },
    });

    await expect(
      archiveAndClearRejectedBrand(BUSINESS_ID)
    ).rejects.toBeInstanceOf(TelnyxRemoteMutationAuthorizationError);

    expect(mocks.archiveCampaign).not.toHaveBeenCalled();
    expect(mocks.deleteBrand).not.toHaveBeenCalled();
    expect(historyUpdates).toEqual([]);
    expect(businessUpdates).toEqual([]);
  });

  it("does not clear the brand pointer when the second authorization is denied", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: AUTHORIZATION, error: null })
      .mockResolvedValueOnce({ data: AUTHORIZATION, error: null })
      .mockRejectedValueOnce(new Error("authorization transport failed"));

    await expect(
      archiveAndClearRejectedBrand(BUSINESS_ID)
    ).rejects.toBeInstanceOf(TelnyxRemoteMutationAuthorizationError);

    expect(mocks.archiveCampaign).toHaveBeenCalledOnce();
    expect(mocks.deleteBrand).not.toHaveBeenCalled();
    expect(historyUpdates).toEqual([]);
    expect(businessUpdates).toEqual([]);
  });
});
