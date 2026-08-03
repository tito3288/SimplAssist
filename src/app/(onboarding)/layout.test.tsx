import { beforeEach, describe, expect, it, vi } from "vitest";

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
  default: () => null,
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
    business: { id: BUSINESS.id, partner_id: null },
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
    await expect(
      OnboardingLayout({ children: <main>Onboarding</main> })
    ).resolves.toBeDefined();

    expect(mocks.getWorkspaceAccess).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.getOnboardingStateForOwner).toHaveBeenCalledWith(USER.id);
  });

  it("redirects unauthenticated users before onboarding reads", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status: "unauthenticated" });
    mocks.workspacePageRedirectTarget.mockReturnValue("/login");

    await expect(
      OnboardingLayout({ children: <main>Onboarding</main> })
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
  ])(
    "redirects %s decisions before onboarding reads",
    async (status) => {
      mocks.getWorkspaceAccess.mockResolvedValue({ status });
      mocks.workspacePageRedirectTarget.mockReturnValue("/workspace-access");

      await expect(
        OnboardingLayout({ children: <main>Onboarding</main> })
      ).rejects.toThrow("redirect:/workspace-access");

      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.getOnboardingStateForOwner).not.toHaveBeenCalled();
    }
  );
});
