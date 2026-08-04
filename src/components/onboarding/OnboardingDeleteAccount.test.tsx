import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/DeleteAccountModal", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-modal-open={String(open)}>Delete confirmation</div>
  ),
}));

import OnboardingDeleteAccount from "./OnboardingDeleteAccount";

describe("OnboardingDeleteAccount", () => {
  it("renders a non-submit action backed by the existing closed modal", () => {
    const html = renderToStaticMarkup(<OnboardingDeleteAccount />);

    expect(html).toContain("Delete account");
    expect(html).toContain('type="button"');
    expect(html).toContain('data-modal-open="false"');
    expect(html).toContain("Delete confirmation");
  });
});
