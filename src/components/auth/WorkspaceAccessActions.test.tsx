import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import {
  signOutAndNavigateToLogin,
  WorkspaceAccessActions,
} from "./WorkspaceAccessActions";

describe("WorkspaceAccessActions", () => {
  it("signs out only the current customer session before relative login navigation", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const navigate = vi.fn();

    await signOutAndNavigateToLogin(
      { auth: { signOut } } as never,
      navigate
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]
    );
  });

  it("does not navigate when local sign-out fails", async () => {
    const signOut = vi.fn().mockResolvedValue({
      error: { message: "session revocation failed" },
    });
    const navigate = vi.fn();

    await expect(
      signOutAndNavigateToLogin({ auth: { signOut } } as never, navigate)
    ).rejects.toMatchObject({ message: "session revocation failed" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders the explicit current-host account switch action", () => {
    mocks.createBrowserClient.mockReturnValue({
      auth: { signOut: vi.fn() },
    });

    const html = renderToStaticMarkup(<WorkspaceAccessActions />);

    expect(html).toContain("Use a different account here");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });
});
