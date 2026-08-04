import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getFreshWorkspaceAccess: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./workspaceAccess.server", () => ({
  getFreshWorkspaceAccess: mocks.getFreshWorkspaceAccess,
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));

import {
  getOptionalWorkspaceRouteAccess,
  requirePasswordSetupPageAccess,
  requirePasswordSetupRouteAccess,
  requireFreshWorkspaceRouteAccess,
  requireWorkspacePageAccess,
  requireWorkspaceRouteAccess,
  workspaceAccessRouteResponse,
  workspacePageRedirectTarget,
} from "./workspaceRouteResponse.server";
import type { WorkspaceAccess } from "./workspaceAccess.server";

const resolved: WorkspaceAccess = {
  status: "resolved",
  user: { id: "10000000-0000-4000-a000-000000000001" } as User,
  business: {
    id: "20000000-0000-4000-a000-000000000001",
    partner_id: null,
    billing_mode: "stripe",
  },
  hostKind: "canonical",
};

const passwordSetupRequired: WorkspaceAccess = {
  status: "resolved",
  user: {
    id: "10000000-0000-4000-a000-000000000001",
    app_metadata: { must_set_password: true },
  } as unknown as User,
  business: {
    id: "20000000-0000-4000-a000-000000000001",
    partner_id: null,
    billing_mode: "stripe",
  },
  hostKind: "canonical",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((target: string) => {
    throw new Error(`redirect:${target}`);
  });
});

describe("workspacePageRedirectTarget", () => {
  it("allows resolved access and sends unauthenticated access to login", () => {
    expect(workspacePageRedirectTarget(resolved)).toBeNull();
    expect(
      workspacePageRedirectTarget({ status: "unauthenticated" }),
    ).toBe("/login");
  });

  it("forces the literal setup marker to the fixed password route unless explicitly exempted", () => {
    expect(workspacePageRedirectTarget(passwordSetupRequired)).toBe(
      "/set-password",
    );
    expect(workspacePageRedirectTarget(passwordSetupRequired, true)).toBeNull();
  });

  it.each([
    { status: "business_not_found" },
    { status: "lookup_failed" },
    { status: "unknown_host" },
    { status: "partner_unavailable" },
    {
      status: "mismatch",
      expectedOrigin: "https://stored-partner.example",
      expectedName: "Stored Partner",
    },
  ] satisfies WorkspaceAccess[])("uses only the fixed blocked page for $status", (access) => {
    expect(workspacePageRedirectTarget(access)).toBe("/workspace-access");
  });
});

describe("workspaceAccessRouteResponse", () => {
  it("returns null for resolved access", () => {
    expect(workspaceAccessRouteResponse(resolved)).toBeNull();
  });

  it("maps unauthenticated to the existing 401 boundary", async () => {
    const response = workspaceAccessRouteResponse({ status: "unauthenticated" });

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("maps lookup failure to retryable 503", async () => {
    const response = workspaceAccessRouteResponse({ status: "lookup_failed" });

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "workspace_access_unavailable",
      retryable: true,
    });
  });

  it.each([
    { status: "business_not_found" },
    { status: "unknown_host" },
    { status: "partner_unavailable" },
    {
      status: "mismatch",
      expectedOrigin: "https://stored-partner.example",
      expectedName: "Stored Partner",
    },
  ] satisfies WorkspaceAccess[])("maps $status to stable 403", async (access) => {
    const response = workspaceAccessRouteResponse(access);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: "workspace_access_denied",
    });
  });
});

describe("requireWorkspacePageAccess", () => {
  it("returns the shared resolved decision to an authenticated leaf page", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(resolved);

    await expect(requireWorkspacePageAccess()).resolves.toBe(resolved);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects an unfinished concierge session before rendering ordinary pages", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(passwordSetupRequired);

    await expect(requireWorkspacePageAccess()).rejects.toThrow(
      "redirect:/set-password",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/set-password");
  });

  it("lets only the password-setup page consume the marked workspace", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(passwordSetupRequired);

    await expect(requirePasswordSetupPageAccess()).resolves.toBe(
      passwordSetupRequired,
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "unauthenticated" }, "/login"],
    [{ status: "business_not_found" }, "/workspace-access"],
    [{ status: "lookup_failed" }, "/workspace-access"],
    [{ status: "unknown_host" }, "/workspace-access"],
    [{ status: "partner_unavailable" }, "/workspace-access"],
    [
      {
        status: "mismatch",
        expectedOrigin: "https://stored-partner.example",
        expectedName: "Stored Partner",
      },
      "/workspace-access",
    ],
  ] satisfies Array<[WorkspaceAccess, "/login" | "/workspace-access"]>)(
    "redirects $0.status through the fixed leaf-page target $1",
    async (access, target) => {
      mocks.getWorkspaceAccess.mockResolvedValue(access);

      await expect(requireWorkspacePageAccess()).rejects.toThrow(
        `redirect:${target}`,
      );
      expect(mocks.redirect).toHaveBeenCalledWith(target);
    },
  );
});

describe("workspace route adapters", () => {
  it("returns the resolved identity/business decision to required routes", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(resolved);

    await expect(requireWorkspaceRouteAccess()).resolves.toEqual({
      ok: true,
      access: resolved,
    });
  });

  it("denies ordinary APIs until password setup and exempts only the setup adapter", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(passwordSetupRequired);

    const blocked = await requireWorkspaceRouteAccess();
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("Expected password setup to block APIs");
    expect(blocked.response.status).toBe(403);
    await expect(blocked.response.json()).resolves.toEqual({
      error: "password_setup_required",
    });

    mocks.getWorkspaceAccess.mockResolvedValue(passwordSetupRequired);
    await expect(requirePasswordSetupRouteAccess()).resolves.toEqual({
      ok: true,
      access: passwordSetupRequired,
    });
  });

  it("uses the uncached resolver for an explicit fresh route decision", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status: "lookup_failed" });
    mocks.getFreshWorkspaceAccess.mockResolvedValue(resolved);

    await expect(requireFreshWorkspaceRouteAccess()).resolves.toEqual({
      ok: true,
      access: resolved,
    });
    expect(mocks.getFreshWorkspaceAccess).toHaveBeenCalledOnce();
    expect(mocks.getWorkspaceAccess).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "mismatch", expectedOrigin: null, expectedName: null }, 403],
    [{ status: "lookup_failed" }, 503],
  ] satisfies Array<[WorkspaceAccess, number]>) (
    "maps fresh route state $0.status to $1",
    async (access, status) => {
      mocks.getFreshWorkspaceAccess.mockResolvedValue(access);

      const result = await requireFreshWorkspaceRouteAccess();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected a blocked fresh decision");
      expect(result.response.status).toBe(status);
    },
  );

  it.each([
    [{ status: "unauthenticated" }, 401, "Unauthorized"],
    [{ status: "lookup_failed" }, 503, "workspace_access_unavailable"],
    [{ status: "unknown_host" }, 403, "workspace_access_denied"],
    [
      {
        status: "mismatch",
        expectedOrigin: "https://stored-partner.example",
        expectedName: "Stored Partner",
      },
      403,
      "workspace_access_denied",
    ],
  ] satisfies Array<[WorkspaceAccess, number, string]>)(
    "returns $1 for required route state $0.status",
    async (access, status, error) => {
      mocks.getWorkspaceAccess.mockResolvedValue(access);

      const result = await requireWorkspaceRouteAccess();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected a blocked workspace response");
      expect(result.response.status).toBe(status);
      await expect(result.response.json()).resolves.toMatchObject({ error });
    },
  );

  it("keeps only resolved sessions for optional attribution", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue(resolved);
    await expect(getOptionalWorkspaceRouteAccess()).resolves.toBe(resolved);

    for (const access of [
      { status: "unauthenticated" },
      { status: "lookup_failed" },
      { status: "unknown_host" },
      {
        status: "mismatch",
        expectedOrigin: "https://stored-partner.example",
        expectedName: "Stored Partner",
      },
    ] satisfies WorkspaceAccess[]) {
      mocks.getWorkspaceAccess.mockResolvedValueOnce(access);
      await expect(getOptionalWorkspaceRouteAccess()).resolves.toBeNull();
    }

    mocks.getWorkspaceAccess.mockResolvedValue(passwordSetupRequired);
    await expect(getOptionalWorkspaceRouteAccess()).resolves.toBeNull();
  });
});
