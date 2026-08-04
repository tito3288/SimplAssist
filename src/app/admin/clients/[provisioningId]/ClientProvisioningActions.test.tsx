import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicProvisioningJob } from "@/lib/admin/clientProvisioning.shared";

const mocks = vi.hoisted(() => ({
  take: vi.fn(),
  stage: vi.fn(),
}));

vi.mock("@/app/admin/AdminSetupLinkProvider", () => ({
  useAdminSetupLinkTransfer: () => ({
    take: mocks.take,
    stage: mocks.stage,
  }),
}));

import {
  ClientProvisioningActions,
  parseSetupEmailRouteResponse,
} from "./ClientProvisioningActions";

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

describe("ClientProvisioningActions", () => {
  it("strictly accepts the send-setup response contract", () => {
    expect(
      parseSetupEmailRouteResponse({ provisioning: PROVISIONING }),
    ).toEqual({ provisioning: PROVISIONING });
    expect(
      parseSetupEmailRouteResponse({
        provisioning: PROVISIONING,
        adminSetupUrl: "https://partner.example.com/secret",
      }),
    ).toBeNull();
    expect(
      parseSetupEmailRouteResponse({
        provisioning: { ...PROVISIONING, inviteAttemptCount: -1 },
      }),
    ).toBeNull();
  });

  it("renders both explicit fresh-token actions", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningActions
        initialProvisioning={PROVISIONING}
        expectedPartnerOrigin="https://partner.example.com"
      />,
    );

    expect(html).toContain("Admin setup link generated");
    expect(html).toContain("Generate fresh admin setup link");
    expect(html).toContain("Send fresh setup email");
    expect(html).not.toContain("token_hash");
  });

  it("disables setup actions when the assigned partner is unavailable", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningActions
        initialProvisioning={PROVISIONING}
        expectedPartnerOrigin={null}
      />,
    );

    expect(html).toContain("Generate fresh admin setup link");
    expect(html).toContain("Send fresh setup email");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain(
      "Setup-link and email actions require an active partner with a connected domain.",
    );
    expect(html).not.toContain("One-time admin setup link");
  });

  it("defensively disables setup actions for a dismissed job", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningActions
        initialProvisioning={{ ...PROVISIONING, status: "dismissed" }}
        expectedPartnerOrigin="https://partner.example.com"
      />,
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("Dismissed");
    expect(html).toContain("This job remains available for inspection");
  });

  it("consumes staged links in an idempotent mount effect", () => {
    const source = readFileSync(
      new URL("./ClientProvisioningActions.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("useEffect(() =>");
    expect(source).toContain(
      "consumedProvisioningId.current === initialProvisioning.id",
    );
    expect(source).toContain("setupLinkTransfer.take(initialProvisioning.id)");
    expect(source.indexOf("setupLinkTransfer.take")).toBeLessThan(
      source.indexOf("const safeSetupUrl = expectedPartnerOrigin"),
    );
    expect(source).toContain("const safeSetupUrl = expectedPartnerOrigin");
    expect(source).toContain(
      "if (safeSetupUrl) setAdminSetupUrl(safeSetupUrl)",
    );
    expect(source).not.toMatch(
      /useState<string \| null>\(\(\) =>[\s\S]*setupLinkTransfer\.take/,
    );
  });

  it("keeps recovery links memory-only and opens them without referrer data", () => {
    const source = readFileSync(
      new URL("./ClientProvisioningActions.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('referrerPolicy="no-referrer"');
    expect(source).toContain("JSON.stringify({ sendSetupEmailNow: false })");
    expect(source).toContain("body: JSON.stringify({})");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("router.push");
    expect(source).not.toContain("adminSetupUrl=");
  });
});
