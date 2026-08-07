import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
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
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import LoginPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createBrowserClient.mockReturnValue({
    auth: { signInWithPassword: mocks.signInWithPassword },
  });
});

describe("LoginPage recovery navigation", () => {
  it("offers one same-domain forgot-password link beside the password flow", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain("Forgot password?");
    expect(html.match(/href="\/forgot-password"/g)).toHaveLength(1);
    expect(html).not.toContain("simplassist.com/forgot-password");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("Sign in");
  });
});
