import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requireWorkspacePageAccess: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitledContext: vi.fn(),
  loadKnowledgeGaps: vi.fn(),
  dashboard: vi.fn(),
  consoleError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspacePageAccess: mocks.requireWorkspacePageAccess,
}));

vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
  getDashboardEntitledContext: mocks.getDashboardEntitledContext,
}));

vi.mock("@/lib/knowledge-gaps/load", () => ({
  loadKnowledgeGaps: mocks.loadKnowledgeGaps,
}));

vi.mock("@/components/knowledge-gaps/KnowledgeGapsDashboard", () => ({
  default: (props: unknown) => {
    mocks.dashboard(props);
    return <div>Knowledge gaps dashboard</div>;
  },
}));

import KnowledgeGapsPage from "./page";

const BUSINESS = {
  id: "business-1",
  timezone: "America/Indiana/Indianapolis",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspacePageAccess.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.loadKnowledgeGaps.mockResolvedValue({ data: [], error: null });
  mocks.getDashboardBusinessContext.mockResolvedValue({
    status: "resolved",
    supabase: { client: "owner-client" },
    user: { id: "user-1" },
    business: BUSINESS,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KnowledgeGapsPage", () => {
  it("redirects unauthenticated owners to login without querying gaps", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "unauthenticated",
      supabase: { client: "owner-client" },
      user: null,
    });

    await expect(KnowledgeGapsPage()).rejects.toThrow("redirect:/login");
    expect(mocks.loadKnowledgeGaps).not.toHaveBeenCalled();
  });

  it("redirects unresolved business states to onboarding", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "business_not_found",
      supabase: { client: "owner-client" },
      user: { id: "user-1" },
    });

    await expect(KnowledgeGapsPage()).rejects.toThrow(
      "redirect:/onboarding"
    );
    expect(mocks.loadKnowledgeGaps).not.toHaveBeenCalled();
  });

  it("loads every status through owner RLS without an entitlement lookup", async () => {
    const gaps = [
      {
        id: "gap-open",
        status: "open",
      },
      {
        id: "gap-resolved",
        status: "resolved",
      },
    ];
    mocks.loadKnowledgeGaps.mockResolvedValue({ data: gaps, error: null });

    const markup = renderToStaticMarkup(await KnowledgeGapsPage());

    expect(markup).toContain("Knowledge gaps dashboard");
    expect(mocks.getDashboardEntitledContext).not.toHaveBeenCalled();
    expect(mocks.loadKnowledgeGaps).toHaveBeenCalledWith(
      { client: "owner-client" },
      BUSINESS.id
    );
    expect(mocks.dashboard).toHaveBeenCalledWith({
      businessId: BUSINESS.id,
      initialGaps: gaps,
      loadError: null,
      timeZone: BUSINESS.timezone,
    });
  });

  it("passes an explicit load error instead of presenting a false empty state", async () => {
    const queryError = { message: "database unavailable" };
    mocks.loadKnowledgeGaps.mockResolvedValue({
      data: [],
      error: queryError,
    });

    renderToStaticMarkup(await KnowledgeGapsPage());

    expect(mocks.consoleError).toHaveBeenCalledWith(
      `[knowledge-gaps:page] Could not load gaps for business=${BUSINESS.id}:`,
      queryError
    );
    expect(mocks.dashboard).toHaveBeenCalledWith({
      businessId: BUSINESS.id,
      initialGaps: [],
      loadError: "Knowledge gaps could not be loaded.",
      timeZone: BUSINESS.timezone,
    });
  });

  it("falls back to UTC when the business has no timezone", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { client: "owner-client" },
      user: { id: "user-1" },
      business: { ...BUSINESS, timezone: null },
    });

    renderToStaticMarkup(await KnowledgeGapsPage());

    expect(mocks.dashboard).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: "UTC" })
    );
  });
});
