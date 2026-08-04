import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDeletionPreviewSchema,
  adminAccountDeletionRequestSchema,
  adminAccountDeletionRunSchema,
} from "@/lib/account/adminDeletion.shared";
import type { AccountDeletionPreview } from "@/lib/account/deletion.server";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

// Vitest runs in Node, so expose the modal body for deterministic SSR checks.
// The component still receives and renders the real `open` value, allowing the
// test to prove that the trigger and every modal action are non-submit buttons.
vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    title?: string;
    description?: string;
    children: React.ReactNode;
  }) => (
    <section data-open={String(open)}>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  ),
}));

import { AdminAccountDeletionPanel } from "./AdminAccountDeletionPanel";

const BUSINESS_ID = "10000000-0000-4000-a045-000000000001";
const PARTNER_ID = "20000000-0000-4000-a045-000000000001";
const SCHEDULED_FOR = "2026-10-03T12:00:00.000Z";

function preview(
  overrides: Partial<AccountDeletionPreview> = {},
): AccountDeletionPreview {
  return {
    businessId: BUSINESS_ID,
    businessName: "Alpha Dental",
    billingMode: "invoiced",
    partnerId: PARTNER_ID,
    partnerSlug: "alpha-dog",
    lifecycleStage: "onboarding",
    deletionScheduledFor: null,
    subscriptionStatus: null,
    campaignStatus: null,
    assignedPhoneCount: 0,
    hasPendingPhoneNumber: false,
    provisioningJobCount: 1,
    provisioningOperationState: "idle",
    requiresLiveAcknowledgement: false,
    ...overrides,
  };
}

function renderPanel(value: AccountDeletionPreview): string {
  return renderToStaticMarkup(
    <AdminAccountDeletionPanel initialPreview={value} />,
  );
}

function source(): string {
  return readFileSync(
    new URL("./AdminAccountDeletionPanel.tsx", import.meta.url),
    "utf8",
  );
}

describe("AdminAccountDeletionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders partner and Stripe lifecycle copy conditionally", () => {
    const partnerHtml = renderPanel(preview());
    const stripeHtml = renderPanel(
      preview({
        billingMode: "stripe",
        partnerId: null,
        partnerSlug: null,
      }),
    );

    expect(partnerHtml).toContain(
      "This partner-managed account performs no Stripe work during scheduling or terminal cleanup.",
    );
    expect(partnerHtml).not.toContain("Stripe billing is paused");
    expect(stripeHtml).toContain(
      "Stripe billing is paused when deletion is scheduled and canceled during terminal cleanup.",
    );
    expect(stripeHtml).not.toContain(
      "This partner-managed account performs no Stripe work",
    );
    expect(stripeHtml).toContain("60-day reactivation window");
    expect(stripeHtml).toContain("protected or shared resources may be held");
    expect(stripeHtml).toContain(
      "removed or scrubbed only at terminal cleanup",
    );
  });

  it("requires the conditional live-resource acknowledgement only when needed", () => {
    const ordinaryHtml = renderPanel(preview());
    const liveHtml = renderPanel(
      preview({
        subscriptionStatus: "active",
        assignedPhoneCount: 1,
        requiresLiveAcknowledgement: true,
      }),
    );

    expect(ordinaryHtml).not.toContain('type="checkbox"');
    expect(ordinaryHtml).not.toContain("I acknowledge the live subscription");
    expect(liveHtml).toContain('type="checkbox"');
    expect(liveHtml).toContain("I acknowledge the live subscription");
    expect(liveHtml).toContain("Assigned phones</dt>");
    expect(liveHtml).toContain(">1</dd>");
  });

  it.each([
    [
      "active" as const,
      "Provisioning is in progress. Wait for it to finish before scheduling deletion.",
    ],
    [
      "unknown" as const,
      "Provisioning has an unresolved outcome. Reconcile it before scheduling deletion.",
    ],
  ])("blocks scheduling for %s provisioning operations", (state, copy) => {
    const html = renderPanel(preview({ provisioningOperationState: state }));
    const trigger = html.match(
      /<button(?=[^>]*disabled="")(?=[^>]*type="button")[^>]*>Schedule account deletion<\/button>/,
    );

    expect(html).toContain(copy);
    expect(trigger).not.toBeNull();
  });

  it("uses explicit non-submit semantics for every rendered action", () => {
    const html = renderPanel(preview());
    const buttonTags = html.match(/<button\b[^>]*>/g) ?? [];

    expect(buttonTags).toHaveLength(3);
    expect(buttonTags.every((tag) => tag.includes('type="button"'))).toBe(true);
    expect(html).toContain('data-open="false"');
    expect(html).toContain("Schedule account deletion");
    expect(html).toContain("Cancel");
    expect(html).toContain("Schedule deletion");
  });

  it("preserves exact confirmation names without case, whitespace, or length normalization", () => {
    const veryLongName = `  ${"N".repeat(9_000)}  `;

    for (const confirmationName of [
      "Alpha Dental",
      "alpha dental",
      " Alpha Dental ",
      veryLongName,
    ]) {
      const parsed = adminAccountDeletionRequestSchema.parse({
        confirmationName,
        acknowledgeLiveResources: false,
      });
      expect(parsed.confirmationName).toBe(confirmationName);
    }

    expect(renderPanel(preview({ businessName: veryLongName }))).toContain(
      "N".repeat(9_000),
    );

    const panelSource = source();
    expect(panelSource).toContain("confirmationName === preview.businessName");
    expect(panelSource).not.toMatch(/confirmationName\.(?:trim|toLowerCase)/);
  });

  it("sends only the exact confirmation and acknowledgement fields", () => {
    const panelSource = source();
    const body = panelSource.match(
      /body:\s*JSON\.stringify\(\{([\s\S]*?)\}\),/,
    )?.[1];

    expect(body).toBeDefined();
    expect(body?.replace(/\s/g, "")).toBe(
      "confirmationName,acknowledgeLiveResources,",
    );
    expect(body).not.toMatch(
      /preview|summary|businessId|email|messageContent|phoneNumber|stripeCustomer|telnyx/i,
    );
  });

  it("strictly accepts a safe success and wires the returned preview into local state", () => {
    const suspendedPreview = preview({
      lifecycleStage: "suspended",
      deletionScheduledFor: SCHEDULED_FOR,
    });
    const success = {
      scheduled: {
        businessId: BUSINESS_ID,
        deletedAt: "2026-08-04T12:00:00.000Z",
        deletionScheduledFor: SCHEDULED_FOR,
        stripeAction: null,
      },
      preview: suspendedPreview,
      adminEventCreated: true,
      previouslyScheduledByAdmin: false,
    };

    expect(adminAccountDeletionRunSchema.safeParse(success).success).toBe(true);
    expect(
      adminAccountDeletionRunSchema.safeParse({
        ...success,
        summary: { customerEmail: "customer@example.com" },
      }).success,
    ).toBe(false);

    const panelSource = source();
    expect(panelSource).toContain(
      "adminAccountDeletionRunSchema.safeParse(payload)",
    );
    expect(panelSource).toContain("setPreview(result.data.preview)");
    expect(panelSource).toContain("router.refresh()");
  });

  it("strictly consumes a refreshed live-ack preview and clears stale acknowledgement", () => {
    const refreshed = preview({
      subscriptionStatus: "active",
      campaignStatus: "approved",
      assignedPhoneCount: 2,
      hasPendingPhoneNumber: true,
      requiresLiveAcknowledgement: true,
    });

    expect(accountDeletionPreviewSchema.safeParse(refreshed).success).toBe(
      true,
    );

    const panelSource = source();
    expect(panelSource).toContain('payload.error === "live_ack_required"');
    expect(panelSource).toContain(
      "accountDeletionPreviewSchema.safeParse(\n          payload.preview",
    );
    expect(panelSource).toMatch(
      /if \([\s\S]*refreshed\.success[\s\S]*\) \{[\s\S]*setPreview\(refreshed\.data\);[\s\S]*setAcknowledgeLiveResources\(false\);/,
    );
    expect(panelSource).toContain("Live resources changed.");
  });

  it("does not render or accept audit, customer PII, or provider fields", () => {
    const taintedPreview = {
      ...preview(),
      customerEmail: "secret-customer@example.com",
      messageContent: "private message content",
      phoneNumber: "+13175550123",
      stripeCustomerId: "cus_secret",
      telnyxProviderId: "provider-secret",
      summary: { notes: "private audit note" },
    } as AccountDeletionPreview;
    const html = renderPanel(taintedPreview);

    for (const secret of [
      "secret-customer@example.com",
      "private message content",
      "+13175550123",
      "cus_secret",
      "provider-secret",
      "private audit note",
    ]) {
      expect(html).not.toContain(secret);
    }

    const rawTaintedPreview = {
      ...preview(),
      customerEmail: "secret-customer@example.com",
      messageContent: "private message content",
      phoneNumber: "+13175550123",
      providerId: "provider-secret",
      summary: {},
    };
    expect(
      accountDeletionPreviewSchema.safeParse(rawTaintedPreview).success,
    ).toBe(false);
  });
});
