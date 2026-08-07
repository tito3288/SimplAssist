import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-a000-000000000001";

const mocks = vi.hoisted(() => ({
  requirePasswordSetupRouteAccess: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requirePasswordSetupRouteAccess: mocks.requirePasswordSetupRouteAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { updateUserById: mocks.updateUserById } },
  },
}));

import {
  createPasswordResetIntent,
  PASSWORD_RESET_INTENT_COOKIE,
} from "@/lib/auth/recovery.server";
import { POST } from "./route";

function request(
  body: unknown,
  host = "app.alphadogagency.ai",
  securityHeaders: {
    origin?: string | null;
    fetchSite?: string | null;
    resetIntent?: string | null;
  } = {},
) {
  const origin =
    securityHeaders.origin === undefined
      ? `https://${host}`
      : securityHeaders.origin;
  const fetchSite =
    securityHeaders.fetchSite === undefined
      ? "same-origin"
      : securityHeaders.fetchSite;
  const headers = new Headers({ host, "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  if (fetchSite !== null) headers.set("sec-fetch-site", fetchSite);
  const isReset =
    body !== null &&
    typeof body === "object" &&
    (body as Record<string, unknown>).mode === "reset";
  const resetIntent =
    securityHeaders.resetIntent === undefined && isReset
      ? createPasswordResetIntent(USER_ID, origin ?? `https://${host}`)
      : securityHeaders.resetIntent;
  if (resetIntent) {
    headers.set("cookie", `${PASSWORD_RESET_INTENT_COOKIE}=${resetIntent}`);
  }

  return new NextRequest("http://localhost:8080/api/auth/set-password", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function resolvedWorkspace(
  mustSetPassword: unknown,
  options: { includeMarker?: boolean } = {},
) {
  const appMetadata: Record<string, unknown> = {
    provider: "email",
    concierge_provisioning_id: "40000000-0000-4000-a000-000000000001",
  };
  if (options.includeMarker !== false) {
    appMetadata.must_set_password = mustSetPassword;
  }

  return {
    ok: true as const,
    access: {
      status: "resolved" as const,
      user: {
        id: USER_ID,
        app_metadata: appMetadata,
      },
      business: {
        id: "20000000-0000-4000-a000-000000000001",
        partner_id: "30000000-0000-4000-a000-000000000001",
      },
      hostKind: "partner" as const,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-secret");
  mocks.requirePasswordSetupRouteAccess.mockResolvedValue(
    resolvedWorkspace(true),
  );
  mocks.updateUserById.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/set-password", () => {
  it("sets the password and writes a fail-closed false marker while preserving other metadata", async () => {
    const response = await POST(request({ password: "new-password" }));

    expect(mocks.requirePasswordSetupRouteAccess).toHaveBeenCalledOnce();
    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, {
      password: "new-password",
      app_metadata: {
        provider: "email",
        concierge_provisioning_id:
          "40000000-0000-4000-a000-000000000001",
        must_set_password: false,
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: "/onboarding",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("resets the password and clears a literal-true setup marker while preserving unrelated metadata", async () => {
    const response = await POST(
      request({ password: "replacement-password", mode: "reset" }),
    );

    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, {
      password: "replacement-password",
      app_metadata: {
        provider: "email",
        concierge_provisioning_id:
          "40000000-0000-4000-a000-000000000001",
        must_set_password: false,
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: "/onboarding",
    });
    expect(response.headers.get("set-cookie")).toContain(
      `${PASSWORD_RESET_INTENT_COOKIE}=`,
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects reset mode from an ordinary authenticated session without callback intent", async () => {
    const response = await POST(
      request(
        { password: "replacement-password", mode: "reset" },
        "app.alphadogagency.ai",
        { resetIntent: null },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "password_reset_intent_required",
      message: "This password reset link is no longer active.",
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ["false", false, true],
    ["null", null, true],
    ["malformed", "true", true],
    ["absent", undefined, false],
  ])(
    "resets the password with a %s setup marker without writing app metadata",
    async (_label, mustSetPassword, includeMarker) => {
      mocks.requirePasswordSetupRouteAccess.mockResolvedValue(
        resolvedWorkspace(mustSetPassword, { includeMarker }),
      );

      const response = await POST(
        request({ password: "replacement-password", mode: "reset" }),
      );

      expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, {
        password: "replacement-password",
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        redirectTo: "/onboarding",
      });
    },
  );

  it("fails a wrong-Host workspace decision before touching Auth", async () => {
    mocks.requirePasswordSetupRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "workspace_access_denied" },
        { status: 403 },
      ),
    });

    const response = await POST(
      request({ password: "new-password" }, "simplassist.com"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "workspace_access_denied",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ["missing Origin", { origin: null }],
    ["malformed Origin", { origin: "not a URL" }],
    [
      "cross-site Origin",
      { origin: "https://attacker.example", fetchSite: "cross-site" },
    ],
    ["missing fetch metadata", { fetchSite: null }],
    ["cross-site fetch metadata", { fetchSite: "cross-site" }],
  ])("rejects %s before body parsing or Auth mutation", async (_label, headers) => {
    const input = request(
      { password: "new-password" },
      "app.alphadogagency.ai",
      headers,
    );
    const readBody = vi.spyOn(input, "json");
    const response = await POST(input);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "same_origin_required",
      message: "Password setup must be submitted from this workspace.",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(readBody).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("accepts the configured canonical origin for a canonical workspace", async () => {
    const workspace = resolvedWorkspace(true);
    mocks.requirePasswordSetupRouteAccess.mockResolvedValue({
      ...workspace,
      access: {
        ...workspace.access,
        business: { ...workspace.access.business, partner_id: null },
        hostKind: "canonical" as const,
      },
    });

    const response = await POST(
      request(
        { password: "new-password" },
        "simplassist.com",
        { origin: "https://simplassist.com" },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledOnce();
  });

  it.each([false, null, undefined, "true"])(
    "rejects a replayed or malformed setup marker %s (only literal true is active)",
    async (mustSetPassword) => {
      mocks.requirePasswordSetupRouteAccess.mockResolvedValue(
        resolvedWorkspace(mustSetPassword),
      );

      const response = await POST(request({ password: "new-password" }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "password_setup_not_required",
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.updateUserById).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { password: "short" },
    { password: "new-password", mode: "setup" },
    { password: "new-password", mode: "RESET" },
    { password: "new-password", mode: null },
    { password: "new-password", next: "https://evil.example" },
    { password: "new-password", redirectTo: "/admin" },
  ])("rejects malformed or redirect-shaped input %#", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_password",
    });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("does not clear the marker when the atomic Auth update fails", async () => {
    mocks.updateUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth unavailable" },
    });

    const response = await POST(request({ password: "new-password" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "password_update_failed",
    });
  });

  it("returns a fixed failure when a password-only reset update throws", async () => {
    mocks.requirePasswordSetupRouteAccess.mockResolvedValue(
      resolvedWorkspace(false),
    );
    mocks.updateUserById.mockRejectedValue(new Error("Auth unavailable"));

    const response = await POST(
      request({ password: "replacement-password", mode: "reset" }),
    );

    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, {
      password: "replacement-password",
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "password_update_failed",
      message: "We could not set your password. Please try again.",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
