import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  workspacePageRedirectTarget: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  getOnboardingStateForOwner: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/customer/workspaceAccess.server", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  workspacePageRedirectTarget: mocks.workspacePageRedirectTarget,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingStateForOwner: mocks.getOnboardingStateForOwner,
}));
vi.mock("@/components/onboarding/OnboardingSignOut", () => ({
  default: () => <span>Sign out</span>,
}));
vi.mock("@/components/onboarding/OnboardingDeleteAccount", () => ({
  default: () => <span>Delete account</span>,
}));
vi.mock("@/lib/theme-v2/ui", () => ({ ThemeToggleV2: () => null }));

import OnboardingLayout from "./layout";

const USER = { id: "user-1", email: "owner@example.com" };
const BUSINESS = { id: "business-1", partner_id: null, deleted_at: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.getWorkspaceAccess.mockResolvedValue({
    status: "resolved",
    user: USER,
    business: {
      id: BUSINESS.id,
      partner_id: null,
      billing_mode: "stripe",
    },
    hostKind: "canonical",
  });
  mocks.workspacePageRedirectTarget.mockReturnValue(null);
  mocks.getUser.mockResolvedValue({ data: { user: USER } });
  const businessQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  };
  businessQuery.select.mockReturnValue(businessQuery);
  businessQuery.eq.mockReturnValue(businessQuery);
  businessQuery.single.mockResolvedValue({ data: BUSINESS, error: null });
  mocks.from.mockReturnValue(businessQuery);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  });
  mocks.getOnboardingStateForOwner.mockResolvedValue({ dashboardReady: false });
});

describe("OnboardingLayout workspace access", () => {
  it("renders only after the shared workspace decision resolves", async () => {
    const layout = await OnboardingLayout({
      children: <main>Onboarding</main>,
    });
    const html = renderToStaticMarkup(layout);

    expect(mocks.getWorkspaceAccess).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.getOnboardingStateForOwner).toHaveBeenCalledWith(USER.id);
    expect(html).toContain("Delete account");
    expect(html).toContain("Sign out");
  });

  it("renders deletion on an exact resolved partner workspace", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({
      status: "resolved",
      user: USER,
      business: {
        id: BUSINESS.id,
        partner_id: "partner-1",
        billing_mode: "invoiced",
      },
      hostKind: "partner",
    });

    const layout = await OnboardingLayout({
      children: <main>Partner onboarding</main>,
    });

    expect(renderToStaticMarkup(layout)).toContain("Delete account");
  });

  it("redirects a scheduled onboarding account before rendering controls", async () => {
    const businessQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
    };
    businessQuery.select.mockReturnValue(businessQuery);
    businessQuery.eq.mockReturnValue(businessQuery);
    businessQuery.single.mockResolvedValue({
      data: {
        ...BUSINESS,
        deleted_at: "2026-08-03T16:00:00.000Z",
      },
      error: null,
    });
    mocks.from.mockReturnValue(businessQuery);

    await expect(
      OnboardingLayout({ children: <main>Onboarding</main> }),
    ).rejects.toThrow("redirect:/account-deleted");
    expect(mocks.getOnboardingStateForOwner).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users before onboarding reads", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status: "unauthenticated" });
    mocks.workspacePageRedirectTarget.mockReturnValue("/login");

    await expect(
      OnboardingLayout({ children: <main>Onboarding</main> }),
    ).rejects.toThrow("redirect:/login");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getOnboardingStateForOwner).not.toHaveBeenCalled();
  });

  it.each([
    "business_not_found",
    "mismatch",
    "unknown_host",
    "partner_unavailable",
    "lookup_failed",
  ])("redirects %s decisions before onboarding reads", async (status) => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status });
    mocks.workspacePageRedirectTarget.mockReturnValue("/workspace-access");

    await expect(
      OnboardingLayout({ children: <main>Onboarding</main> }),
    ).rejects.toThrow("redirect:/workspace-access");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.getOnboardingStateForOwner).not.toHaveBeenCalled();
  });
});
