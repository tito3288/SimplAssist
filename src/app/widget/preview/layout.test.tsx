import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  workspacePageRedirectTarget: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/customer/workspaceAccess.server", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  workspacePageRedirectTarget: mocks.workspacePageRedirectTarget,
}));

import WidgetPreviewLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.getWorkspaceAccess.mockResolvedValue({
    status: "resolved",
    user: { id: "user-1" },
    business: { id: "business-1", partner_id: null },
    hostKind: "canonical",
  });
  mocks.workspacePageRedirectTarget.mockReturnValue(null);
});

describe("WidgetPreviewLayout workspace access", () => {
  it("renders an authenticated preview only in its resolved workspace", async () => {
    await expect(
      WidgetPreviewLayout({ children: <main>Preview</main> })
    ).resolves.toBeDefined();
    expect(mocks.getWorkspaceAccess).toHaveBeenCalledOnce();
  });

  it.each([
    ["unauthenticated", "/login"],
    ["business_not_found", "/workspace-access"],
    ["mismatch", "/workspace-access"],
    ["unknown_host", "/workspace-access"],
    ["partner_unavailable", "/workspace-access"],
    ["lookup_failed", "/workspace-access"],
  ])("redirects %s previews to %s", async (status, path) => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status });
    mocks.workspacePageRedirectTarget.mockReturnValue(path);

    await expect(
      WidgetPreviewLayout({ children: <main>Preview</main> })
    ).rejects.toThrow(`redirect:${path}`);
  });
});
