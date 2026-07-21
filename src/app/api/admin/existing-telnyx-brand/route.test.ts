import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  inspect: vi.fn(),
  stage: vi.fn(),
  approve: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));

vi.mock("@/lib/messaging/registration/existingBrand", () => {
  class ExistingBrandLinkError extends Error {
    code: string;
    httpStatus: number;
    kind: "transient" | "permanent";

    constructor(args: {
      code: string;
      httpStatus: number;
      kind: "transient" | "permanent";
    }) {
      super(args.code);
      this.code = args.code;
      this.httpStatus = args.httpStatus;
      this.kind = args.kind;
    }
  }

  return {
    ExistingBrandLinkError,
    inspectExistingTelnyxBrand: mocks.inspect,
    stageExistingTelnyxBrandLink: mocks.stage,
    approveExistingTelnyxBrandLink: mocks.approve,
    resetExistingTelnyxBrandLink: mocks.reset,
  };
});

import { ExistingBrandLinkError } from "@/lib/messaging/registration/existingBrand";
import { POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";
const ADMIN_ID = "00000000-0000-4000-8000-000000000999";
const INTERNAL_ID = "4b20019d-e93e-4000-8000-000000000001";
const FINGERPRINT = "f".repeat(64);

const preview = {
  tcrBrandId: "BL69PDP",
  legalName: "SIMPLASSIST LLC",
  entityTypeCategory: "PRIVATE_PROFIT",
  state: "IN",
  zip: "46201",
  registrationStatus: "VERIFIED",
  identityStatus: "VERIFIED",
  campaignCount: 1,
  canStage: true,
  blockingCode: null,
  blockingMessage: null,
  // These can exist on an accidentally widened library object. The route
  // still must never serialize them into a browser response.
  ein: "12-3456789",
  telnyxBrandId: INTERNAL_ID,
  identityFingerprint: FINGERPRINT,
  contacts: [{ email: "private@example.test" }],
  rawProviderResponse: { secret: "provider-data" },
};

const linkState = {
  status: "pending_admin" as const,
  tcrBrandId: "BL69PDP",
  inspectedAt: "2026-07-21T10:00:00.000Z",
  approvedAt: null,
  consumedAt: null,
  lastErrorCode: null,
  telnyxBrandId: INTERNAL_ID,
  identityFingerprint: FINGERPRINT,
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/admin/existing-telnyx-brand",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: "admin@test.dev" });
  mocks.inspect.mockResolvedValue(preview);
  mocks.stage.mockResolvedValue({ preview, linkState });
  mocks.approve.mockResolvedValue({
    preview,
    linkState: { ...linkState, status: "approved" },
  });
  mocks.reset.mockResolvedValue(linkState);
});

describe("POST /api/admin/existing-telnyx-brand", () => {
  it("returns 404 before parsing or calling the provider for a non-admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/existing-telnyx-brand", {
        method: "POST",
        body: "not-json",
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON without calling a brand action", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/existing-telnyx-brand", {
        method: "POST",
        body: "not-json",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown action without calling a brand action", async () => {
    const response = await POST(
      request({ action: "consume", businessId: BUSINESS_ID })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid brand-link request",
    });
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("inspects by TCR ID and returns only the redacted preview allowlist", async () => {
    const response = await POST(
      request({
        action: "inspect",
        businessId: BUSINESS_ID,
        tcrBrandId: " bl69pdp ",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.inspect).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      tcrBrandId: "BL69PDP",
      actorUserId: ADMIN_ID,
    });
    const json = await response.json();
    expect(json.preview).toEqual({
      tcrBrandId: "BL69PDP",
      legalName: "SIMPLASSIST LLC",
      entityTypeCategory: "PRIVATE_PROFIT",
      state: "IN",
      zip: "46201",
      registrationStatus: "VERIFIED",
      identityStatus: "VERIFIED",
      campaignCount: 1,
      canStage: true,
      blockingCode: null,
      blockingMessage: null,
    });
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("12-3456789");
    expect(serialized).not.toContain(INTERNAL_ID);
    expect(serialized).not.toContain(FINGERPRINT);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("provider-data");
  });

  it("stages without accepting an internal ID or fingerprint from the browser", async () => {
    const response = await POST(
      request({
        action: "stage",
        businessId: BUSINESS_ID,
        tcrBrandId: "BL69PDP",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.stage).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      tcrBrandId: "BL69PDP",
      actorUserId: ADMIN_ID,
    });
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(INTERNAL_ID);
    expect(serialized).not.toContain(FINGERPRINT);
  });

  it.each(["approve", "reset"] as const)(
    "%s sends only the business and authenticated admin identity",
    async (action) => {
      const response = await POST(request({ action, businessId: BUSINESS_ID }));

      expect(response.status).toBe(200);
      const expected = { businessId: BUSINESS_ID, actorUserId: ADMIN_ID };
      if (action === "approve") {
        expect(mocks.approve).toHaveBeenCalledWith(expected);
      } else {
        expect(mocks.reset).toHaveBeenCalledWith(expected);
      }
    }
  );

  it("rejects browser-supplied internal authorization fields", async () => {
    const response = await POST(
      request({
        action: "approve",
        businessId: BUSINESS_ID,
        telnyxBrandId: INTERNAL_ID,
        identityFingerprint: FINGERPRINT,
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("uses the exact safe campaign-cap explanation", async () => {
    mocks.inspect.mockRejectedValue(
      new ExistingBrandLinkError({
        code: "telnyx_brand_campaign_cap_reached",
        httpStatus: 422,
        kind: "permanent",
      })
    );

    const response = await POST(
      request({
        action: "inspect",
        businessId: BUSINESS_ID,
        tcrBrandId: "BL69PDP",
      })
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "telnyx_brand_campaign_cap_reached",
      error:
        "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link.",
    });
  });

  it("replaces a preview's blocking message with the fixed safe cap message", async () => {
    mocks.inspect.mockResolvedValue({
      ...preview,
      campaignCount: 5,
      canStage: false,
      blockingCode: "telnyx_brand_campaign_cap_reached",
      blockingMessage: `unsafe ${INTERNAL_ID} private@example.test`,
    });

    const response = await POST(
      request({
        action: "inspect",
        businessId: BUSINESS_ID,
        tcrBrandId: "BL69PDP",
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.preview.blockingMessage).toBe(
      "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link."
    );
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(INTERNAL_ID);
    expect(serialized).not.toContain("private@example.test");
  });

  it("never exposes an unknown provider error or its message", async () => {
    mocks.inspect.mockRejectedValue(
      new Error(`Provider included ${INTERNAL_ID} and private@example.test`)
    );

    const response = await POST(
      request({
        action: "inspect",
        businessId: BUSINESS_ID,
        tcrBrandId: "BL69PDP",
      })
    );

    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(INTERNAL_ID);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).toContain("could not be completed safely");
  });
});
