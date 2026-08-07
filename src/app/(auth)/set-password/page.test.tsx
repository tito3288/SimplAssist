import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requirePasswordSetupPageAccess: vi.fn(),
  verifyPasswordResetIntent: vi.fn(),
  passwordResetOriginForWorkspaceHost: vi.fn(),
  headersGet: vi.fn(),
  cookiesGet: vi.fn(),
  renderedModes: [] as string[],
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: () => ({ get: mocks.headersGet }),
  cookies: () => ({ get: mocks.cookiesGet }),
}));
vi.mock("@/lib/auth/recovery.server", () => ({
  PASSWORD_RESET_INTENT_COOKIE: "simplassist-reset-intent",
  passwordResetOriginForWorkspaceHost:
    mocks.passwordResetOriginForWorkspaceHost,
  verifyPasswordResetIntent: mocks.verifyPasswordResetIntent,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requirePasswordSetupPageAccess: mocks.requirePasswordSetupPageAccess,
}));
vi.mock("./SetPasswordForm", () => ({
  default: ({ mode }: { mode: string }) => {
    mocks.renderedModes.push(mode);
    return <div>Create password form: {mode}</div>;
  },
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

import SetPasswordPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.renderedModes.length = 0;
  mocks.headersGet.mockReturnValue("app.alphadogagency.ai");
  mocks.cookiesGet.mockReturnValue({ value: "signed-reset-intent" });
  mocks.passwordResetOriginForWorkspaceHost.mockImplementation(
    (hostKind: "canonical" | "partner") =>
      hostKind === "canonical"
        ? "https://simplassist.com"
        : "https://app.alphadogagency.ai",
  );
  mocks.verifyPasswordResetIntent.mockReturnValue(true);
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
    const html = renderToStaticMarkup(await SetPasswordPage({}));

    expect(html).toContain("Create password form: setup");
    expect(mocks.requirePasswordSetupPageAccess).toHaveBeenCalledOnce();
  });

  it.each([true, false, null, undefined, "true"])(
    "accepts marker %s in exact reset mode",
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

      const html = renderToStaticMarkup(
        await SetPasswordPage({ searchParams: { mode: "reset" } }),
      );

      expect(html).toContain("Create password form: reset");
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.requirePasswordSetupPageAccess).toHaveBeenCalledOnce();
    },
  );

  it("renders only the exact public invalid-link state before auth access", async () => {
    const html = renderToStaticMarkup(
      await SetPasswordPage({
        searchParams: { mode: "reset", status: "invalid-link" },
      }),
    );

    expect(html).toContain("This link has expired —");
    expect(html).toContain("request a new one");
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain("Create password form");
    expect(mocks.requirePasswordSetupPageAccess).not.toHaveBeenCalled();
    expect(mocks.verifyPasswordResetIntent).not.toHaveBeenCalled();
  });

  it("does not render reset mode for an ordinary session without callback intent", async () => {
    mocks.verifyPasswordResetIntent.mockReturnValue(false);

    const html = renderToStaticMarkup(
      await SetPasswordPage({ searchParams: { mode: "reset" } }),
    );

    expect(html).toContain("This link has expired —");
    expect(html).not.toContain("Create password form");
    expect(mocks.verifyPasswordResetIntent).toHaveBeenCalledWith(
      "10000000-0000-4000-a000-000000000001",
      "https://app.alphadogagency.ai",
      "signed-reset-intent",
    );
  });

  it.each([
    { mode: ["reset", "reset"], status: "invalid-link" },
    { mode: "reset", status: ["invalid-link", "invalid-link"] },
    { mode: "reset", status: "invalid-link", next: "/dashboard" },
    { mode: "reset", status: "expired" },
  ])(
    "does not let malformed reset query shape bypass workspace auth: %o",
    async (searchParams) => {
      mocks.requirePasswordSetupPageAccess.mockResolvedValue({
        status: "resolved",
        user: {
          id: "10000000-0000-4000-a000-000000000001",
          app_metadata: { must_set_password: false },
        },
        business: { id: "business-1", partner_id: null },
        hostKind: "canonical",
      });

      await expect(SetPasswordPage({ searchParams })).rejects.toThrow(
        "redirect:/dashboard",
      );
      expect(mocks.requirePasswordSetupPageAccess).toHaveBeenCalledOnce();
    },
  );

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

      await expect(SetPasswordPage({})).rejects.toThrow("redirect:/dashboard");
    },
  );

  it("propagates the fixed workspace redirect for a wrong Host", async () => {
    mocks.requirePasswordSetupPageAccess.mockRejectedValue(
      new Error("redirect:/workspace-access"),
    );

    await expect(SetPasswordPage({})).rejects.toThrow(
      "redirect:/workspace-access",
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps all destinations fixed despite its strict reset query parser", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).not.toContain('get("next")');
    expect(source).not.toContain("next=");
    expect(source).not.toContain("redirectTo");
    expect(source).not.toContain("request.url");
    expect(source).toContain('redirect("/dashboard")');
    expect(source).toContain('href="/forgot-password"');
    expect(source).toContain("noStore()");
  });
});
