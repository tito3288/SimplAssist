import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  getAdminAccountDeletionPreview: vi.fn(),
  scheduleAdminAccountDeletion: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));
vi.mock("@/lib/account/deletion.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/account/deletion.server")>();
  return {
    ...actual,
    getAdminAccountDeletionPreview: mocks.getAdminAccountDeletionPreview,
    scheduleAdminAccountDeletion: mocks.scheduleAdminAccountDeletion,
  };
});

import {
  AccountDeletionServiceError,
  type AccountDeletionPreview,
  type AdminAccountDeletionRun,
} from "@/lib/account/deletion.server";
import { POST } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const PARTNER_ID = "20000000-0000-4000-a000-000000000001";
const ADMIN_ID = "50000000-0000-4000-a000-000000000001";
const DELETED_AT = "2026-08-04T12:00:00.000Z";
const DELETION_SCHEDULED_FOR = "2026-10-03T12:00:00.000Z";

const SUSPENDED_PREVIEW: AccountDeletionPreview = {
  businessId: BUSINESS_ID,
  businessName: "Alpha Dental",
  billingMode: "invoiced",
  partnerId: PARTNER_ID,
  partnerSlug: "alpha-dog",
  lifecycleStage: "suspended",
  deletionScheduledFor: DELETION_SCHEDULED_FOR,
  subscriptionStatus: null,
  campaignStatus: null,
  assignedPhoneCount: 0,
  hasPendingPhoneNumber: false,
  provisioningJobCount: 1,
  provisioningOperationState: "idle",
  requiresLiveAcknowledgement: false,
};

const SAFE_RESULT: AdminAccountDeletionRun = {
  scheduled: {
    businessId: BUSINESS_ID,
    deletedAt: DELETED_AT,
    deletionScheduledFor: DELETION_SCHEDULED_FOR,
    stripeAction: null,
  },
  preview: SUSPENDED_PREVIEW,
  adminEventCreated: true,
  previouslyScheduledByAdmin: false,
};

function makeRequest(
  body: unknown = {
    confirmationName: "Alpha Dental",
    acknowledgeLiveResources: false,
  },
  options: {
    host?: string | null;
    origin?: string | null;
    fetchSite?: string | null;
    contentType?: string | null;
    forwardedHost?: string | null;
    forwarded?: string | null;
    rawBody?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  if (options.host !== null) {
    headers.set("host", options.host ?? "simplassist.com");
  }
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://simplassist.com");
  }
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin");
  }
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.forwardedHost !== null) {
    headers.set(
      "x-forwarded-host",
      options.forwardedHost ?? "app.alphadogagency.ai",
    );
  }
  if (options.forwarded !== null) {
    headers.set("forwarded", options.forwarded ?? "host=app.alphadogagency.ai");
  }

  return new NextRequest(
    `https://simplassist.com/api/admin/businesses/${BUSINESS_ID}/schedule-deletion`,
    {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    },
  );
}

function makeInspectableRequest({
  headers = new Headers(),
  json = vi.fn(),
}: {
  headers?: Headers;
  json?: ReturnType<typeof vi.fn>;
} = {}) {
  return { headers, json } as unknown as NextRequest;
}

function routeParams(businessId = BUSINESS_ID) {
  return { params: { businessId } };
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("vary")).toBe("Cookie, Origin");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.scheduleAdminAccountDeletion.mockResolvedValue(SAFE_RESULT);
  mocks.getAdminAccountDeletionPreview.mockResolvedValue(SUSPENDED_PREVIEW);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/businesses/[businessId]/schedule-deletion", () => {
  it("authenticates before Host, Origin, content type, params, or body processing", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const json = vi.fn().mockRejectedValue(new Error("must not parse"));
    const request = makeInspectableRequest({
      headers: new Headers({
        host: "app.alphadogagency.ai",
        origin: "https://attacker.example",
        "content-type": "text/plain",
        "sec-fetch-site": "cross-site",
      }),
      json,
    });

    const response = await POST(request, routeParams("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
    expect(mocks.getAdminAccountDeletionPreview).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    ["partner Host", "app.alphadogagency.ai"],
    ["suffix lookalike", "simplassist.com.evil.example"],
    ["malformed Host", "https://simplassist.com/path"],
    ["missing Host", null],
  ])(
    "rejects a valid mocked admin on a noncanonical %s before body processing",
    async (_, host) => {
      const json = vi.fn().mockResolvedValue({
        confirmationName: "Alpha Dental",
        acknowledgeLiveResources: false,
      });
      const headers = new Headers({
        origin: "https://simplassist.com",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "simplassist.com",
        forwarded: "host=simplassist.com",
      });
      if (host !== null) headers.set("host", host);

      const response = await POST(
        makeInspectableRequest({ headers, json }),
        routeParams(),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(json).not.toHaveBeenCalled();
      expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("uses Host only and ignores forwarded partner-host spoofing", async () => {
    const response = await POST(
      makeRequest(undefined, {
        host: "SIMPLASSIST.COM.:443",
        forwardedHost: "app.alphadogagency.ai",
        forwarded: "host=app.alphadogagency.ai",
      }),
      routeParams(),
    );

    expect(response.status).toBe(200);
    expect(mocks.scheduleAdminAccountDeletion).toHaveBeenCalledOnce();
    expectPrivateNoStore(response);
  });

  it.each([
    ["missing Origin", null, "same-origin"],
    ["cross origin", "https://attacker.example", "cross-site"],
    [
      "suffix-lookalike Origin",
      "https://simplassist.com.evil.example",
      "same-origin",
    ],
    ["Origin with credentials", "https://user@simplassist.com", "same-origin"],
    ["Origin with path", "https://simplassist.com/path", "same-origin"],
    ["cross-site metadata", "https://simplassist.com", "cross-site"],
    ["same-site metadata", "https://simplassist.com", "same-site"],
    ["navigation metadata", "https://simplassist.com", "none"],
  ])("rejects %s before parsing JSON", async (_, origin, fetchSite) => {
    const json = vi.fn().mockResolvedValue({
      confirmationName: "Alpha Dental",
      acknowledgeLiveResources: false,
    });
    const headers = new Headers({
      host: "simplassist.com",
      "content-type": "application/json",
    });
    if (origin !== null) headers.set("origin", origin);
    if (fetchSite !== null) headers.set("sec-fetch-site", fetchSite);

    const response = await POST(
      makeInspectableRequest({ headers, json }),
      routeParams(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([null, "text/plain", "application/json-evil", "text/json"])(
    "requires the exact JSON media type before parsing: %s",
    async (contentType) => {
      const json = vi.fn();
      const headers = new Headers({
        host: "simplassist.com",
        origin: "https://simplassist.com",
        "sec-fetch-site": "same-origin",
      });
      if (contentType !== null) headers.set("content-type", contentType);

      const response = await POST(
        makeInspectableRequest({ headers, json }),
        routeParams(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(json).not.toHaveBeenCalled();
      expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it.each(["application/json", "Application/JSON; charset=utf-8"])(
    "accepts %s with absent Sec-Fetch-Site",
    async (contentType) => {
      const response = await POST(
        makeRequest(undefined, { contentType, fetchSite: null }),
        routeParams(),
      );

      expect(response.status).toBe(200);
      expect(mocks.scheduleAdminAccountDeletion).toHaveBeenCalledOnce();
      expectPrivateNoStore(response);
    },
  );

  it("rejects an invalid business UUID before reading JSON", async () => {
    const json = vi.fn();
    const request = makeInspectableRequest({
      headers: new Headers({
        host: "simplassist.com",
        origin: "https://simplassist.com",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      }),
      json,
    });

    const response = await POST(request, routeParams("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("rejects malformed JSON before scheduling", async () => {
    const response = await POST(
      makeRequest(undefined, { rawBody: "{" }),
      routeParams(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    null,
    [],
    {},
    { confirmationName: "Alpha Dental" },
    {
      confirmationName: "Alpha Dental",
      acknowledgeLiveResources: "false",
    },
    {
      confirmationName: "Alpha Dental",
      acknowledgeLiveResources: false,
      summary: { customer_email: "client@example.com" },
    },
  ])("rejects a malformed or extra-key body: %j", async (body) => {
    const response = await POST(makeRequest(body), routeParams());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.scheduleAdminAccountDeletion).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("passes the confirmation name byte-for-byte and returns only the safe service shape", async () => {
    const response = await POST(
      makeRequest({
        confirmationName: " Alpha Dental ",
        acknowledgeLiveResources: true,
      }),
      routeParams(),
    );

    expect(mocks.scheduleAdminAccountDeletion).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      confirmationName: " Alpha Dental ",
      acknowledgeLiveResources: true,
      actorAdminUserId: ADMIN_ID,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(SAFE_RESULT);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("summary");
    expect(serialized).not.toContain("customer_email");
    expect(serialized).not.toContain("message_content");
    expect(serialized).not.toContain("phone_number");
    expect(serialized).not.toContain("stripe_subscription_id");
    expect(serialized).not.toContain("provider_id");
    expect(serialized).not.toContain("token");
    expectPrivateNoStore(response);
  });

  it("returns live_ack_required with a freshly loaded safe preview", async () => {
    const refreshedPreview: AccountDeletionPreview = {
      ...SUSPENDED_PREVIEW,
      lifecycleStage: "launched",
      deletionScheduledFor: null,
      subscriptionStatus: "active",
      assignedPhoneCount: 1,
      requiresLiveAcknowledgement: true,
    };
    mocks.scheduleAdminAccountDeletion.mockRejectedValue(
      new AccountDeletionServiceError(
        "live_ack_required",
        409,
        "Live resources require explicit acknowledgement.",
      ),
    );
    mocks.getAdminAccountDeletionPreview.mockResolvedValue(refreshedPreview);

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "live_ack_required",
      code: "live_ack_required",
      message: "Live resources require explicit acknowledgement.",
      preview: refreshedPreview,
    });
    expect(mocks.getAdminAccountDeletionPreview).toHaveBeenCalledWith(
      BUSINESS_ID,
    );
    expectPrivateNoStore(response);
  });

  it.each([
    "provisioning_in_progress",
    "provisioning_outcome_unknown",
    "partner_subscription_conflict",
    "stripe_action_in_progress",
    "stripe_action_outcome_unknown",
    "confirmation_mismatch",
  ] as const)("returns the stable conflict %s", async (code) => {
    mocks.scheduleAdminAccountDeletion.mockRejectedValue(
      new AccountDeletionServiceError(code, 409, `Safe message for ${code}`),
    );

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: code,
      code,
      message: `Safe message for ${code}`,
    });
    expect(mocks.getAdminAccountDeletionPreview).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it("maps a missing or terminal target to a non-disclosing 404", async () => {
    mocks.scheduleAdminAccountDeletion.mockRejectedValue(
      new AccountDeletionServiceError("business_not_found", 404, "Not found"),
    );

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expectPrivateNoStore(response);
  });

  it("redacts unknown error details from the response and logs", async () => {
    const secret =
      "client@example.com +15555550123 stripe_subscription_id=sub_secret";
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.scheduleAdminAccountDeletion.mockRejectedValue(new Error(secret));

    const response = await POST(makeRequest(), routeParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to schedule account deletion",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "client@example.com",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("+15555550123");
    expectPrivateNoStore(response);
  });
});
