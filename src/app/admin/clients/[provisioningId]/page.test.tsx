import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProvisioningRecord } from "@/lib/admin/clientProvisioning.shared";

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
  requireAdminUser: vi.fn(),
  loadRecord: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/admin/clientProvisioningLifecycle.server", () => ({
  loadAdminProvisioningRecord: mocks.loadRecord,
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
    expectedPartnerOrigin: string | null;
  }) => (
    <div>
      Setup actions:{initialProvisioning.status}:
      {expectedPartnerOrigin ?? "unavailable"}
    </div>
  ),
}));
vi.mock("./ClientProvisioningLifecycleActions", () => ({
  ClientProvisioningLifecycleActions: ({
    provisioningId,
    dismissalState,
    businessId,
  }: {
    provisioningId: string;
    dismissalState: string;
    businessId: string | null;
  }) => (
    <div>
      Lifecycle actions:{provisioningId}:{dismissalState}:
      {businessId ?? "no-business"}
    </div>
  ),
}));

import PartnerClientProvisioningDetailPage from "./page";

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
      status: "admin_setup",
      lastErrorCode: null,
      authUserId: USER_ID,
      businessId: BUSINESS_ID,
      setupEmailSentAt: null,
      inviteAttemptCount: 1,
      createdAt: "2026-08-03T12:00:00.000Z",
      updatedAt: "2026-08-04T12:00:00.000Z",
    },
    accountBusinessId: BUSINESS_ID,
    partnerAvailability: "active_connected",
    partnerOrigin: "https://partner.example.com",
    operationState: "idle",
    dismissalState: "has_resources",
    dismissedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.loadRecord.mockResolvedValue(record());
});

describe("PartnerClientProvisioningDetailPage", () => {
  it("authorizes, disables caching, and binds active setup and lifecycle actions", async () => {
    const html = renderToStaticMarkup(
      await PartnerClientProvisioningDetailPage({
        params: { provisioningId: JOB_ID },
      }),
    );

    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadRecord.mock.invocationCallOrder[0],
    );
    expect(mocks.loadRecord).toHaveBeenCalledWith(JOB_ID);
    expect(html).toContain('href="/admin/clients"');
    expect(html).toContain('href="/admin/clients/new"');
    expect(html).toContain("Example Client");
    expect(html).toContain("Example Partner");
    expect(html).toContain("Partner active/connected");
    expect(html).toContain(
      "Setup actions:admin_setup:https://partner.example.com",
    );
    expect(html).toContain(
      `Lifecycle actions:${JOB_ID}:has_resources:${BUSINESS_ID}`,
    );
    expect(html).toContain(`href="/admin/${BUSINESS_ID}"`);
    expect(html).toContain("Open prepared business");
    expect(html).not.toContain(USER_ID);
    expect(html).not.toContain("token_hash");
  });

  it.each([
    ["inactive", "Partner inactive"],
    ["domain_pending", "Partner domain pending"],
    ["unavailable", "Partner unavailable"],
  ] as const)(
    "keeps a %s partner job inspectable but passes no setup origin",
    async (partnerAvailability, label) => {
      mocks.loadRecord.mockResolvedValue(
        record({ partnerAvailability, partnerOrigin: null }),
      );

      const html = renderToStaticMarkup(
        await PartnerClientProvisioningDetailPage({
          params: { provisioningId: JOB_ID },
        }),
      );

      expect(html).toContain(label);
      expect(html).toContain("Setup actions:admin_setup:unavailable");
      expect(html).toContain(
        `Lifecycle actions:${JOB_ID}:has_resources:${BUSINESS_ID}`,
      );
      expect(html).toContain("Example Client");
    },
  );

  it("links an inactive Auth-only partial job to its trigger-created business", async () => {
    mocks.loadRecord.mockResolvedValue(
      record({
        provisioning: {
          ...record().provisioning,
          businessId: null,
        },
        accountBusinessId: BUSINESS_ID,
        partnerAvailability: "inactive",
        partnerOrigin: null,
      }),
    );

    const html = renderToStaticMarkup(
      await PartnerClientProvisioningDetailPage({
        params: { provisioningId: JOB_ID },
      }),
    );

    expect(html).toContain("Open Auth account business");
    expect(html).toContain(`href="/admin/${BUSINESS_ID}"`);
    expect(html).toContain(
      `Lifecycle actions:${JOB_ID}:has_resources:${BUSINESS_ID}`,
    );
    expect(html).toContain("Setup actions:admin_setup:unavailable");
  });

  it("renders dismissed history with restore lifecycle action and no setup actions", async () => {
    mocks.loadRecord.mockResolvedValue(
      record({
        provisioning: {
          ...record().provisioning,
          status: "dismissed",
          authUserId: null,
          businessId: null,
          lastErrorCode: "email_in_use",
        },
        accountBusinessId: null,
        dismissalState: "restore",
        dismissedAt: "2026-08-04T12:30:00.000Z",
      }),
    );

    const html = renderToStaticMarkup(
      await PartnerClientProvisioningDetailPage({
        params: { provisioningId: JOB_ID },
      }),
    );

    expect(html).toContain("Dismissed");
    expect(html).toContain("Last error code");
    expect(html).toContain("email_in_use");
    expect(html).toContain(`Lifecycle actions:${JOB_ID}:restore:no-business`);
    expect(html).not.toContain("Setup actions:");
    expect(html).not.toContain("Generate an admin-held recovery link");
  });

  it("remounts lifecycle controls when a refresh changes their dismissal state", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      "key={`${provisioning.id}:${record.dismissalState}`}",
    );
  });

  it("authorizes before rejecting a malformed route id without loading a record", async () => {
    await expect(
      PartnerClientProvisioningDetailPage({
        params: { provisioningId: "../../admin" },
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.loadRecord).not.toHaveBeenCalled();
  });

  it("fails closed when the service rejects a stored record", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.loadRecord.mockResolvedValue(null);

    await expect(
      PartnerClientProvisioningDetailPage({
        params: { provisioningId: JOB_ID },
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
