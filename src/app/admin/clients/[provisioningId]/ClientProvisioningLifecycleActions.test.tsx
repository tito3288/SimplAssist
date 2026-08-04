import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
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

import { ClientProvisioningLifecycleActions } from "./ClientProvisioningLifecycleActions";

const JOB_ID = "40000000-0000-4000-a045-000000000001";
const BUSINESS_ID = "10000000-0000-4000-a045-000000000001";

describe("ClientProvisioningLifecycleActions", () => {
  it("offers dismissal only for a resource-free eligible failed job", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningLifecycleActions
        provisioningId={JOB_ID}
        dismissalState="dismissible"
        businessId={null}
      />,
    );

    expect(html).toContain("Dismiss failed job");
    expect(html).toContain("resource-free failed job");
    expect(html).not.toContain("Manage account deletion");
  });

  it("offers restore for dismissed history while preserving its safe error", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningLifecycleActions
        provisioningId={JOB_ID}
        dismissalState="restore"
        businessId={null}
      />,
    );

    expect(html).toContain("Restore job");
    expect(html).toContain("preserving its last safe error code");
    expect(html).not.toContain("Dismiss failed job");
  });

  it("links a business-linked job to the account deletion surface", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningLifecycleActions
        provisioningId={JOB_ID}
        dismissalState="has_resources"
        businessId={BUSINESS_ID}
      />,
    );

    expect(html).toContain("cannot be dismissed");
    expect(html).toContain("Manage account deletion");
    expect(html).toContain(`href="/admin/${BUSINESS_ID}"`);
    expect(html).not.toContain("Dismiss failed job");
  });

  it("gives safe reconciliation guidance for an Auth-only partial job", () => {
    const html = renderToStaticMarkup(
      <ClientProvisioningLifecycleActions
        provisioningId={JOB_ID}
        dismissalState="has_resources"
        businessId={null}
      />,
    );

    expect(html).toContain("Retry or reconcile this provisioning job first");
    expect(html).not.toContain("Manage account deletion");
    expect(html).not.toContain("00000000-0000-4000-a045-000000000001");
  });

  it.each([
    ["in_progress", "provisioning operation is active"],
    ["outcome_unknown", "unknown outcome"],
    ["not_dismissible", "not currently eligible for dismissal"],
  ] as const)("renders the safe %s explanation", (dismissalState, copy) => {
    const html = renderToStaticMarkup(
      <ClientProvisioningLifecycleActions
        provisioningId={JOB_ID}
        dismissalState={dismissalState}
        businessId={null}
      />,
    );

    expect(html).toContain(copy);
    expect(html).not.toContain("Dismiss failed job");
    expect(html).not.toContain("Restore job");
  });

  it("posts an exact empty JSON body and validates a minimal response", () => {
    const source = readFileSync(
      new URL("./ClientProvisioningLifecycleActions.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "`/api/admin/clients/${provisioningId}/${action}`",
    );
    expect(source).toContain('method: "POST"');
    expect(source).toContain('"Content-Type": "application/json"');
    expect(source).toContain("body: JSON.stringify({})");
    expect(source).toContain("provisioningLifecycleResponseSchema.safeParse");
    expect(source).toContain("result.data.provisioningId !== provisioningId");
    expect(source).toContain("result.data.status !== expectedStatus");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("token_hash");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("rawPayload.message");
  });
});
