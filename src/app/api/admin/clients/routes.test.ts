import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  provisionPartnerClient: vi.fn(),
  retryPartnerClientProvisioning: vi.fn(),
  sendPartnerClientSetupEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/email/conciergeSetup", () => ({
  sendConciergeSetupEmail: vi.fn(),
}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/admin/clientProvisioning.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/admin/clientProvisioning.server")
    >();
  return {
    ...actual,
    provisionPartnerClient: mocks.provisionPartnerClient,
    retryPartnerClientProvisioning: mocks.retryPartnerClientProvisioning,
    sendPartnerClientSetupEmail: mocks.sendPartnerClientSetupEmail,
  };
});

import { ClientProvisioningError } from "@/lib/admin/clientProvisioning.server";
import { POST as createClient } from "./route";
import { POST as retryClient } from "./[provisioningId]/retry/route";
import { POST as sendSetup } from "./[provisioningId]/send-setup/route";

const JOB_ID = "10000000-0000-4000-a000-000000000001";
const PARTNER_ID = "20000000-0000-4000-a000-000000000001";
const ADMIN_ID = "50000000-0000-4000-a000-000000000001";

const PROVISIONING = {
  id: JOB_ID,
  email: "client@example.com",
  businessName: "Tidy Dogs",
  partnerId: PARTNER_ID,
  partnerName: "Alpha Dog Agency",
  billingMode: "invoiced",
  partnerPlan: "sms_and_chat",
  status: "admin_setup",
  lastErrorCode: null,
  authUserId: "30000000-0000-4000-a000-000000000001",
  businessId: "40000000-0000-4000-a000-000000000001",
  setupEmailSentAt: null,
  inviteAttemptCount: 1,
  createdAt: "2026-08-03T12:00:00.000Z",
  updatedAt: "2026-08-03T12:00:00.000Z",
};

const CREATE_BODY = {
  email: " CLIENT@example.com ",
  businessName: " Tidy Dogs ",
  partnerId: PARTNER_ID,
  billingMode: "invoiced",
  partnerPlan: "sms_and_chat",
};

function request(
  pathname: string,
  body: unknown = {},
  options: {
    origin?: string | null;
    host?: string;
    contentType?: string | null;
    fetchSite?: string | null;
    rawBody?: string;
  } = {},
) {
  const headers = new Headers();
  headers.set("host", options.host ?? "simplassist.com");
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://simplassist.com");
  }
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin");
  }
  return new NextRequest(`https://simplassist.com${pathname}`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("vary")).toBe("Cookie, Origin");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.provisionPartnerClient.mockResolvedValue({
    provisioning: PROVISIONING,
    adminSetupUrl:
      "https://app.alphadogagency.ai/api/auth/callback?token_hash=secret&type=recovery&flow=concierge",
  });
  mocks.retryPartnerClientProvisioning.mockResolvedValue({
    provisioning: PROVISIONING,
    adminSetupUrl:
      "https://app.alphadogagency.ai/api/auth/callback?token_hash=fresh&type=recovery&flow=concierge",
  });
  mocks.sendPartnerClientSetupEmail.mockResolvedValue({
    provisioning: {
      ...PROVISIONING,
      status: "setup_email_sent",
      setupEmailSentAt: "2026-08-03T12:05:00.000Z",
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin client provisioning routes", () => {
  it.each(["", "0", "true", "yes", "01", " 1", "1 "])(
    "rejects a crafted chat-only client with fail-closed partner flag %j before provisioning",
    async (flag) => {
      vi.stubEnv("CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED", flag);

      const response = await createClient(
        request("/api/admin/clients", {
          ...CREATE_BODY,
          partnerPlan: "chat_only",
        }),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "chat_only_not_available",
      });
      expect(mocks.provisionPartnerClient).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("passes chat-only to provisioning only with the exact partner flag", async () => {
    vi.stubEnv("CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED", "1");
    mocks.provisionPartnerClient.mockResolvedValue({
      provisioning: { ...PROVISIONING, partnerPlan: "chat_only" },
    });

    const response = await createClient(
      request("/api/admin/clients", {
        ...CREATE_BODY,
        partnerPlan: "chat_only",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.provisionPartnerClient).toHaveBeenCalledWith(
      expect.objectContaining({ partnerPlan: "chat_only" }),
      ADMIN_ID,
    );
    expectPrivateNoStore(response);
  });

  it("authorizes before origin/body processing and returns a non-disclosing 404", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await createClient(
      request(
        "/api/admin/clients",
        {},
        {
          origin: "https://attacker.example",
          contentType: "text/plain",
          rawBody: "not-json",
        },
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.provisionPartnerClient).not.toHaveBeenCalled();
    expectPrivateNoStore(response);
  });

  it.each([
    { origin: null, fetchSite: "same-origin" },
    { origin: "https://attacker.example", fetchSite: "cross-site" },
    { origin: "https://simplassist.com.evil.test", fetchSite: "same-origin" },
    { origin: "https://simplassist.com", fetchSite: "cross-site" },
  ])(
    "rejects a non-same-origin mutation before provisioning: %o",
    async (headers) => {
      const response = await createClient(
        request("/api/admin/clients", CREATE_BODY, headers),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "origin_not_allowed" });
      expect(mocks.provisionPartnerClient).not.toHaveBeenCalled();
      expectPrivateNoStore(response);
    },
  );

  it("defaults create to admin-only setup mode and normalizes validated input", async () => {
    const response = await createClient(
      request("/api/admin/clients", CREATE_BODY),
    );

    expect(response.status).toBe(200);
    expect(mocks.provisionPartnerClient).toHaveBeenCalledWith(
      {
        ...CREATE_BODY,
        email: "client@example.com",
        businessName: "Tidy Dogs",
        sendSetupEmailNow: false,
      },
      ADMIN_ID,
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({
        provisioning: PROVISIONING,
        adminSetupUrl: expect.stringContaining("token_hash=secret"),
      }),
    );
    expectPrivateNoStore(response);
  });

  it("passes explicit immediate-email mode without exposing a URL in the response", async () => {
    mocks.provisionPartnerClient.mockResolvedValue({
      provisioning: { ...PROVISIONING, status: "setup_email_sent" },
    });
    const response = await createClient(
      request("/api/admin/clients", {
        ...CREATE_BODY,
        sendSetupEmailNow: true,
      }),
    );

    expect(mocks.provisionPartnerClient).toHaveBeenCalledWith(
      expect.objectContaining({ sendSetupEmailNow: true }),
      ADMIN_ID,
    );
    expect(await response.json()).not.toHaveProperty("adminSetupUrl");
    expectPrivateNoStore(response);
  });

  it("rejects malformed JSON/content before any provider call", async () => {
    const wrongType = await createClient(
      request("/api/admin/clients", CREATE_BODY, { contentType: "text/plain" }),
    );
    const lookalikeType = await createClient(
      request("/api/admin/clients", CREATE_BODY, {
        contentType: "application/json-evil",
      }),
    );
    const invalidJson = await createClient(
      request("/api/admin/clients", CREATE_BODY, { rawBody: "{" }),
    );

    expect(wrongType.status).toBe(400);
    expect(lookalikeType.status).toBe(400);
    expect(invalidJson.status).toBe(400);
    expect(mocks.provisionPartnerClient).not.toHaveBeenCalled();
  });

  it("returns a safe resumable provisioning ID with a stable conflict", async () => {
    mocks.provisionPartnerClient.mockRejectedValue(
      new ClientProvisioningError(
        "email_in_use",
        409,
        "provider detail is hidden",
        JOB_ID,
      ),
    );
    const response = await createClient(
      request("/api/admin/clients", CREATE_BODY),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "email_in_use",
      provisioningId: JOB_ID,
    });
    expectPrivateNoStore(response);
  });

  it.each([
    "provisioning_in_progress",
    "provisioning_outcome_unknown",
    "job_dismissed",
    "auth_identity_mismatch",
  ] as const)("passes through the stable lease failure %s", async (code) => {
    mocks.provisionPartnerClient.mockRejectedValue(
      new ClientProvisioningError(code, 409, "hidden detail", JOB_ID),
    );

    const response = await createClient(
      request("/api/admin/clients", CREATE_BODY),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: code,
      provisioningId: JOB_ID,
    });
    expectPrivateNoStore(response);
  });

  it("redacts unknown error details from logs and JSON", async () => {
    const secret = "token_hash=should-never-be-logged";
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.provisionPartnerClient.mockRejectedValue(new Error(secret));

    const response = await createClient(
      request("/api/admin/clients", CREATE_BODY),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "provisioning_failed" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("token_hash");
  });

  it("defaults retry to a fresh admin-only link", async () => {
    const response = await retryClient(
      request(`/api/admin/clients/${JOB_ID}/retry`, {}),
      { params: { provisioningId: JOB_ID } },
    );

    expect(mocks.retryPartnerClientProvisioning).toHaveBeenCalledWith(
      JOB_ID,
      { sendSetupEmailNow: false },
      ADMIN_ID,
    );
    expect(await response.json()).toHaveProperty("adminSetupUrl");
    expectPrivateNoStore(response);
  });

  it("rejects an invalid retry ID without touching the service", async () => {
    const response = await retryClient(
      request("/api/admin/clients/not-a-uuid/retry", {}),
      { params: { provisioningId: "not-a-uuid" } },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "job_not_found" });
    expect(mocks.retryPartnerClientProvisioning).not.toHaveBeenCalled();
  });

  it("uses the explicit send endpoint for a fresh setup email", async () => {
    const response = await sendSetup(
      request(`/api/admin/clients/${JOB_ID}/send-setup`, {}),
      { params: { provisioningId: JOB_ID } },
    );

    expect(mocks.sendPartnerClientSetupEmail).toHaveBeenCalledWith(
      JOB_ID,
      ADMIN_ID,
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({
        provisioning: expect.objectContaining({ status: "setup_email_sent" }),
      }),
    );
    expectPrivateNoStore(response);
  });

  it("rejects unexpected send-setup fields", async () => {
    const response = await sendSetup(
      request(`/api/admin/clients/${JOB_ID}/send-setup`, { token: "attacker" }),
      { params: { provisioningId: JOB_ID } },
    );

    expect(response.status).toBe(400);
    expect(mocks.sendPartnerClientSetupEmail).not.toHaveBeenCalled();
  });
});
