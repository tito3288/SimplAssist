import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  from: vi.fn(),
  results: new Map<string, { data: unknown; error: null }>(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
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
) {
  return {
    id,
    name,
    website_url: `${name.toLowerCase().replaceAll(" ", "-")}.example`,
    business_type: "dentist",
    a2p_risk_review_status: "pending_review",
    a2p_risk_review_message: null,
    onboarding_registration_status: "pending",
    brand_status: "pending",
    campaign_status: "pending",
    billing_pilot: false,
    billing_comped: false,
    billing_exempt: false,
    telnyx_submission_disabled: false,
    sms_overage_opt_in: false,
    deleted_at: null,
    deletion_scheduled_for: null,
    created_at: "2026-08-04T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.results = new Map([
    ["businesses", { data: [], error: null }],
    ["subscriptions", { data: [], error: null }],
    ["billing_usage_periods", { data: [], error: null }],
  ]);
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      in: vi.fn(),
      returns: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.returns.mockImplementation(async () => mocks.results.get(table));
    return query;
  });
});

describe("AdminPage account lifecycle rendering", () => {
  it("queries lifecycle fields, labels retained rows, and excludes them from operational metrics", async () => {
    mocks.results.set("businesses", {
      data: [
        business(ACTIVE_ID, "Active Dental"),
        business(SCHEDULED_ID, "Scheduled Dental", {
          deleted_at: "2026-08-04T12:00:00.000Z",
          deletion_scheduled_for: "2026-10-03T12:00:00.000Z",
        }),
        business(TERMINAL_ID, "[deleted]", {
          deleted_at: "2026-05-01T12:00:00.000Z",
          deletion_scheduled_for: null,
        }),
      ],
      error: null,
    });
    mocks.results.set("subscriptions", {
      data: [
        { business_id: ACTIVE_ID, plan: "sms_only", status: "active" },
        {
          business_id: SCHEDULED_ID,
          plan: "sms_and_chat",
          status: "active",
        },
        { business_id: TERMINAL_ID, plan: "full", status: "active" },
      ],
      error: null,
    });
    mocks.results.set("billing_usage_periods", {
      data: [
        {
          business_id: ACTIVE_ID,
          included_sms_parts: 100,
          inbound_sms_parts: 81,
          outbound_sms_parts: 0,
          inbound_mms_events: 0,
          outbound_mms_events: 0,
          period_start: "2026-08-01T00:00:00.000Z",
        },
        {
          business_id: SCHEDULED_ID,
          included_sms_parts: 200,
          inbound_sms_parts: 190,
          outbound_sms_parts: 0,
          inbound_mms_events: 0,
          outbound_mms_events: 0,
          period_start: "2026-08-01T00:00:00.000Z",
        },
        {
          business_id: TERMINAL_ID,
          included_sms_parts: 1_000,
          inbound_sms_parts: 999,
          outbound_sms_parts: 0,
          inbound_mms_events: 0,
          outbound_mms_events: 0,
          period_start: "2026-08-01T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const html = renderToStaticMarkup(await AdminPage());

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0],
    );
    const businessQuery = mocks.from.mock.results[0]?.value;
    expect(businessQuery.select).toHaveBeenCalledWith(
      expect.stringContaining("deleted_at, deletion_scheduled_for"),
    );
    expect(html).toMatch(/A2P review queue<\/p><p[^>]*>1<\/p>/);
    expect(html).toMatch(/High usage accounts<\/p><p[^>]*>1<\/p>/);
    expect(html).toMatch(/Visible accounts<\/p><p[^>]*>3<\/p>/);
    expect(html).toContain("Deletion scheduled");
    expect(html).toContain("Terminally cleaned");
    expect(html).toContain("Read-only retained tombstone");
    expect(html).not.toContain("full · active");
    expect(html).not.toContain("999 / 1,000 SMS parts");
    expect(html).toContain(`href="/admin/${SCHEDULED_ID}"`);
    expect(html).toContain(`href="/admin/${TERMINAL_ID}"`);
  });
});
