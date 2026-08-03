import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  workspacePageRedirectTarget: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
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
vi.mock("@/components/account/ReactivationCard", () => ({
  default: ({ deletionDate }: { deletionDate: string }) => (
    <div>Reactivation {deletionDate}</div>
  ),
}));

import AccountDeletedPage from "./page";

const USER = { id: "user-1", email: "owner@example.com" };
const DELETION_DATE = "2026-08-30T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.getWorkspaceAccess.mockResolvedValue({
    status: "resolved",
    user: USER,
    business: { id: "business-1", partner_id: null },
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
  businessQuery.single.mockResolvedValue({
    data: {
      deleted_at: "2026-08-01T00:00:00.000Z",
      deletion_scheduled_for: DELETION_DATE,
    },
    error: null,
  });
  mocks.from.mockReturnValue(businessQuery);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  });
});

describe("AccountDeletedPage workspace access", () => {
  it("loads deletion state only after workspace access resolves", async () => {
    await expect(AccountDeletedPage()).resolves.toBeDefined();
    expect(mocks.getWorkspaceAccess).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("businesses");
  });

  it.each([
    ["unauthenticated", "/login"],
    ["business_not_found", "/workspace-access"],
    ["mismatch", "/workspace-access"],
    ["unknown_host", "/workspace-access"],
    ["partner_unavailable", "/workspace-access"],
    ["lookup_failed", "/workspace-access"],
  ])("redirects %s before reading deleted-account data", async (status, path) => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status });
    mocks.workspacePageRedirectTarget.mockReturnValue(path);

    await expect(AccountDeletedPage()).rejects.toThrow(`redirect:${path}`);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
