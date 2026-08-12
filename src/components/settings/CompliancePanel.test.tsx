import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import {
  COMPLIANCE_LOCK_COPY,
  SETTINGS_REGISTRATION_LOCK_CODE,
} from "@/lib/settings/registrationLockCopy";
import CompliancePanel, {
  refreshForStaleComplianceLock,
  submitComplianceSettings,
} from "./CompliancePanel";

const BUSINESS = {
  name: "Example Business",
  phone_number: "+13175550100",
  sms_phone_number: "+13175550200",
  email: "owner@example.test",
  address: "123 Main Street",
  city: "Indianapolis",
  state: "IN",
  zip: "46204",
  opt_in_description: null,
  language: "en" as const,
};

function renderPanel(options: {
  registrationLocked?: boolean;
  slug?: string;
} = {}) {
  return renderToStaticMarkup(
    <CompliancePanel
      slug={options.slug ?? "example-business"}
      business={BUSINESS}
      initialMode="self_hosted"
      initialPrivacyUrl="https://example.test/privacy"
      initialTermsUrl="https://example.test/terms"
      registrationLocked={options.registrationLocked ?? false}
    />
  );
}

function saveButton(markup: string): string {
  const button = (markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? []).find(
    (candidate) => candidate.includes(">Save</button>")
  );
  if (!button) throw new Error("missing compliance Save button");
  return button;
}

describe("CompliancePanel registration lock", () => {
  it("renders filed settings read-only with the exact categorized support link", () => {
    const markup = renderPanel({ registrationLocked: true });

    expect(markup).toContain(COMPLIANCE_LOCK_COPY.supportText);
    expect(markup).toContain(COMPLIANCE_LOCK_COPY.reasonText);
    expect(markup).toContain('href="/support?category=number_registration"');
    expect(markup).toContain('<fieldset disabled=""');
    expect(saveButton(markup)).toContain('disabled=""');
    expect(markup).toContain('value="https://example.test/privacy"');
    expect(markup).toContain('value="https://example.test/terms"');
  });

  it("leaves an unlocked finalized-slug panel editable", () => {
    const markup = renderPanel();

    expect(markup).not.toContain(COMPLIANCE_LOCK_COPY.supportText);
    expect(markup).toContain('<fieldset class="space-y-5"');
    expect(saveButton(markup)).not.toContain('disabled=""');
  });

  it("preserves the independent pending-slug lock", () => {
    const markup = renderPanel({ slug: "pending-deadbeef" });

    expect(markup).toContain("Complete brand verification first");
    expect(markup).toContain('<fieldset disabled=""');
    expect(saveButton(markup)).toContain('disabled=""');
  });

  it("does not issue a request when the registration is locked", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      submitComplianceSettings({
        registrationLocked: true,
        payload: {
          mode: "hosted",
          privacyUrlOverride: null,
          termsUrlOverride: null,
        },
        fetchImpl,
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the unchanged compliance payload while unlocked", async () => {
    const response = Response.json({ success: true });
    const fetchImpl = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;

    await expect(
      submitComplianceSettings({
        registrationLocked: false,
        payload: {
          mode: "hosted",
          privacyUrlOverride: null,
          termsUrlOverride: null,
        },
        fetchImpl,
      })
    ).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith("/api/settings/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "hosted",
        privacyUrlOverride: null,
        termsUrlOverride: null,
      }),
    });
  });

  it("refreshes only for the exact stale registration-lock response", () => {
    const refresh = vi.fn();

    expect(
      refreshForStaleComplianceLock({
        status: 403,
        code: SETTINGS_REGISTRATION_LOCK_CODE,
        refresh,
      })
    ).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();

    refresh.mockClear();
    expect(
      refreshForStaleComplianceLock({
        status: 403,
        code: "workspace_access_denied",
        refresh,
      })
    ).toBe(false);
    expect(
      refreshForStaleComplianceLock({
        status: 409,
        code: SETTINGS_REGISTRATION_LOCK_CODE,
        refresh,
      })
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
