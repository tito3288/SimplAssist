import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProvisioningRecord } from "@/lib/admin/clientProvisioning.shared";

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
  requireAdminUser: vi.fn(),
  listRecords: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/admin/clientProvisioningLifecycle.server", () => ({
  listAdminProvisioningRecords: mocks.listRecords,
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

import AdminClientsPage from "./page";

const JOB_ID = "40000000-0000-4000-a045-000000000001";
const PARTNER_ID = "20000000-0000-4000-a045-000000000001";
const USER_ID = "00000000-0000-4000-a045-000000000001";
const BUSINESS_ID = "10000000-0000-4000-a045-000000000001";

function record(
  overrides: Partial<AdminProvisioningRecord> = {},
): AdminProvisioningRecord {
  return {
    provisioning: {
      id: JOB_ID,
      email: "client@example.com",
      businessName: "Example Client",
      partnerId: PARTNER_ID,
      partnerName: "Example Partner",
      billingMode: "invoiced",
      partnerPlan: "sms_and_chat",
      status: "needs_attention",
      lastErrorCode: "email_in_use",
      authUserId: null,
      businessId: null,
      setupEmailSentAt: null,
      inviteAttemptCount: 1,
      createdAt: "2026-08-03T12:00:00.000Z",
      updatedAt: "2026-08-04T12:00:00.000Z",
    },
    accountBusinessId: null,
    partnerAvailability: "active_connected",
    partnerOrigin: "https://partner.example.com",
    operationState: "idle",
    dismissalState: "dismissible",
    dismissedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.listRecords.mockResolvedValue({
    records: [],
    invalidRecordCount: 0,
  });
});

describe("AdminClientsPage", () => {
  it("authorizes before loading the default non-dismissed queue", async () => {
    const html = renderToStaticMarkup(await AdminClientsPage({}));

    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listRecords.mock.invocationCallOrder[0],
    );
    expect(mocks.listRecords).toHaveBeenCalledWith("current");
    expect(html).toContain("No current provisioning jobs.");
    expect(html).toContain('href="/admin/clients/new"');
    expect(html).toContain("Create client");
    expect(html).toContain('href="/admin/clients?view=dismissed"');
  });

  it("selects dismissed history only for one exact dismissed view value", async () => {
    await AdminClientsPage({ searchParams: { view: "dismissed" } });
    expect(mocks.listRecords).toHaveBeenLastCalledWith("dismissed");

    await AdminClientsPage({ searchParams: { view: "Dismissed" } });
    expect(mocks.listRecords).toHaveBeenLastCalledWith("current");

    await AdminClientsPage({
      searchParams: { view: ["dismissed", "current"] },
    });
    expect(mocks.listRecords).toHaveBeenLastCalledWith("current");
  });

  it("renders safe status, partner, resource, error, and business-link fields", async () => {
    mocks.listRecords.mockResolvedValue({
      records: [
        record({
          provisioning: {
            ...record().provisioning,
            authUserId: USER_ID,
            businessId: BUSINESS_ID,
          },
          accountBusinessId: BUSINESS_ID,
        }),
        record({
          provisioning: {
            ...record().provisioning,
            id: "40000000-0000-4000-a045-000000000002",
            email: "waiting@example.com",
            businessName: "Waiting Client",
            authUserId: USER_ID,
            businessId: null,
            lastErrorCode: "unknown_error",
          },
          accountBusinessId: BUSINESS_ID,
          partnerAvailability: "domain_pending",
          partnerOrigin: null,
          dismissalState: "has_resources",
        }),
      ],
      invalidRecordCount: 0,
    });

    const html = renderToStaticMarkup(await AdminClientsPage({}));

    expect(html).toContain("Example Client");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Partner active/connected");
    expect(html).toContain("Auth created");
    expect(html).toContain("Business prepared");
    expect(html).toContain(`href="/admin/${BUSINESS_ID}"`);
    expect(html).toContain(`href="/admin/clients/${JOB_ID}"`);
    expect(html).toContain("Last error: email_in_use");
    expect(html).toContain("Waiting Client");
    expect(html).toContain("Partner domain pending");
    expect(html.match(/Auth created/g)).toHaveLength(2);
    expect(html).toContain("Account business found");
    expect(html).toContain(`href="/admin/${BUSINESS_ID}"`);
    expect(html).toContain("Last error: unknown_error");
  });

  it("keeps inactive jobs inspectable without rendering unmodeled secret fields", async () => {
    const unsafeRecord = {
      ...record({
        partnerAvailability: "inactive",
        partnerOrigin: null,
      }),
      operation_token: "opaque-operation-secret",
      setup_url: "https://partner.example.com/?token_hash=recovery-secret",
      provider_error: "provider-secret-detail",
    } as AdminProvisioningRecord;
    mocks.listRecords.mockResolvedValue({
      records: [unsafeRecord],
      invalidRecordCount: 0,
    });

    const html = renderToStaticMarkup(await AdminClientsPage({}));

    expect(html).toContain("Partner inactive");
    expect(html).toContain(`href="/admin/clients/${JOB_ID}"`);
    expect(html).not.toContain("opaque-operation-secret");
    expect(html).not.toContain("recovery-secret");
    expect(html).not.toContain("provider-secret-detail");
    expect(html).not.toContain("token_hash");
  });
});
