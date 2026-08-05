import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOperationalControlSnapshot } from "@/lib/admin/accountServiceControls.shared";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

// Node-based Vitest does not open the production portal. Expose the single
// modal body while retaining its real open state for deterministic copy and
// non-submit-button checks.
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
    <section data-modal-open={String(open)}>
      {title ? <h2>{title}</h2> : null}
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}));

import { AdminAccountServiceControls } from "./AdminAccountServiceControls";

const BUSINESS_ID = "10000000-0000-4000-a048-000000000001";

type InitialControls = Omit<AdminOperationalControlSnapshot, "businessId">;

function controls(
  overrides: Partial<InitialControls> = {},
): InitialControls {
  return {
    operationsSuspendedAt: null,
    aiRepliesPausedAt: null,
    textingPausedAt: null,
    bookingsPausedAt: null,
    ...overrides,
  };
}

function render(
  initialControls: InitialControls = controls(),
  billingMode: "stripe" | "invoiced" | "comped" = "stripe",
): string {
  return renderToStaticMarkup(
    <AdminAccountServiceControls
      businessId={BUSINESS_ID}
      billingMode={billingMode}
      initialControls={initialControls}
    />,
  );
}

function source(): string {
  return readFileSync(
    new URL("./AdminAccountServiceControls.tsx", import.meta.url),
    "utf8",
  );
}

describe("AdminAccountServiceControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the global and all three independent active states with one action per row", () => {
    const html = render();

    expect(html).toContain("Service controls");
    expect(html).toContain(
      "preserving dashboard access and account data",
    );
    expect(html).toContain("Account operations");
    expect(html).toContain("AI replies");
    expect(html).toContain("Texting");
    expect(html).toContain("Bookings");
    expect(html).toContain("Suspend account");
    expect(html).toContain("Pause AI replies");
    expect(html).toContain("Pause texting");
    expect(html).toContain("Pause bookings");
    expect(html.match(/Independently active\./g)).toHaveLength(3);
    expect(html).toContain('data-modal-open="false"');

    const buttonTags = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttonTags).toHaveLength(6);
    expect(buttonTags.every((tag) => tag.includes('type="button"'))).toBe(true);
  });

  it("keeps independent timestamps distinct while global suspension makes other services effectively paused", () => {
    const html = render(
      controls({
        operationsSuspendedAt: "2026-08-04T12:00:00.000Z",
        aiRepliesPausedAt: "2026-08-03T11:00:00.000Z",
      }),
    );

    expect(html).toContain("Reactivate account");
    expect(html).toContain("Suspended Aug 4, 2026, 12:00 PM UTC");
    expect(html).toContain("Resume AI replies");
    expect(html).toContain(
      "Independently paused Aug 3, 2026, 11:00 AM UTC",
    );
    expect(
      html.match(
        /Independently active\. Effectively paused by account suspension\./g,
      ),
    ).toHaveLength(2);
    expect(html).not.toContain(
      "Independently active. Independently active;",
    );
    expect(html).toContain("Pause texting");
    expect(html).toContain("Pause bookings");
  });

  it("renders each independently paused service from its own stored timestamp", () => {
    const html = render(
      controls({
        aiRepliesPausedAt: "2026-08-01T12:00:00.000Z",
        textingPausedAt: "2026-08-02T12:00:00.000Z",
        bookingsPausedAt: "2026-08-03T12:00:00.000Z",
      }),
    );

    expect(html).toContain("Resume AI replies");
    expect(html).toContain("Resume texting");
    expect(html).toContain("Resume bookings");
    expect(html.match(/Independently paused/g)).toHaveLength(3);
    expect(html).not.toContain("effectively paused by account suspension");
  });

  it("uses one confirmation modal, exact billing-mode copy, and durable-reason safeguards", () => {
    const componentSource = source();

    expect(componentSource.match(/<Modal\b/g)).toHaveLength(1);
    expect(componentSource).toContain('billingMode === "stripe"');
    expect(componentSource).toContain(
      "Suspension does not pause your Stripe subscription; billing continues.",
    );
    expect(componentSource).toContain(
      "Billing remains managed by your partner; SimplAssist has not changed it.",
    );
    expect(componentSource).not.toContain("partnerId");
    expect(componentSource).toContain(
      "Reactivation does not resume independently paused services.",
    );
    expect(componentSource).toMatch(
      /customer\s+contact details, message content, or provider data/,
    );
    expect(componentSource).not.toContain("maxLength={500}");
    expect(componentSource).toContain(
      "const characterCount = Array.from(normalizedReason).length",
    );
    expect(componentSource).toContain("characterCount >= 8");
    expect(componentSource).toContain("characterCount <= 500");
    expect(componentSource).not.toContain("normalizedReason.length");
    expect(componentSource).toContain("CONTROL_CHARACTERS.test(rawReason)");
  });

  it("posts only the typed action request and strictly adopts the matching response snapshot", () => {
    const componentSource = source();

    expect(componentSource).toContain(
      "const request = buildRequest(pendingAction, normalizedReason)",
    );
    expect(componentSource).toContain("body: JSON.stringify(request)");
    expect(componentSource).not.toMatch(/actor(?:AdminUserId|_admin_user_id)\s*:/);
    expect(componentSource).toContain(
      "adminAccountServiceControlResponseSchema.safeParse(payload)",
    );
    expect(componentSource).toContain(
      "parsed.data.controls.businessId !== businessId",
    );
    expect(componentSource).toContain("setControls(result.controls)");
    expect(componentSource).toContain("result.changed");
    expect(componentSource).toContain("no new audit event was recorded");
    expect(componentSource).toContain("router.refresh()");
  });

  it("keeps server and transport failures non-diagnostic", () => {
    const componentSource = source();

    expect(componentSource).toContain(
      "Service controls are unavailable while account deletion is in progress.",
    );
    expect(componentSource).toContain(
      "Review the requested change and reason, then try again.",
    );
    expect(componentSource).toContain(
      "Could not update service controls. Try again.",
    );
    expect(componentSource).not.toContain("payload.message");
  });
});
