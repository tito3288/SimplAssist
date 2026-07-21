import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  retrieve: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    messaging10dlc: {
      brand: {
        list: mocks.list,
        retrieve: mocks.retrieve,
      },
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

import {
  approveExistingTelnyxBrandLink,
  ExistingBrandLinkError,
  getExistingTelnyxBrandLinkState,
  inspectExistingTelnyxBrand,
  prepareExistingTelnyxBrandLinkForLaunch,
  resetExistingTelnyxBrandLink,
  revalidateApprovedExistingTelnyxBrandLink,
  stageExistingTelnyxBrandLink,
  TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE,
} from "./existingBrand";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000099";
const INTERNAL_ID = "4b20019d-e93e-4000-8000-000000000001";
const OTHER_INTERNAL_ID = "4b20019d-e93e-4000-8000-000000000002";
const TCR_ID = "BL69PDP";
const FINGERPRINT = "a".repeat(64);

const defaultProviderBrand = {
  brandId: INTERNAL_ID,
  tcrBrandId: TCR_ID,
  companyName: "SimplAssist LLC",
  entityType: "PRIVATE_PROFIT",
  country: "US",
  state: "IN",
  postalCode: "46204",
  ein: "123456789",
  universalEin: "12-3456789",
  status: "OK",
  identityStatus: "VERIFIED",
  mock: false,
  assignedCampaignsCount: 1,
};

const defaultLocalIdentity = {
  id: BUSINESS_ID,
  has_ein: true,
  ein: "12-3456789",
  legal_business_name: " simplassist   llc ",
  business_entity_type: "llc",
  business_registration_state: "IN",
  state: "Indiana",
  zip: "46204-1234",
};

const defaultRequest = {
  id: "00000000-0000-4000-8000-000000000010",
  business_id: BUSINESS_ID,
  tcr_brand_id: TCR_ID,
  telnyx_brand_id: INTERNAL_ID,
  status: "pending_admin",
  identity_fingerprint: FINGERPRINT,
  inspected_at: "2026-07-21T12:00:00.000Z",
  approved_at: null,
  consumed_at: null,
  last_error_code: null,
};

let businessRead: { data: unknown; error: unknown } = {
  data: defaultLocalIdentity,
  error: null,
};
let requestRead: { data: unknown; error: unknown } = {
  data: defaultRequest,
  error: null,
};

function asyncItems(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  const retrieved = { ...defaultProviderBrand, ...overrides };
  mocks.retrieve.mockResolvedValue(retrieved);
  mocks.list.mockImplementation(() =>
    asyncItems([
      {
        brandId: retrieved.brandId,
        tcrBrandId: retrieved.tcrBrandId,
      },
    ])
  );
  return retrieved;
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return { ...defaultRequest, ...overrides };
}

function queryResult(result: () => unknown) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => result()),
      })),
    })),
  };
}

function expectedPreview(overrides: Record<string, unknown> = {}) {
  return {
    tcrBrandId: TCR_ID,
    legalName: "SIMPLASSIST LLC",
    entityTypeCategory: "PRIVATE_PROFIT",
    state: "IN",
    zip: "46204",
    registrationStatus: "OK",
    identityStatus: "VERIFIED",
    campaignCount: 1,
    canStage: true,
    blockingCode: null,
    blockingMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  provider();
  businessRead = { data: { ...defaultLocalIdentity }, error: null };
  requestRead = { data: { ...defaultRequest }, error: null };

  mocks.from.mockImplementation((table: string) => {
    if (table === "businesses") return queryResult(() => businessRead);
    if (table === "telnyx_brand_link_requests") {
      return queryResult(() => requestRead);
    }
    throw new Error(`Unexpected table ${table}`);
  });

  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "record_existing_telnyx_brand_inspection") {
      return { data: "00000000-0000-4000-8000-000000000020", error: null };
    }
    if (name === "stage_existing_telnyx_brand_link") {
      return { data: linkRow(), error: null };
    }
    if (name === "approve_existing_telnyx_brand_link") {
      return {
        data: linkRow({
          status: "approved",
          approved_at: "2026-07-21T12:30:00.000Z",
        }),
        error: null,
      };
    }
    if (name === "reset_existing_telnyx_brand_link") {
      return { data: linkRow(), error: null };
    }
    if (name === "block_existing_telnyx_brand_link") {
      return {
        data: linkRow({
          status: "blocked",
          identity_fingerprint: null,
          last_error_code: "existing_brand_identity_mismatch",
        }),
        error: null,
      };
    }
    if (name === "consume_existing_telnyx_brand_link") {
      return {
        data: linkRow({
          status: "consumed",
          approved_at: "2026-07-21T12:30:00.000Z",
          consumed_at: "2026-07-21T12:45:00.000Z",
        }),
        error: null,
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe("inspectExistingTelnyxBrand", () => {
  it("normalizes the TCR ID, resolves it exactly, and returns only the safe preview", async () => {
    const preview = await inspectExistingTelnyxBrand({
      businessId: BUSINESS_ID,
      tcrBrandId: " bl69pdp ",
      actorUserId: ACTOR_ID,
    });

    expect(mocks.list).toHaveBeenCalledWith({
      tcrBrandId: TCR_ID,
      recordsPerPage: 2,
    });
    expect(mocks.retrieve).toHaveBeenCalledWith(INTERNAL_ID);
    expect(preview).toEqual(expectedPreview());

    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(INTERNAL_ID);
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("universalEin");
    expect(serialized).not.toContain("fingerprint");
  });

  it("works before local legal fields exist and never stages a link request", async () => {
    businessRead = { data: null as never, error: null };

    await expect(
      inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).resolves.toEqual(expectedPreview());

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_existing_telnyx_brand_inspection",
      expect.objectContaining({ p_outcome_code: "eligible" })
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "stage_existing_telnyx_brand_link",
      expect.anything()
    );
  });

  it("records private provider IDs only in the server-side audit RPC", async () => {
    await inspectExistingTelnyxBrand({
      businessId: BUSINESS_ID,
      tcrBrandId: TCR_ID,
      actorUserId: ACTOR_ID,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_existing_telnyx_brand_inspection",
      {
        p_business_id: BUSINESS_ID,
        p_tcr_brand_id: TCR_ID,
        p_telnyx_brand_id: INTERNAL_ID,
        p_outcome_code: "eligible",
        p_actor_user_id: ACTOR_ID,
      }
    );
  });

  it("requires an exact normalized list match", async () => {
    mocks.list.mockImplementation(() =>
      asyncItems([{ brandId: INTERNAL_ID, tcrBrandId: `${TCR_ID}X` }])
    );

    await expect(
      inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "existing_brand_not_found",
      httpStatus: 404,
      kind: "permanent",
    });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("fails closed on duplicate exact list matches", async () => {
    mocks.list.mockImplementation(() =>
      asyncItems([
        { brandId: INTERNAL_ID, tcrBrandId: TCR_ID },
        { brandId: OTHER_INTERNAL_ID, tcrBrandId: TCR_ID },
      ])
    );

    await expect(
      inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({ code: "existing_brand_duplicate_match" });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it.each([undefined, "not-a-uuid", OTHER_INTERNAL_ID])(
    "rejects missing, malformed, or changed retrieve brandId %#",
    async (brandId) => {
      mocks.retrieve.mockResolvedValue({ ...defaultProviderBrand, brandId });
      mocks.list.mockImplementation(() =>
        asyncItems([{ brandId: INTERNAL_ID, tcrBrandId: TCR_ID }])
      );

      await expect(
        inspectExistingTelnyxBrand({
          businessId: BUSINESS_ID,
          tcrBrandId: TCR_ID,
          actorUserId: ACTOR_ID,
        })
      ).rejects.toBeInstanceOf(ExistingBrandLinkError);
      expect(mocks.retrieve).toHaveBeenCalledWith(INTERNAL_ID);
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it("classifies a provider outage as transient without leaking its message", async () => {
    mocks.list.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw { status: 503, message: "provider payload with tax data" };
      },
    }));

    let caught: unknown;
    try {
      await inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "existing_brand_provider_unavailable",
      httpStatus: 503,
      kind: "transient",
    });
    expect((caught as Error).message).not.toContain("tax data");
  });

  it("leaves approval retryable for a non-404 provider request rejection", async () => {
    mocks.retrieve.mockRejectedValue({ status: 403, message: "secret" });

    await expect(
      inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "existing_brand_provider_request_rejected",
      kind: "transient",
      httpStatus: 503,
    });
  });

  it("fails closed on an incomplete retrieve response", async () => {
    provider({ assignedCampaignsCount: undefined });

    await expect(
      inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "existing_brand_provider_response_invalid",
      kind: "transient",
    });
  });

  it.each([
    [
      { status: "REGISTRATION_PENDING" },
      "telnyx_brand_status_not_ok",
    ],
    [
      { identityStatus: "UNVERIFIED" },
      "telnyx_brand_identity_not_verified",
    ],
    [{ country: "CA" }, "telnyx_brand_country_not_us"],
    [{ mock: true }, "telnyx_brand_mock_not_allowed"],
  ] as const)("returns a safe blocked preview for %j", async (patch, code) => {
    provider(patch);

    const preview = await inspectExistingTelnyxBrand({
      businessId: BUSINESS_ID,
      tcrBrandId: TCR_ID,
      actorUserId: ACTOR_ID,
    });

    expect(preview).toMatchObject({ canStage: false, blockingCode: code });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_existing_telnyx_brand_inspection",
      expect.objectContaining({ p_outcome_code: code })
    );
  });

  it("uses the exact approved message at five campaigns", async () => {
    provider({ assignedCampaignsCount: 5 });

    const preview = await inspectExistingTelnyxBrand({
      businessId: BUSINESS_ID,
      tcrBrandId: TCR_ID,
      actorUserId: ACTOR_ID,
    });

    expect(preview).toMatchObject({
      canStage: false,
      blockingCode: "telnyx_brand_campaign_cap_reached",
      blockingMessage: TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE,
    });
  });

  it("accepts a real provider response when the optional mock field is omitted", async () => {
    provider({ mock: undefined });

    await expect(
      inspectExistingTelnyxBrand({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).resolves.toMatchObject({ canStage: true, blockingCode: null });
  });
});

describe("stageExistingTelnyxBrandLink", () => {
  it("compares local identity then stages through the guarded RPC", async () => {
    const result = await stageExistingTelnyxBrandLink({
      businessId: BUSINESS_ID,
      tcrBrandId: TCR_ID,
      actorUserId: ACTOR_ID,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("stage_existing_telnyx_brand_link", {
      p_business_id: BUSINESS_ID,
      p_tcr_brand_id: TCR_ID,
      p_telnyx_brand_id: INTERNAL_ID,
      p_actor_user_id: ACTOR_ID,
    });
    expect(result).toEqual({
      preview: expectedPreview(),
      linkState: {
        status: "pending_admin",
        tcrBrandId: TCR_ID,
        inspectedAt: "2026-07-21T12:00:00.000Z",
        approvedAt: null,
        consumedAt: null,
        lastErrorCode: null,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(INTERNAL_ID);
    expect(serialized).not.toContain(FINGERPRINT);
  });

  it("does not read local identity or stage an ineligible brand", async () => {
    provider({ assignedCampaignsCount: 5 });

    await expect(
      stageExistingTelnyxBrandLink({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "telnyx_brand_campaign_cap_reached",
      message: TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE,
      kind: "permanent",
    });

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the complete local identity including formation and address states", async () => {
    businessRead = {
      data: { ...defaultLocalIdentity, business_registration_state: null },
      error: null,
    };

    await expect(
      stageExistingTelnyxBrandLink({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({ code: "existing_brand_local_identity_incomplete" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["ein", { ein: "98-7654321" }],
    ["legal_name", { legal_business_name: "Another LLC" }],
    ["entity_type", { business_entity_type: "nonprofit" }],
    ["state", { state: "OH" }],
    ["zip", { zip: "44114" }],
  ] as const)("rejects a %s mismatch without staging", async (field, patch) => {
    businessRead = {
      data: { ...defaultLocalIdentity, ...patch },
      error: null,
    };

    await expect(
      stageExistingTelnyxBrandLink({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "existing_brand_identity_mismatch",
      mismatchedFields: [field],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a stable guarded-RPC conflict without returning database details", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "record_existing_telnyx_brand_inspection") {
        return { data: "event", error: null };
      }
      return {
        data: null,
        error: {
          message:
            "existing_brand_link_brand_already_reserved Detail: contains provider fields",
        },
      };
    });

    let caught: unknown;
    try {
      await stageExistingTelnyxBrandLink({
        businessId: BUSINESS_ID,
        tcrBrandId: TCR_ID,
        actorUserId: ACTOR_ID,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "existing_brand_link_brand_already_reserved",
      httpStatus: 409,
      kind: "permanent",
    });
    expect((caught as Error).message).not.toContain("provider fields");
  });
});

describe("approval, reset, state, and launch revalidation", () => {
  it("approves using only private request IDs and fingerprint read server-side", async () => {
    const result = await approveExistingTelnyxBrandLink({
      businessId: BUSINESS_ID,
      actorUserId: ACTOR_ID,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "approve_existing_telnyx_brand_link",
      {
        p_business_id: BUSINESS_ID,
        p_expected_tcr_brand_id: TCR_ID,
        p_expected_telnyx_brand_id: INTERNAL_ID,
        p_expected_identity_fingerprint: FINGERPRINT,
        p_actor_user_id: ACTOR_ID,
      }
    );
    expect(result.linkState).toMatchObject({
      status: "approved",
      tcrBrandId: TCR_ID,
    });
    expect(JSON.stringify(result)).not.toContain(INTERNAL_ID);
    expect(JSON.stringify(result)).not.toContain(FINGERPRINT);
  });

  it("rejects when list resolution no longer matches the staged internal ID", async () => {
    requestRead = {
      data: { ...defaultRequest, telnyx_brand_id: OTHER_INTERNAL_ID },
      error: null,
    };

    await expect(
      approveExistingTelnyxBrandLink({
        businessId: BUSINESS_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "existing_brand_provider_identity_changed",
      kind: "permanent",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "approve_existing_telnyx_brand_link",
      expect.anything()
    );
  });

  it("requires a staged request before approval", async () => {
    requestRead = { data: null as never, error: null };

    await expect(
      approveExistingTelnyxBrandLink({
        businessId: BUSINESS_ID,
        actorUserId: ACTOR_ID,
      })
    ).rejects.toMatchObject({
      code: "existing_brand_link_request_not_found",
      httpStatus: 404,
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("resets through the guarded RPC and returns a safe state", async () => {
    const state = await resetExistingTelnyxBrandLink({
      businessId: BUSINESS_ID,
      actorUserId: ACTOR_ID,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("reset_existing_telnyx_brand_link", {
      p_business_id: BUSINESS_ID,
      p_actor_user_id: ACTOR_ID,
    });
    expect(state).toEqual({
      status: "pending_admin",
      tcrBrandId: TCR_ID,
      inspectedAt: "2026-07-21T12:00:00.000Z",
      approvedAt: null,
      consumedAt: null,
      lastErrorCode: null,
    });
    expect(JSON.stringify(state)).not.toContain(INTERNAL_ID);
    expect(JSON.stringify(state)).not.toContain(FINGERPRINT);
  });

  it("reads only the safe projection of durable link state", async () => {
    const state = await getExistingTelnyxBrandLinkState(BUSINESS_ID);

    expect(state).toMatchObject({ status: "pending_admin", tcrBrandId: TCR_ID });
    expect(JSON.stringify(state)).not.toContain(INTERNAL_ID);
    expect(JSON.stringify(state)).not.toContain(FINGERPRINT);
  });

  it("returns null when no durable link state exists", async () => {
    requestRead = { data: null as never, error: null };
    await expect(getExistingTelnyxBrandLinkState(BUSINESS_ID)).resolves.toBeNull();
  });

  it("revalidates an approved request for launch without returning consume secrets", async () => {
    requestRead = {
      data: { ...defaultRequest, status: "approved" },
      error: null,
    };

    const preview = await revalidateApprovedExistingTelnyxBrandLink(BUSINESS_ID);

    expect(preview).toEqual(expectedPreview());
    expect(JSON.stringify(preview)).not.toContain(INTERNAL_ID);
    expect(JSON.stringify(preview)).not.toContain(FINGERPRINT);
  });

  it("refuses launch revalidation unless the durable request is approved", async () => {
    await expect(
      revalidateApprovedExistingTelnyxBrandLink(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "existing_brand_link_not_ready_for_approval",
      kind: "permanent",
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("maps database read failures to a transient safe error", async () => {
    requestRead = {
      data: null as never,
      error: { message: "row contains private provider identity" },
    };

    let caught: unknown;
    try {
      await getExistingTelnyxBrandLinkState(BUSINESS_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "existing_brand_database_unavailable",
      kind: "transient",
      httpStatus: 503,
    });
    expect((caught as Error).message).not.toContain("private provider identity");
  });
});

describe("prepareExistingTelnyxBrandLinkForLaunch", () => {
  it("leaves normal brand creation alone when no link request exists", async () => {
    requestRead = { data: null as never, error: null };

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).resolves.toEqual({ status: "not_requested" });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["pending_admin", "blocked"] as const)(
    "requires review for a %s request without touching Telnyx",
    async (status) => {
      requestRead = { data: linkRow({ status }), error: null };

      await expect(
        prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
      ).rejects.toMatchObject({
        kind: "permanent",
        launchDisposition: "review_required",
      });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.retrieve).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it("revalidates and consumes the exact captured approved tuple", async () => {
    requestRead = {
      data: linkRow({
        status: "approved",
        approved_at: "2026-07-21T12:30:00.000Z",
      }),
      error: null,
    };

    const result = await prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID);

    expect(mocks.rpc).toHaveBeenCalledWith(
      "consume_existing_telnyx_brand_link",
      {
        p_business_id: BUSINESS_ID,
        p_expected_tcr_brand_id: TCR_ID,
        p_expected_telnyx_brand_id: INTERNAL_ID,
        p_expected_identity_fingerprint: FINGERPRINT,
        p_actor_user_id: "system:paid_launch",
      }
    );
    expect(result).toMatchObject({
      status: "consumed",
      linkState: { status: "consumed", tcrBrandId: TCR_ID },
    });
    expect(JSON.stringify(result)).not.toContain(INTERNAL_ID);
    expect(JSON.stringify(result)).not.toContain(FINGERPRINT);
  });

  it("never consumes a replacement request that appears after revalidation", async () => {
    const captured = linkRow({
      status: "approved",
      approved_at: "2026-07-21T12:30:00.000Z",
    });
    requestRead = { data: captured, error: null };
    mocks.retrieve.mockImplementation(async () => {
      requestRead = {
        data: linkRow({
          tcr_brand_id: "REPLACEMENT",
          telnyx_brand_id: OTHER_INTERNAL_ID,
          identity_fingerprint: "b".repeat(64),
          status: "approved",
        }),
        error: null,
      };
      return defaultProviderBrand;
    });
    mocks.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === "consume_existing_telnyx_brand_link") {
        expect(args).toMatchObject({
          p_expected_tcr_brand_id: TCR_ID,
          p_expected_telnyx_brand_id: INTERNAL_ID,
          p_expected_identity_fingerprint: FINGERPRINT,
        });
        return {
          data: null,
          error: { message: "existing_brand_link_provider_identity_changed" },
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "existing_brand_link_provider_identity_changed",
      launchDisposition: "review_required",
    });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("blocks the exact approved tuple on a deterministic provider failure", async () => {
    requestRead = {
      data: linkRow({
        status: "approved",
        approved_at: "2026-07-21T12:30:00.000Z",
      }),
      error: null,
    };
    provider({ assignedCampaignsCount: 5 });

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "telnyx_brand_campaign_cap_reached",
      launchDisposition: "review_required",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "block_existing_telnyx_brand_link",
      {
        p_business_id: BUSINESS_ID,
        p_expected_tcr_brand_id: TCR_ID,
        p_expected_telnyx_brand_id: INTERNAL_ID,
        p_expected_identity_fingerprint: FINGERPRINT,
        p_reason_code: "telnyx_brand_campaign_cap_reached",
        p_actor_user_id: "system:paid_launch",
      }
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "consume_existing_telnyx_brand_link",
      expect.anything()
    );
  });

  it("leaves approval intact on a transient provider failure", async () => {
    requestRead = {
      data: linkRow({ status: "approved" }),
      error: null,
    };
    mocks.list.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw { status: 503, message: "private provider payload" };
      },
    }));

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "existing_brand_provider_unavailable",
      kind: "transient",
      launchDisposition: undefined,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not block approval for a non-404 provider read rejection", async () => {
    requestRead = {
      data: linkRow({ status: "approved" }),
      error: null,
    };
    mocks.retrieve.mockRejectedValue({ status: 403, message: "private detail" });

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "existing_brand_provider_request_rejected",
      kind: "transient",
      launchDisposition: undefined,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows a consumed retry at the cap so campaign recovery can run", async () => {
    requestRead = {
      data: linkRow({
        status: "consumed",
        approved_at: "2026-07-21T12:30:00.000Z",
        consumed_at: "2026-07-21T12:45:00.000Z",
      }),
      error: null,
    };
    provider({ assignedCampaignsCount: 5 });

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).resolves.toMatchObject({ status: "consumed" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "consume_existing_telnyx_brand_link",
      expect.objectContaining({
        p_expected_telnyx_brand_id: INTERNAL_ID,
      })
    );
  });

  it("keeps consumed links immutable and routes deterministic drift to support", async () => {
    requestRead = {
      data: linkRow({ status: "consumed" }),
      error: null,
    };
    provider({ status: "REGISTRATION_FAILED" });

    await expect(
      prepareExistingTelnyxBrandLinkForLaunch(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "telnyx_brand_status_not_ok",
      launchDisposition: "support_required",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
