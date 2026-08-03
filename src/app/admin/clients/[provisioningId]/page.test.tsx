import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
  requireAdminUser: vi.fn(),
  from: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  results: new Map<string, { data: unknown; error: { message: string } | null }>(),
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
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
vi.mock("./ClientProvisioningActions", () => ({
  ClientProvisioningActions: ({
    initialProvisioning,
    expectedPartnerOrigin,
  }: {
    initialProvisioning: { status: string };
    expectedPartnerOrigin: string;
  }) => (
    <div>
      Actions:{initialProvisioning.status}:{expectedPartnerOrigin}
    </div>
  ),
}));

import PartnerClientProvisioningDetailPage from "./page";
import { parseProvisioningDetailRows } from "./provisioningDetail";

const JOB_ID = "40000000-0000-4000-a044-000000000001";
const PARTNER_ID = "20000000-0000-4000-a044-000000000001";

function storedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    email: "client@example.com",
    requested_business_name: "Example Client",
    partner_id: PARTNER_ID,
    billing_mode: "invoiced",
    partner_plan: "sms_and_chat",
    auth_user_id: "00000000-0000-4000-a044-000000000001",
    business_id: "10000000-0000-4000-a044-000000000001",
    status: "admin_setup",
    last_error_code: null,
    setup_email_sent_at: null,
    invite_attempt_count: 1,
    created_at: "2026-08-03T12:00:00.000Z",
    updated_at: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

function storedPartner(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_ID,
    name: "Example Partner",
    custom_domain: "partner.example.com",
    status: "active",
    domain_status: "connected",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.results = new Map([
    ["partner_client_provisioning_jobs", { data: storedJob(), error: null }],
    ["partners", { data: storedPartner(), error: null }],
  ]);
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      not: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.maybeSingle.mockImplementation(async () => mocks.results.get(table));
    return query;
  });
});

describe("PartnerClientProvisioningDetailPage", () => {
  it("authorizes, disables caching, validates both reads, and binds actions to the partner origin", async () => {
    const html = renderToStaticMarkup(
      await PartnerClientProvisioningDetailPage({
        params: { provisioningId: JOB_ID },
      }),
    );

    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0],
    );
    expect(mocks.from).toHaveBeenNthCalledWith(
      1,
      "partner_client_provisioning_jobs",
    );
    expect(mocks.from).toHaveBeenNthCalledWith(2, "partners");
    const partnerQuery = mocks.from.mock.results[1]?.value;
    expect(partnerQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(partnerQuery.eq).toHaveBeenCalledWith(
      "domain_status",
      "connected",
    );
    expect(partnerQuery.not).toHaveBeenCalledWith(
      "custom_domain",
      "is",
      null,
    );
    expect(html).toContain("Example Client");
    expect(html).toContain("Example Partner");
    expect(html).toContain(
      "Actions:admin_setup:https://partner.example.com",
    );
    expect(html).not.toContain("token_hash");
  });

  it("rejects malformed stored state at the read boundary", () => {
    expect(
      parseProvisioningDetailRows(
        storedJob({ email: "Client@example.com" }),
        storedPartner(),
      ),
    ).toBeNull();
    expect(
      parseProvisioningDetailRows(storedJob(), storedPartner({
        custom_domain: "https://evil.example.com",
      })),
    ).toBeNull();
    expect(
      parseProvisioningDetailRows(storedJob({ status: "complete" }), storedPartner()),
    ).toBeNull();
  });

  it("authorizes before rejecting a malformed route id without database reads", async () => {
    await expect(
      PartnerClientProvisioningDetailPage({
        params: { provisioningId: "../../admin" },
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
