import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrimaryGoal } from "@/types/database";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requireWorkspacePageAccess: vi.fn(async () => undefined),
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitlements: vi.fn(),
  getSmsReadinessForBusiness: vi.fn(),
  canUseFeature: vi.fn(),
  isPlanAvailable: vi.fn(),
  getFirstNameFromAuthMetadata: vi.fn(),
  shouldShowCallForwardingNudge: vi.fn(),
  dashboardOverview: vi.fn((props: unknown) => {
    void props;
    return null;
  }),
  featureStatusBanners: vi.fn((props: unknown) => {
    void props;
    return null;
  }),
  from: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspacePageAccess: mocks.requireWorkspacePageAccess,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
  getDashboardEntitlements: mocks.getDashboardEntitlements,
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getSmsReadinessForBusiness: mocks.getSmsReadinessForBusiness,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("@/lib/billing/planAvailability", () => ({
  isPlanAvailable: mocks.isPlanAvailable,
}));
vi.mock("@/lib/utils", () => ({
  getFirstNameFromAuthMetadata: mocks.getFirstNameFromAuthMetadata,
}));
vi.mock("@/components/dashboard/callForwardingNudgeEligibility", () => ({
  shouldShowCallForwardingNudge: mocks.shouldShowCallForwardingNudge,
}));
vi.mock("@/components/dashboard/DashboardOverview", () => ({
  default: mocks.dashboardOverview,
}));
vi.mock("@/components/entitlements/FeatureStatusBanners", () => ({
  FeatureStatusBanners: mocks.featureStatusBanners,
}));

import DashboardPage from "./page";

const BUSINESS_ID = "business-1";
const ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

interface FeatureStatusBannerProps {
  businessId: string;
  plan: string;
  status: string;
  pausedFeatures: string[];
}

interface DashboardOverviewProps {
  billingMode: "stripe" | "invoiced" | "comped";
  isPartnerManagedBilling: boolean;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPlanAvailable.mockReturnValue(true);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function queryThenable(result: Promise<unknown>) {
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "gte",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.then = result.then.bind(result);
  query.catch = result.catch.bind(result);
  return query;
}

function configureResolvedDashboardWithSavedGuardrails({
  partnerId = null,
  billingMode = "stripe",
  primaryGoal = null,
  calendarConnected = false,
  bookingEnabled = false,
  canUseCalendar = true,
}: {
  partnerId?: string | null;
  billingMode?: "stripe" | "invoiced" | "comped";
  primaryGoal?: PrimaryGoal | null;
  calendarConnected?: boolean;
  bookingEnabled?: boolean;
  canUseCalendar?: boolean;
} = {}) {
  const tableCalls = new Map<string, number>();

  mocks.from.mockImplementation((table: string) => {
    const call = (tableCalls.get(table) ?? 0) + 1;
    tableCalls.set(table, call);

    let result: Promise<unknown>;
    if (table === "conversations" && call <= 2) {
      result = Promise.resolve({ count: 0 });
    } else if (table === "conversations") {
      result = Promise.resolve({ data: [] });
    } else if (table === "contacts" && call === 1) {
      result = Promise.resolve({ count: 0 });
    } else if (table === "contacts") {
      result = Promise.resolve({ data: [] });
    } else if (table === "messages") {
      result = Promise.resolve({ count: 0 });
    } else if (table === "ai_settings") {
      result = Promise.resolve({
        data: {
          booking_enabled: bookingEnabled,
          booking_mode: "collect_info",
          guardrails: ["Never promise a fixed price"],
        },
      });
    } else if (table === "google_calendar_tokens") {
      result = Promise.resolve({
        data: calendarConnected ? { id: "calendar-token-1" } : null,
      });
    } else {
      result = Promise.resolve({ data: null });
    }

    return queryThenable(result);
  });

  mocks.getDashboardBusinessContext.mockResolvedValue({
    status: "resolved",
    supabase: { from: mocks.from },
    user: { id: "user-1", user_metadata: {} },
    business: {
      id: BUSINESS_ID,
      call_forwarding_enabled: false,
      call_forwarding_nudge_resolved_at: null,
      partner_id: partnerId,
      billing_mode: billingMode,
      primary_goal: primaryGoal,
    },
  });
  mocks.getDashboardEntitlements.mockResolvedValue(ENTITLEMENTS);
  mocks.getSmsReadinessForBusiness.mockResolvedValue({
    smsReady: true,
    blockReason: null,
    assignmentStatus: "assigned",
    assignmentFailureReason: null,
    phoneNumber: "+13175550123",
  });
  mocks.canUseFeature.mockImplementation(
    (_entitlements: unknown, feature: string) => {
      if (feature === "calendar") return canUseCalendar;
      return feature !== "advanced_guardrails";
    },
  );
  mocks.getFirstNameFromAuthMetadata.mockReturnValue("Owner");
  mocks.shouldShowCallForwardingNudge.mockReturnValue(false);
}

async function renderedFeatureStatusBannerProps() {
  renderToStaticMarkup(await DashboardPage());
  return mocks.featureStatusBanners.mock.calls.at(-1)?.[0] as
    | FeatureStatusBannerProps
    | undefined;
}

async function renderedDashboardOverviewProps() {
  renderToStaticMarkup(await DashboardPage());
  return mocks.dashboardOverview.mock.calls.at(-1)?.[0] as
    | DashboardOverviewProps
    | undefined;
}

describe("DashboardPage query scheduling", () => {
  it("starts entitlements, readiness, and page data once the business is known", async () => {
    const entitlements = deferred<typeof ENTITLEMENTS>();
    const preview = deferred<{ data: { content: string }[] }>();
    const tableCalls = new Map<string, number>();

    mocks.from.mockImplementation((table: string) => {
      const call = (tableCalls.get(table) ?? 0) + 1;
      tableCalls.set(table, call);

      let result: Promise<unknown>;
      if (table === "conversations" && call === 1) {
        result = Promise.resolve({ count: 4 });
      } else if (table === "conversations" && call === 2) {
        result = Promise.resolve({ count: 2 });
      } else if (table === "conversations") {
        result = Promise.resolve({
          data: [{ id: "conversation-1", contact: null }],
        });
      } else if (table === "contacts" && call === 1) {
        result = Promise.resolve({ count: 3 });
      } else if (table === "contacts") {
        result = Promise.resolve({ data: [] });
      } else if (table === "messages" && call === 1) {
        result = Promise.resolve({ count: 8 });
      } else if (table === "messages") {
        result = preview.promise;
      } else if (table === "phone_numbers") {
        result = Promise.resolve({
          data: { phone_number: "+13175550123", is_active: true },
        });
      } else {
        result = Promise.resolve({ data: null });
      }

      return queryThenable(result);
    });

    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { from: mocks.from },
      user: { id: "user-1", user_metadata: {} },
      business: {
        id: BUSINESS_ID,
        call_forwarding_enabled: false,
        call_forwarding_nudge_resolved_at: null,
        partner_id: null,
        billing_mode: "stripe",
        primary_goal: null,
      },
    });
    mocks.getDashboardEntitlements.mockReturnValue(entitlements.promise);
    mocks.getSmsReadinessForBusiness.mockResolvedValue({
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
      phoneNumber: "+13175550123",
    });
    mocks.canUseFeature.mockReturnValue(true);
    mocks.getFirstNameFromAuthMetadata.mockReturnValue("Owner");
    mocks.shouldShowCallForwardingNudge.mockReturnValue(false);

    const page = DashboardPage();

    await vi.waitFor(() => {
      expect(mocks.getDashboardEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
      expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledWith(BUSINESS_ID);
      expect(mocks.from).toHaveBeenCalledTimes(10);
    });

    entitlements.resolve(ENTITLEMENTS);
    await vi.waitFor(() => {
      expect(mocks.from).toHaveBeenCalledTimes(11);
    });

    preview.resolve({ data: [{ content: "Latest message" }] });
    await expect(page).resolves.toBeDefined();
  });
});

describe("DashboardPage partner-managed billing presentation", () => {
  it.each([
    [null, "stripe", false],
    [null, "comped", false],
    ["partner-1", "stripe", true],
    ["partner-1", "invoiced", true],
  ] as const)(
    "maps partner_id %s with %s billing to visibility %s",
    async (partnerId, billingMode, expected) => {
      configureResolvedDashboardWithSavedGuardrails({
        partnerId,
        billingMode,
      });

      const overviewProps = await renderedDashboardOverviewProps();

      expect(overviewProps).toMatchObject({
        billingMode,
        isPartnerManagedBilling: expected,
      });
    }
  );
});

describe("DashboardPage goal-aware Calendar presentation", () => {
  it.each([
    [null, true],
    ["book", true],
    ["quote", true],
    ["callback", true],
    ["signup", false],
  ] as const)(
    "renders the existing Calendar invitation for primary_goal=%s: %s",
    async (primaryGoal, shouldRenderInvitation) => {
      configureResolvedDashboardWithSavedGuardrails({ primaryGoal });

      const html = renderToStaticMarkup(await DashboardPage());
      const invitationCopy = [
        "Google Calendar not connected",
        "Connect your Google Calendar to let your AI check availability and book appointments for customers automatically.",
        "Connect Now",
      ];

      for (const copy of invitationCopy) {
        if (shouldRenderInvitation) expect(html).toContain(copy);
        else expect(html).not.toContain(copy);
      }
      expect(mocks.canUseFeature).toHaveBeenCalledWith(
        ENTITLEMENTS,
        "calendar",
      );
      expect(mocks.from).toHaveBeenCalledWith("google_calendar_tokens");
      expect(mocks.from).toHaveBeenCalledTimes(10);
    },
  );

  it.each([
    [null, true],
    ["book", true],
    ["quote", true],
    ["callback", true],
    ["signup", false],
  ] as const)(
    "keeps Calendar paused-feature wording for primary_goal=%s: %s",
    async (primaryGoal, shouldIncludeCalendarWording) => {
      configureResolvedDashboardWithSavedGuardrails({
        primaryGoal,
        calendarConnected: true,
        bookingEnabled: true,
        canUseCalendar: false,
      });

      const bannerProps = await renderedFeatureStatusBannerProps();

      expect(bannerProps?.pausedFeatures).toEqual(
        shouldIncludeCalendarWording
          ? ["Google Calendar and AI booking", "Advanced AI guardrails"]
          : ["Advanced AI guardrails"],
      );
      expect(mocks.canUseFeature).toHaveBeenCalledWith(
        ENTITLEMENTS,
        "calendar",
      );
      expect(mocks.from).toHaveBeenCalledWith("google_calendar_tokens");
      expect(mocks.from).toHaveBeenCalledTimes(10);
    },
  );
});

describe("DashboardPage paused Full Suite features", () => {
  it("suppresses saved Advanced AI guardrails while Full Suite is unavailable", async () => {
    configureResolvedDashboardWithSavedGuardrails();
    mocks.isPlanAvailable.mockReturnValue(false);

    const bannerProps = await renderedFeatureStatusBannerProps();

    expect(mocks.isPlanAvailable).toHaveBeenCalledWith("full");
    expect(bannerProps).toMatchObject({
      businessId: BUSINESS_ID,
      plan: "sms_and_chat",
      status: "active",
      pausedFeatures: [],
    });
  });

  it("restores the saved Advanced AI guardrails entry when Full Suite is available", async () => {
    configureResolvedDashboardWithSavedGuardrails();
    mocks.isPlanAvailable.mockReturnValue(true);

    const bannerProps = await renderedFeatureStatusBannerProps();

    expect(mocks.isPlanAvailable).toHaveBeenCalledWith("full");
    expect(bannerProps).toMatchObject({
      businessId: BUSINESS_ID,
      plan: "sms_and_chat",
      status: "active",
      pausedFeatures: ["Advanced AI guardrails"],
    });
  });
});
