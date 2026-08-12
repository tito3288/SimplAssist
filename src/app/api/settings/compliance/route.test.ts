import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  adminFrom: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  registrationHasStartedForRisk: (business: {
    telnyx_brand_id: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    onboarding_registration_status: string | null;
  }) =>
    Boolean(
      business.telnyx_brand_id ||
        business.brand_status ||
        business.campaign_status ||
        business.onboarding_registration_status === "submitted"
    ),
}));

import {
  REGISTRATION_STATE_UNAVAILABLE_CODE,
  REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
  SETTINGS_REGISTRATION_LOCK_CODE,
  SETTINGS_STATE_CHANGED_CODE,
  SETTINGS_STATE_CHANGED_MESSAGE,
  COMPLIANCE_LOCK_COPY,
} from "@/lib/settings/registrationLockCopy";
import { SETTINGS_REGISTRATION_STATE_COLUMNS } from "@/lib/settings/registrationLock.server";
import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";

const PRISTINE_STATE = {
  telnyx_brand_id: null,
  brand_status: null,
  campaign_status: null,
  onboarding_registration_status: "not_started" as const,
};

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryChain = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

const chains: QueryChain[] = [];
let readResults: QueryResult[] = [];
let updateResult: QueryResult;
let fetchMock: ReturnType<typeof vi.fn>;

function makeChain(): QueryChain {
  let operation: "select" | "update" | null = null;
  const chain = {} as QueryChain;
  chain.select = vi.fn(() => {
    if (operation === null) operation = "select";
    return chain;
  });
  chain.update = vi.fn(() => {
    operation = "update";
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => {
    if (operation === "update") return updateResult;
    return (
      readResults.shift() ?? { data: PRISTINE_STATE, error: null }
    );
  });
  chains.push(chain);
  return chain;
}

function request(body: unknown = {
  mode: "hosted",
  privacyUrlOverride: null,
  termsUrlOverride: null,
}) {
  return new NextRequest("http://localhost/api/settings/compliance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string) {
  return new NextRequest("http://localhost/api/settings/compliance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function updateChains() {
  return chains.filter((chain) => chain.update.mock.calls.length > 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  chains.length = 0;
  readResults = [{ data: PRISTINE_STATE, error: null }];
  updateResult = { data: { id: BUSINESS_ID }, error: null };
  fetchMock = vi.fn().mockResolvedValue({ status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: { business: { id: BUSINESS_ID } },
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
  });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table !== "businesses") throw new Error(`Unexpected table: ${table}`);
    return makeChain();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/settings/compliance", () => {
  it("keeps the workspace gate as the first await and passes through its denial", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_denied" },
        { status: 403 }
      ),
    });
    const nextRequest = request();
    const jsonSpy = vi.spyOn(nextRequest, "json");

    const response = await POST(nextRequest);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "workspace_access_denied",
    });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 before parsing or reading registration state", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const nextRequest = request();
    const jsonSpy = vi.spyOn(nextRequest, "json");

    const response = await POST(nextRequest);

    expect(response.status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before reading registration state", async () => {
    const response = await POST(rawRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid schema input before reading registration state", async () => {
    const response = await POST(request({ mode: "unsupported" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid input" });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Telnyx brand ID", { telnyx_brand_id: "brand-1" }],
    ["brand status", { brand_status: "pending" }],
    ["campaign status", { campaign_status: "approved" }],
    [
      "submitted registration status",
      { onboarding_registration_status: "submitted" },
    ],
  ])("returns the exact 403 for a lock signaled by %s", async (_label, override) => {
    readResults = [
      { data: { ...PRISTINE_STATE, ...override }, error: null },
    ];

    const response = await POST(
      request({
        mode: "self_hosted",
        privacyUrlOverride: "https://example.test/privacy",
        termsUrlOverride: "https://example.test/terms",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: SETTINGS_REGISTRATION_LOCK_CODE,
      error: COMPLIANCE_LOCK_COPY.message,
    });
    expect(chains[0]?.select).toHaveBeenCalledWith(
      SETTINGS_REGISTRATION_STATE_COLUMNS
    );
    expect(chains[0]?.is).toHaveBeenCalledWith("deleted_at", null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateChains()).toHaveLength(0);
  });

  it("fails closed with exact 503 when registration-state lookup throws", async () => {
    mocks.adminFrom.mockImplementationOnce(() => {
      throw new Error("database offline");
    });

    const response = await POST(
      request({
        mode: "self_hosted",
        privacyUrlOverride: "https://example.test/privacy",
        termsUrlOverride: "https://example.test/terms",
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: REGISTRATION_STATE_UNAVAILABLE_CODE,
      error: REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets failed registration override every canonical started signal", async () => {
    const failedState = {
      telnyx_brand_id: "brand-1",
      brand_status: "approved",
      campaign_status: "approved",
      onboarding_registration_status: "failed" as const,
    };
    readResults = [{ data: failedState, error: null }];

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateChains()).toHaveLength(1);
    const update = updateChains()[0];
    expect(update.eq).toHaveBeenCalledWith("telnyx_brand_id", "brand-1");
    expect(update.eq).toHaveBeenCalledWith("brand_status", "approved");
    expect(update.eq).toHaveBeenCalledWith("campaign_status", "approved");
    expect(update.eq).toHaveBeenCalledWith(
      "onboarding_registration_status",
      "failed"
    );
  });

  it.each([
    ["query error", { data: null, error: { message: "database unavailable" } }],
    ["missing row", { data: null, error: null }],
  ])("fails closed with exact 503 on registration-state %s", async (_label, result) => {
    readResults = [result];

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: REGISTRATION_STATE_UNAVAILABLE_CODE,
      error: REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateChains()).toHaveLength(0);
  });

  it("keeps hosted-mode shape validation ahead of reachability and writes", async () => {
    const response = await POST(
      request({
        mode: "hosted",
        privacyUrlOverride: "https://example.test/privacy",
        termsUrlOverride: null,
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "Override URLs must be omitted when mode is 'hosted' — SimplAssist serves the pages",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateChains()).toHaveLength(0);
  });

  it("keeps HTTPS validation ahead of reachability and writes", async () => {
    const response = await POST(
      request({
        mode: "self_hosted",
        privacyUrlOverride: "http://example.test/privacy",
        termsUrlOverride: "https://example.test/terms",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Privacy URL must be a valid HTTPS URL",
      field: "privacyUrlOverride",
      url: "http://example.test/privacy",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateChains()).toHaveLength(0);
  });

  it("preserves HEAD-to-GET fallback, trimming, and successful custom URL writes", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 405 })
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({ status: 200 });

    const response = await POST(
      request({
        mode: "existing",
        privacyUrlOverride: "  https://example.test/privacy  ",
        termsUrlOverride: "  https://example.test/terms  ",
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.test/privacy",
      expect.objectContaining({ method: "HEAD", redirect: "follow" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.test/privacy",
      expect.objectContaining({ method: "GET", redirect: "follow" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://example.test/terms",
      expect.objectContaining({ method: "HEAD", redirect: "follow" })
    );
    expect(updateChains()[0]?.update).toHaveBeenCalledWith({
      privacy_terms_mode: "existing",
      privacy_url_override: "https://example.test/privacy",
      terms_url_override: "https://example.test/terms",
    });
  });

  it("preserves URL reachability failures without attempting a write", async () => {
    fetchMock.mockResolvedValueOnce({ status: 503 });

    const response = await POST(
      request({
        mode: "self_hosted",
        privacyUrlOverride: "https://example.test/privacy",
        termsUrlOverride: "https://example.test/terms",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Privacy URL could not be reached (returned HTTP 503)",
      field: "privacyUrlOverride",
      url: "https://example.test/privacy",
    });
    expect(updateChains()).toHaveLength(0);
  });

  it("CASes every pristine registration-state field on the final update", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    const update = updateChains()[0];
    expect(update.eq).toHaveBeenCalledWith("id", BUSINESS_ID);
    expect(update.eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(update.is).toHaveBeenCalledWith("deleted_at", null);
    expect(update.eq).toHaveBeenCalledWith(
      "onboarding_registration_status",
      "not_started"
    );
    expect(update.is).toHaveBeenCalledWith("telnyx_brand_id", null);
    expect(update.is).toHaveBeenCalledWith("brand_status", null);
    expect(update.is).toHaveBeenCalledWith("campaign_status", null);
    expect(update.select).toHaveBeenCalledWith("id");
  });

  it("returns exact 403 when the CAS loses to a newly locked registration", async () => {
    updateResult = { data: null, error: null };
    readResults = [
      { data: PRISTINE_STATE, error: null },
      {
        data: {
          ...PRISTINE_STATE,
          telnyx_brand_id: "brand-new",
          onboarding_registration_status: "submitted",
        },
        error: null,
      },
    ];

    const response = await POST(
      request({
        mode: "self_hosted",
        privacyUrlOverride: "https://example.test/privacy",
        termsUrlOverride: "https://example.test/terms",
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: SETTINGS_REGISTRATION_LOCK_CODE,
      error: COMPLIANCE_LOCK_COPY.message,
    });
    expect(chains).toHaveLength(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.test/privacy",
      expect.objectContaining({ method: "HEAD" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.test/terms",
      expect.objectContaining({ method: "HEAD" })
    );
  });

  it("returns exact 409 when the CAS loses but registration remains unlocked", async () => {
    updateResult = { data: null, error: null };
    readResults = [
      { data: PRISTINE_STATE, error: null },
      {
        data: {
          ...PRISTINE_STATE,
          onboarding_registration_status: "submitting",
        },
        error: null,
      },
    ];

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: SETTINGS_STATE_CHANGED_CODE,
      error: SETTINGS_STATE_CHANGED_MESSAGE,
    });
  });

  it("returns exact 503 when registration state cannot be reloaded after a CAS miss", async () => {
    updateResult = { data: null, error: null };
    readResults = [
      { data: PRISTINE_STATE, error: null },
      { data: null, error: { message: "database unavailable" } },
    ];

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: REGISTRATION_STATE_UNAVAILABLE_CODE,
      error: REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
    });
  });

  it("preserves the existing 500 response for update errors", async () => {
    updateResult = {
      data: null,
      error: { message: "write unavailable" },
    };

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to save compliance settings",
    });
  });
});
