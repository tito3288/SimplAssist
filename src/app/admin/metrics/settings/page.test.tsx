import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMetricsReportConfigSettings } from "@/lib/admin/metricsReportConfigs.shared";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  serverModuleLoaded: vi.fn(),
  loadSettings: vi.fn(),
  renderSettings: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/admin/metricsReportConfigs.server", () => {
  mocks.serverModuleLoaded();
  return {
    loadAdminMetricsReportConfigSettings: mocks.loadSettings,
  };
});
vi.mock("./MetricsReportSettings", () => ({
  MetricsReportSettings: (props: {
    settings: AdminMetricsReportConfigSettings;
  }) => {
    mocks.renderSettings(props);
    return <div>Report config cards</div>;
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

import AdminMetricsReportSettingsPage from "./page";

const SETTINGS: AdminMetricsReportConfigSettings = {
  direct: { config: null, businesses: [] },
  partners: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.loadSettings.mockResolvedValue(SETTINGS);
});

describe("AdminMetricsReportSettingsPage", () => {
  it("does not import through or call the settings loader when page auth fails", async () => {
    const authError = new Error("NEXT_NOT_FOUND");
    mocks.requireAdminUser.mockRejectedValue(authError);

    await expect(AdminMetricsReportSettingsPage()).rejects.toBe(authError);

    expect(mocks.serverModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.loadSettings).not.toHaveBeenCalled();
    expect(mocks.renderSettings).not.toHaveBeenCalled();
  });

  it("authenticates before the lazy service-role-backed loader", async () => {
    const html = renderToStaticMarkup(
      await AdminMetricsReportSettingsPage(),
    );

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.serverModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.loadSettings).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.serverModuleLoaded.mock.invocationCallOrder[0],
    );
    expect(mocks.serverModuleLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadSettings.mock.invocationCallOrder[0],
    );
    expect(mocks.renderSettings).toHaveBeenCalledWith({ settings: SETTINGS });
    expect(html).toContain('href="/admin/metrics"');
    expect(html).toContain("Back to metrics");
    expect(html).toContain("Monthly report settings");
    expect(html).toContain("SimplAssist and each partner");
    expect(html).toContain("take effect when the next snapshot is generated");
    expect(html).toContain("Already-frozen reports and deliveries are unchanged");
    expect(html).toContain("Report config cards");
  });

  it("does not hide an unexpected settings read failure", async () => {
    const readError = new Error("settings read failed");
    mocks.loadSettings.mockRejectedValue(readError);

    await expect(AdminMetricsReportSettingsPage()).rejects.toBe(readError);
    expect(mocks.renderSettings).not.toHaveBeenCalled();
  });
});
