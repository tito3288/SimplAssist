import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/admin/sessionClient", () => ({
  createAdminSessionBrowserClient: () => ({
    auth: { signOut: mocks.signOut },
  }),
}));

import AdminSignOutButton from "./AdminSignOutButton";

describe("AdminSignOutButton", () => {
  it("renders the session action as a compact navigation button", () => {
    const html = renderToStaticMarkup(<AdminSignOutButton />);

    expect(html).toContain('type="button"');
    expect(html).toContain("Sign out</button>");
    expect(html).toContain("inline-flex");
    expect(html).toContain("rounded-full");
    expect(html).toContain("px-3");
    expect(html).toContain("py-1.5");
    expect(html).toContain("disabled:cursor-not-allowed");
    expect(html).not.toContain('disabled=""');
  });
});
