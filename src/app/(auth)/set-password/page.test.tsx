import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requirePasswordSetupPageAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requirePasswordSetupPageAccess: mocks.requirePasswordSetupPageAccess,
}));
vi.mock("./SetPasswordForm", () => ({
  default: () => <div>Create password form</div>,
}));

import SetPasswordPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((target: string) => {
    throw new Error(`redirect:${target}`);
  });
  mocks.requirePasswordSetupPageAccess.mockResolvedValue({
    status: "resolved",
    user: {
      id: "10000000-0000-4000-a000-000000000001",
      app_metadata: { must_set_password: true },
    },
    business: {
      id: "20000000-0000-4000-a000-000000000001",
      partner_id: "30000000-0000-4000-a000-000000000001",
    },
    hostKind: "partner",
  });
});

describe("SetPasswordPage", () => {
  it("renders only after exact workspace access and the setup marker resolve", async () => {
    const html = renderToStaticMarkup(await SetPasswordPage());

    expect(html).toContain("Create password form");
    expect(mocks.requirePasswordSetupPageAccess).toHaveBeenCalledOnce();
  });

  it.each([false, null, undefined, "true"])(
    "rejects an already-used or malformed marker %s",
    async (mustSetPassword) => {
      mocks.requirePasswordSetupPageAccess.mockResolvedValue({
        status: "resolved",
        user: {
          id: "10000000-0000-4000-a000-000000000001",
          app_metadata: { must_set_password: mustSetPassword },
        },
        business: { id: "business-1", partner_id: null },
        hostKind: "canonical",
      });

      await expect(SetPasswordPage()).rejects.toThrow("redirect:/dashboard");
    },
  );

  it("propagates the fixed workspace redirect for a wrong Host", async () => {
    mocks.requirePasswordSetupPageAccess.mockRejectedValue(
      new Error("redirect:/workspace-access"),
    );

    await expect(SetPasswordPage()).rejects.toThrow(
      "redirect:/workspace-access",
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("has no query-controlled next or redirect input", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("searchParams");
    expect(source).not.toContain('get("next")');
    expect(source).not.toContain("next=");
    expect(source).not.toContain("redirectTo");
    expect(source).not.toContain("request.url");
    expect(source).toContain("noStore()");
  });
});
