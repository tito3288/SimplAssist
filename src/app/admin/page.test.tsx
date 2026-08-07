import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccountHealth } from "@/lib/admin/accountHealth";
import type { AdminAccountHealthRecord } from "@/lib/admin/accountHealth.server";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  loadHealthList: vi.fn(),
  loadPartnerOptions: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/admin/accountHealth.server", () => ({
  loadAdminAccountHealthList: mocks.loadHealthList,
}));
vi.mock("@/lib/admin/partnerFilterOptions.server", () => ({
  loadAdminPartnerFilterOptions: mocks.loadPartnerOptions,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import AdminPage from "./page";

const ACTIVE_ID = "10000000-0000-4000-a045-000000000001";
const SCHEDULED_ID = "10000000-0000-4000-a045-000000000002";
const TERMINAL_ID = "10000000-0000-4000-a045-000000000003";

function business(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): AdminAccountHealthRecord["business"] {
  return {
    id,
    name,
    website_url: `${name.toLowerCase().replaceAll(" ", "-")}.example`,
    business_type: "dentist",
    a2p_risk_review_status: "pending_review",
    a2p_risk_review_message: null,
    onboarding_registration_status: "submitted",
    brand_status: "pending",
    campaign_status: "pending",
    partner_id: null,
    billing_mode: "stripe",
    partner_plan: null,
    partner: null,
    billing_pilot: false,
    billing_comped: false,
    billing_exempt: false,
    telnyx_submission_disabled: false,
    sms_overage_opt_in: false,
    deleted_at: null,
    deletion_scheduled_for: null,
    created_at: "2026-08-04T12:00:00.000Z",
    ...overrides,
  } as AdminAccountHealthRecord["business"];
}

function health(
  businessId: string,
  lifecycle: AdminAccountHealth["lifecycle"]["state"] = "live",
  overrides: Partial<AdminAccountHealth> = {},
): AdminAccountHealth {
  return {
    businessId,
    operations: {
      state: "active",
      suspendedAt: null,
      services: {
        aiReplies: { state: "active", pausedAt: null },
        texting: { state: "active", pausedAt: null },
        bookings: { state: "active", pausedAt: null },
      },
    },
    lifecycle: {
      state: lifecycle,
      onboardingCompleted: lifecycle !== "onboarding",
      onboardingStep: lifecycle === "onboarding" ? "carrier_review" : "complete",
      onboardingStepLabel:
        lifecycle === "onboarding" ? "Carrier Review" : "Complete",
      deletionScheduledFor:
        lifecycle === "pending_deletion"
          ? "2026-10-03T12:00:00.000Z"
          : null,
    },
    billing: {
      mode: "stripe",
      subscriptionPresent: true,
      plan: "sms_only",
      status: "active",
      source: "subscription",
      state: "active",
      pastDue: false,
      cancelAtPeriodEnd: false,
    },
    phone: {
      state: "ready",
      activeCount: 1,
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
    },
    registration: {
      state: "pending",
      onboardingStatus: "submitted",
      riskReviewStatus: "pending_review",
      brandStatus: "pending",
      campaignStatus: "pending",
    },
    calendar: { connected: false },
    ai: {
      state: "setup_pending",
      configured: true,
      sms: "operational",
      webChat: "disabled",
      operationalChannels: ["sms"],
      planLimitedChannels: [],
    },
    booking: { mode: null, state: "disabled" },
    failedSetup: { failed: false, reasons: [] },
    lastActivityAt: "2026-08-04T11:45:00.000Z",
    ...overrides,
  };
}

function record(args: {
  business: AdminAccountHealthRecord["business"];
  subscription?: AdminAccountHealthRecord["subscription"];
  usage?: AdminAccountHealthRecord["usage"];
  health?: AdminAccountHealth | null;
}): AdminAccountHealthRecord {
  return {
    business: args.business,
    subscription: args.subscription,
    usage: args.usage,
    health:
      args.health === undefined
        ? health(args.business.id)
        : args.health,
  };
}

function accountRecords(count: number): AdminAccountHealthRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    const id = `30000000-0000-4000-a045-${String(ordinal).padStart(12, "0")}`;

    return record({
      business: business(id, `Business ${String(ordinal).padStart(2, "0")}`),
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.loadHealthList.mockResolvedValue([]);
  mocks.loadPartnerOptions.mockResolvedValue([]);
});

describe("AdminPage account lifecycle and health rendering", () => {
  it("authenticates before one batch read and preserves lifecycle and metrics", async () => {
    mocks.loadHealthList.mockResolvedValue([
      record({
        business: business(ACTIVE_ID, "Active Dental"),
        subscription: {
          business_id: ACTIVE_ID,
          plan: "sms_only",
          status: "active",
        },
        usage: {
          business_id: ACTIVE_ID,
          included_sms_parts: 100,
          inbound_sms_parts: 81,
          outbound_sms_parts: 0,
          inbound_mms_events: 0,
          outbound_mms_events: 0,
          period_start: "2026-08-01T00:00:00.000Z",
        },
      }),
      record({
        business: business(SCHEDULED_ID, "Scheduled Dental", {
          deleted_at: "2026-08-04T12:00:00.000Z",
          deletion_scheduled_for: "2026-10-03T12:00:00.000Z",
        }),
        subscription: {
          business_id: SCHEDULED_ID,
          plan: "sms_only",
          status: "active",
        },
        health: health(SCHEDULED_ID, "pending_deletion"),
      }),
      record({
        business: business(TERMINAL_ID, "[deleted]", {
          deleted_at: "2026-05-01T12:00:00.000Z",
          deletion_scheduled_for: null,
        }),
        health: null,
      }),
    ]);

    const html = renderToStaticMarkup(await AdminPage({}));

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.loadHealthList).toHaveBeenCalledOnce();
    expect(mocks.loadPartnerOptions).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadHealthList.mock.invocationCallOrder[0],
    );
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadPartnerOptions.mock.invocationCallOrder[0],
    );
    expect(html).toContain(">Operations overview</h1>");
    expect(html).not.toContain(">Admin</h1>");
    expect(html).not.toContain("Admin workspace");
    expect(html).toMatch(/A2P review queue<\/p><p[^>]*>1<\/p>/);
    expect(html).toMatch(/High usage accounts<\/p><p[^>]*>1<\/p>/);
    expect(html).toMatch(/Visible accounts<\/p><p[^>]*>3<\/p>/);
    expect(html).toContain("Find accounts");
    expect(html).toContain("3</span> visible accounts");
    expect(html).toContain("Deletion scheduled");
    expect(html).toContain("Lifecycle: pending deletion");
    expect(html).toContain("Terminally cleaned");
    expect(html).toContain("Read-only retained tombstone");
    expect(html.match(/aria-label="Account health"/g)).toHaveLength(3);
    expect(html).toContain(`href="/admin/${SCHEDULED_ID}"`);
    expect(html).toContain(`href="/admin/${TERMINAL_ID}"`);
  });

  it("surfaces account suspension and only independently stored service pauses on the account list", async () => {
    mocks.loadHealthList.mockResolvedValue([
      record({
        business: business(ACTIVE_ID, "Suspended Dental"),
        subscription: {
          business_id: ACTIVE_ID,
          plan: "sms_only",
          status: "active",
        },
        health: health(ACTIVE_ID, "live", {
          operations: {
            state: "suspended",
            suspendedAt: "2026-08-04T11:30:00.000Z",
            services: {
              aiReplies: {
                state: "paused",
                pausedAt: "2026-08-03T09:15:00.000Z",
              },
              texting: { state: "paused", pausedAt: null },
              bookings: { state: "paused", pausedAt: null },
            },
          },
        }),
      }),
    ]);

    const html = renderToStaticMarkup(await AdminPage({}));

    expect(html).toContain("Suspended Dental");
    expect(html).toContain("Account suspended");
    expect(html).toContain("AI replies paused");
    expect(html).not.toContain("Texting paused");
    expect(html).not.toContain("Bookings paused");
    expect(html.indexOf("Lifecycle: live")).toBeLessThan(
      html.indexOf("Account suspended"),
    );
  });
});

describe("AdminPage billing presentation", () => {
  it("preserves the existing Stripe billing, usage, and margin presentation", async () => {
    mocks.loadHealthList.mockResolvedValue([
      record({
        business: business(ACTIVE_ID, "Stripe Dental"),
        subscription: {
          business_id: ACTIVE_ID,
          plan: "sms_only",
          status: "active",
        },
        usage: {
          business_id: ACTIVE_ID,
          included_sms_parts: 500,
          inbound_sms_parts: 40,
          outbound_sms_parts: 60,
          inbound_mms_events: 0,
          outbound_mms_events: 0,
          period_start: "2026-08-01T00:00:00.000Z",
        },
      }),
    ]);

    const html = renderToStaticMarkup(await AdminPage({}));

    expect(html).toContain("sms_only · active");
    expect(html).toContain("100 / 500 SMS parts (20%)");
    expect(html).toContain("Rough margin: $14.00");
  });

  it.each([
    ["invoiced", "sms_and_chat", "Growth / SMS + Web Chat"],
    ["comped", "full", "Pro / Full Suite"],
  ] as const)(
    "renders partner %s billing without a fabricated margin",
    async (billingMode, partnerPlan, planLabel) => {
      const partnerBusiness = business(ACTIVE_ID, "Partner Dental", {
        partner_id: "20000000-0000-4000-a045-000000000001",
        billing_mode: billingMode,
        partner_plan: partnerPlan,
        partner: { name: "Alpha Dog Agency", slug: "alpha-dog" },
      });
      mocks.loadHealthList.mockResolvedValue([
        record({
          business: partnerBusiness,
          health: health(ACTIVE_ID, "live", {
            billing: {
              mode: billingMode,
              subscriptionPresent: false,
              plan: partnerPlan,
              status: "partner_billing",
              source: "partner_billing",
              state: "active",
              pastDue: false,
              cancelAtPeriodEnd: false,
            },
          }),
        }),
      ]);

      const html = renderToStaticMarkup(await AdminPage({}));

      expect(html).toContain(
        `Alpha Dog Agency · ${planLabel} · ${billingMode}`,
      );
      expect(html).not.toContain("no plan · no subscription");
      expect(html).not.toContain("Rough margin:");
    },
  );

  it("labels malformed partner billing instead of inventing a plan", async () => {
    mocks.loadHealthList.mockResolvedValue([
      record({
        business: business(ACTIVE_ID, "Broken Partner Dental", {
          partner_id: "20000000-0000-4000-a045-000000000001",
          billing_mode: "invoiced",
          partner_plan: null,
          partner: null,
        }),
        health: health(ACTIVE_ID, "live", {
          billing: {
            mode: "invoiced",
            subscriptionPresent: false,
            plan: null,
            status: null,
            source: null,
            state: "unknown",
            pastDue: false,
            cancelAtPeriodEnd: false,
          },
        }),
      }),
    ]);

    const html = renderToStaticMarkup(await AdminPage({}));

    expect(html).toContain("Partner billing configuration invalid");
    expect(html).not.toContain("no plan · no subscription");
    expect(html).not.toContain("Rough margin:");
  });

  it("surfaces a batch health failure instead of rendering fabricated account data", async () => {
    mocks.loadHealthList.mockRejectedValue(
      new Error("Could not load admin account health."),
    );

    await expect(AdminPage({})).rejects.toThrow(
      "Could not load admin account health.",
    );
  });

  it("surfaces a partner-choice failure instead of rendering an incomplete filter", async () => {
    mocks.loadPartnerOptions.mockRejectedValue(
      new Error("Could not load admin partner filter options."),
    );

    await expect(AdminPage({})).rejects.toThrow(
      "Could not load admin partner filter options.",
    );
  });
});

describe("AdminPage server-side filters", () => {
  it("passes every valid filter to the batch RPC and preserves the GET form state", async () => {
    const partnerId = "20000000-0000-4000-a045-000000000001";
    mocks.loadPartnerOptions.mockResolvedValue([
      { id: partnerId, name: "Retired Agency" },
    ]);

    const html = renderToStaticMarkup(
      await AdminPage({
        searchParams: {
          lifecycle: "suspended",
          ownership: "partner",
          partner: partnerId,
          plan: "full",
          q: "  River City Dental  ",
        },
      }),
    );

    expect(mocks.loadHealthList).toHaveBeenCalledOnce();
    expect(mocks.loadHealthList).toHaveBeenCalledWith({
      lifecycle: "suspended",
      ownership: "partner",
      partnerId,
      plan: "full",
      query: "River City Dental",
    });
    expect(mocks.loadPartnerOptions).toHaveBeenCalledOnce();
    expect(html).toContain('action="/admin" method="get"');
    expect(html).toMatch(
      /<option value="suspended" selected="">Suspended<\/option>/,
    );
    expect(html).toMatch(
      new RegExp(
        `<option value="${partnerId}" selected="">Retired Agency</option>`,
      ),
    );
    expect(html).toContain('value="River City Dental"');
    expect(html).toContain("No accounts match these filters.");
  });

  it("normalizes repeated and invalid values independently before the RPC", async () => {
    await AdminPage({
      searchParams: {
        lifecycle: ["live", "onboarding"],
        ownership: "direct",
        partner: "20000000-0000-4000-a045-000000000001",
        plan: "enterprise",
        q: "  Dental  ",
      },
    });

    expect(mocks.loadHealthList).toHaveBeenCalledWith({
      lifecycle: null,
      ownership: "direct",
      partnerId: null,
      plan: null,
      query: "Dental",
    });
  });

  it("does not start either service-role read when admin authentication fails", async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(AdminPage({})).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.loadHealthList).not.toHaveBeenCalled();
    expect(mocks.loadPartnerOptions).not.toHaveBeenCalled();
  });
});

describe("AdminPage account pagination", () => {
  it("shows only the first 10 matching accounts and links to the next page", async () => {
    mocks.loadHealthList.mockResolvedValue(accountRecords(12));

    const html = renderToStaticMarkup(await AdminPage({}));

    expect(html).toContain(">Business 01</p>");
    expect(html).toContain(">Business 10</p>");
    expect(html).not.toContain(">Business 11</p>");
    expect(html).not.toContain(">Business 12</p>");
    expect(html.match(/aria-label="Account health"/g)).toHaveLength(10);
    expect(html).toContain('aria-label="Accounts pagination"');
    expect(html).toContain("Showing 1–10 of 12");
    expect(html).toContain('aria-disabled="true">Previous</span>');
    expect(html).toContain('href="/admin?page=2"');
  });

  it("preserves account filters while paging through the matching results", async () => {
    const partnerId = "20000000-0000-4000-a045-000000000001";
    mocks.loadHealthList.mockResolvedValue(accountRecords(23));

    const html = renderToStaticMarkup(
      await AdminPage({
        searchParams: {
          lifecycle: "live",
          ownership: "partner",
          partner: partnerId,
          plan: "full",
          q: "  River City Dental  ",
          page: "2",
        },
      }),
    );

    expect(html).not.toContain(">Business 10</p>");
    expect(html).toContain(">Business 11</p>");
    expect(html).toContain(">Business 20</p>");
    expect(html).not.toContain(">Business 21</p>");
    expect(html).toContain("Showing 11–20 of 23");
    expect(html).toContain(
      `href="/admin?lifecycle=live&amp;ownership=partner&amp;partner=${partnerId}&amp;plan=full&amp;q=River+City+Dental"`,
    );
    expect(html).toContain(
      `href="/admin?lifecycle=live&amp;ownership=partner&amp;partner=${partnerId}&amp;plan=full&amp;q=River+City+Dental&amp;page=3"`,
    );
  });

  it("clamps an out-of-range page to the final page", async () => {
    mocks.loadHealthList.mockResolvedValue(accountRecords(23));

    const html = renderToStaticMarkup(
      await AdminPage({ searchParams: { page: "99" } }),
    );

    expect(html).not.toContain(">Business 20</p>");
    expect(html).toContain(">Business 21</p>");
    expect(html).toContain(">Business 23</p>");
    expect(html).toContain("Showing 21–23 of 23");
    expect(html).toContain('href="/admin?page=2"');
    expect(html).toContain('aria-disabled="true">Next</span>');
  });

  it("does not show pagination controls when 10 or fewer accounts match", async () => {
    mocks.loadHealthList.mockResolvedValue(accountRecords(10));

    const html = renderToStaticMarkup(await AdminPage({}));

    expect(html.match(/aria-label="Account health"/g)).toHaveLength(10);
    expect(html).not.toContain('aria-label="Accounts pagination"');
  });
});
