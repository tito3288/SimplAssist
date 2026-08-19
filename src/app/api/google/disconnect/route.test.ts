import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  rpc: vi.fn(),
  revokeToken: vi.fn(),
  withGoogleAuthDeadline: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("@/lib/google/client", () => ({
  getGoogleOAuth2Client: vi.fn(() => ({
    revokeToken: mocks.revokeToken,
  })),
  withGoogleAuthDeadline: mocks.withGoogleAuthDeadline,
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: USER_ID },
      business: {
        id: BUSINESS_ID,
        partner_id: "00000000-0000-4000-8000-000000000003",
      },
      hostKind: "partner",
    },
  });
  mocks.rpc.mockResolvedValue({
    data: "google-access-token",
    error: null,
  });
  mocks.revokeToken.mockResolvedValue(undefined);
  mocks.withGoogleAuthDeadline.mockImplementation(
    async (promise: Promise<unknown>) => promise,
  );
});

describe("Google Calendar disconnect", () => {
  it.each([401, 403, 503] as const)(
    "maps workspace %s before token fencing or Google revocation",
    async (status) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json(
          status === 401
            ? { error: "Unauthorized" }
            : status === 403
              ? { error: "workspace_access_denied" }
              : { error: "workspace_access_unavailable", retryable: true },
          { status },
        ),
      });

      const response = await POST();

      expect(response.status).toBe(status);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.revokeToken).not.toHaveBeenCalled();
    },
  );

  it("atomically removes the local token before bounded best-effort revocation", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "disconnect_google_calendar_token",
      { p_business_id: BUSINESS_ID },
    );
    expect(mocks.rpc).toHaveBeenCalledBefore(mocks.revokeToken);
    expect(mocks.revokeToken).toHaveBeenCalledWith("google-access-token");
    expect(mocks.withGoogleAuthDeadline).toHaveBeenCalledWith(
      expect.any(Promise),
      5_000,
    );
  });

  it("returns retryable 503 and does not revoke while provider or AI work is unresolved", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "55P03",
        message: "calendar_provider_operation_busy",
      },
    });

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "calendar_operation_unavailable",
      retryable: true,
    });
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it("does not call Google when there is no saved token", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it("keeps local deletion authoritative when bounded Google revocation fails", async () => {
    mocks.withGoogleAuthDeadline.mockRejectedValue(
      new Error("patient@example.test bearer-secret"),
    );

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails closed on malformed service RPC output without exposing it", async () => {
    mocks.rpc.mockResolvedValue({
      data: { access_token: "private-token" },
      error: null,
    });

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "service_unavailable",
      retryable: true,
    });
    expect(mocks.revokeToken).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private-token",
    );
  });

  it("logs only a database error code for an unexpected fencing failure", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: "patient@example.test bearer-secret provider-body",
      },
    });

    const response = await POST();

    expect(response.status).toBe(503);
    expect(console.error).toHaveBeenCalledWith(
      "[google-disconnect] Token fencing failed",
      { code: "XX000" },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "patient@example.test",
    );
  });
});
