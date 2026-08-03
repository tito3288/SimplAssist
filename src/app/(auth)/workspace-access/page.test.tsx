import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceAccess: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/customer/workspaceAccess.server", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/components/auth/WorkspaceAccessActions", () => ({
  WorkspaceAccessActions: () => <button>Use a different account here</button>,
}));

import WorkspaceAccessPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("WorkspaceAccessPage", () => {
  it("redirects unauthenticated visitors to the relative login route", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status: "unauthenticated" });

    await expect(WorkspaceAccessPage()).rejects.toThrow("redirect:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects resolved access to the relative dashboard route", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({
      status: "resolved",
      user: { id: "user-1" },
      business: { id: "business-1" },
      hostKind: "partner",
    });

    await expect(WorkspaceAccessPage()).rejects.toThrow("redirect:/dashboard");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders only the resolver-provided workspace name and safe origin for a mismatch", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({
      status: "mismatch",
      expectedName: "Alpha Dog Agency",
      expectedOrigin: "https://app.alphadogagency.ai",
    });

    const html = renderToStaticMarkup(await WorkspaceAccessPage());

    expect(html).toContain("This account belongs to a different workspace");
    expect(html).toContain("Alpha Dog Agency");
    expect(html).toContain(
      'href="https://app.alphadogagency.ai/login"'
    );
    expect(html).toContain("https://app.alphadogagency.ai/login");
    expect(html).toContain("Use a different account here");
    expect(html).not.toContain("next=");
    expect(html).not.toContain("redirect=");
  });

  it("omits a malformed expected origin instead of creating an unsafe link", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({
      status: "mismatch",
      expectedName: "Assigned Partner",
      expectedOrigin: "javascript:alert(1)",
    });

    const html = renderToStaticMarkup(await WorkspaceAccessPage());

    expect(html).toContain(
      "Contact your account administrator for the correct sign-in address."
    );
    expect(html).not.toContain("javascript:");
  });

  it("links an unassigned partner-host session back to canonical login", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({
      status: "mismatch",
      expectedName: "SimplAssist",
      expectedOrigin: "https://simplassist.com",
    });

    const html = renderToStaticMarkup(await WorkspaceAccessPage());

    expect(html).toContain('href="https://simplassist.com/login"');
    expect(html).toContain("Continue to SimplAssist");
  });

  it.each([
    ["business_not_found", "could not find a business workspace"],
    ["lookup_failed", "temporary problem"],
    ["unknown_host", "not connected to a workspace"],
    ["partner_unavailable", "partner workspace is not currently available"],
  ] as const)(
    "fails closed for %s with retry and account-switch actions",
    async (status, expectedCopy) => {
      mocks.getWorkspaceAccess.mockResolvedValue({ status });

      const html = renderToStaticMarkup(await WorkspaceAccessPage());

      expect(html).toContain(expectedCopy);
      expect(html).toContain('href="/workspace-access"');
      expect(html).toContain("Try again");
      expect(html).toContain("Use a different account here");
      expect(mocks.redirect).not.toHaveBeenCalled();
    }
  );
});
