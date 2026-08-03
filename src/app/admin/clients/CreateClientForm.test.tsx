import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicProvisioningJob } from "@/lib/admin/clientProvisioning.shared";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  stage: vi.fn(),
  take: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/app/admin/AdminSetupLinkProvider", () => ({
  useAdminSetupLinkTransfer: () => ({
    stage: mocks.stage,
    take: mocks.take,
  }),
}));

import {
  CreateClientForm,
  buildCreatePartnerClientRequest,
  parseConciergeRecoveryCallbackUrl,
  parseProvisioningRouteResponse,
  readFailedProvisioningId,
} from "./CreateClientForm";

const PROVISIONING: PublicProvisioningJob = {
  id: "40000000-0000-4000-a044-000000000001",
  email: "client@example.com",
  businessName: "Example Client",
  partnerId: "20000000-0000-4000-a044-000000000001",
  partnerName: "Example Partner",
  billingMode: "invoiced",
  partnerPlan: "sms_and_chat",
  status: "admin_setup",
  lastErrorCode: null,
  authUserId: "00000000-0000-4000-a044-000000000001",
  businessId: "10000000-0000-4000-a044-000000000001",
  setupEmailSentAt: null,
  inviteAttemptCount: 1,
  createdAt: "2026-08-03T12:00:00.000Z",
  updatedAt: "2026-08-03T12:00:00.000Z",
};

describe("CreateClientForm contract", () => {
  it("builds the strict create body with manual setup-link mode off by default", () => {
    expect(
      buildCreatePartnerClientRequest({
        email: "client@example.com",
        businessName: "Example Client",
        partnerId: "20000000-0000-4000-a044-000000000001",
        billingMode: "invoiced",
        partnerPlan: "sms_and_chat",
      }),
    ).toEqual({
      email: "client@example.com",
      businessName: "Example Client",
      partnerId: "20000000-0000-4000-a044-000000000001",
      billingMode: "invoiced",
      partnerPlan: "sms_and_chat",
      sendSetupEmailNow: false,
    });
  });

  it("accepts only an exact HTTPS concierge recovery callback URL", () => {
    const url =
      "https://partner.example.com/api/auth/callback?token_hash=secret-value&type=recovery&flow=concierge";

    expect(
      parseConciergeRecoveryCallbackUrl(url, "https://partner.example.com"),
    ).toBe(url);
  });

  it.each([
    "http://partner.example.com/api/auth/callback?token_hash=x&type=recovery&flow=concierge",
    "https://partner.example.com:444/api/auth/callback?token_hash=x&type=recovery&flow=concierge",
    "https://user:password@partner.example.com/api/auth/callback?token_hash=x&type=recovery&flow=concierge",
    "https://partner.example.com/login?token_hash=x&type=recovery&flow=concierge",
    "https://partner.example.com/api/auth/callback?type=recovery&flow=concierge",
    "https://partner.example.com/api/auth/callback?token_hash=x&type=signup&flow=concierge",
    "https://partner.example.com/api/auth/callback?token_hash=x&type=recovery&flow=ordinary",
    "https://partner.example.com/api/auth/callback?token_hash=x&type=recovery&flow=concierge&next=/admin",
    "https://partner.example.com/api/auth/callback?token_hash=x&token_hash=y&type=recovery&flow=concierge",
    "https://partner.example.com/api/auth/callback?token_hash=x&type=recovery&flow=concierge#secret",
    "not a url",
  ])("rejects unsafe setup callback %s", (url) => {
    expect(
      parseConciergeRecoveryCallbackUrl(url, "https://partner.example.com"),
    ).toBeNull();
  });

  it("rejects an otherwise valid callback on a different HTTPS origin", () => {
    expect(
      parseConciergeRecoveryCallbackUrl(
        "https://evil.example.com/api/auth/callback?token_hash=secret-value&type=recovery&flow=concierge",
        "https://partner.example.com",
      ),
    ).toBeNull();
  });

  it("accepts only a safe provisioning id from resumable failures", () => {
    expect(
      readFailedProvisioningId({
        error: "setup_email_failed",
        provisioningId: PROVISIONING.id,
      }),
    ).toBe(PROVISIONING.id);
    expect(
      readFailedProvisioningId({
        error: "setup_email_failed",
        provisioningId: "../../admin",
      }),
    ).toBeNull();
  });

  it("strictly validates create/retry response payloads", () => {
    const setupUrl =
      "https://partner.example.com/api/auth/callback?token_hash=secret-value&type=recovery&flow=concierge";

    expect(
      parseProvisioningRouteResponse({
        provisioning: PROVISIONING,
        adminSetupUrl: setupUrl,
      }),
    ).toEqual({ provisioning: PROVISIONING, adminSetupUrl: setupUrl });
    expect(
      parseProvisioningRouteResponse({
        provisioning: PROVISIONING,
        adminSetupUrl: setupUrl,
        extra: true,
      }),
    ).toBeNull();
    expect(
      parseProvisioningRouteResponse({
        provisioning: { ...PROVISIONING, status: "complete" },
      }),
    ).toBeNull();
  });

  it("renders only supplied eligible partners with email delivery off", () => {
    const html = renderToStaticMarkup(
      <CreateClientForm
        activePartners={[
          {
            id: "20000000-0000-4000-a044-000000000001",
            name: "Example Partner",
            customDomain: "partner.example.com",
          },
        ]}
      />,
    );

    expect(html).toContain("Example Partner — partner.example.com");
    expect(html).toContain('value="sms_and_chat" selected');
    expect(html).toContain('value="invoiced" selected');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="checkbox" checked');
    expect(html).not.toContain("temporary password");
  });

  it("keeps one-time links out of URLs, storage, and logs", () => {
    const source = readFileSync(
      new URL("./CreateClientForm.tsx", import.meta.url),
      "utf8",
    );

    expect(source.indexOf("setupLinkTransfer.stage")).toBeLessThan(
      source.lastIndexOf("router.push"),
    );
    expect(source).toContain("sendSetupEmailNow: input.sendSetupEmailNow ?? false");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("adminSetupUrl=");
    expect(source).not.toContain("token_hash=");
  });
});
