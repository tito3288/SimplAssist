import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ auth: { signOut: vi.fn() } }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/components/ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}));

import DeleteAccountModal from "./DeleteAccountModal";

describe("DeleteAccountModal", () => {
  it("keeps confirmation actions out of surrounding form submission", () => {
    const html = renderToStaticMarkup(
      <DeleteAccountModal open onClose={vi.fn()} />,
    );
    const buttonTags = html.match(/<button\b[^>]*>/g) ?? [];

    expect(buttonTags).toHaveLength(2);
    expect(buttonTags.every((tag) => tag.includes('type="button"'))).toBe(true);
    expect(html).toContain("Delete My Account");
    expect(html).toContain("disabled");
    expect(html).toContain("60 days");
  });
});
