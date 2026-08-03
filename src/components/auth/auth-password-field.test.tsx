import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthPasswordField } from "./auth-password-field";

describe("AuthPasswordField branding", () => {
  it("uses runtime brand variables for interactive accents", () => {
    const html = renderToStaticMarkup(
      <AuthPasswordField
        id="password"
        label="Password"
        registration={{
          name: "password",
          onBlur: vi.fn(),
          onChange: vi.fn(),
          ref: vi.fn(),
        }}
      />,
    );

    expect(html).toContain("hover:text-[var(--brand-primary-dark)]");
    expect(html).toContain("dark:hover:text-[var(--brand-primary-soft-dark)]");
    expect(html).toContain(
      "focus-visible:ring-[rgb(var(--brand-primary-dark-rgb)/.50)]",
    );
    expect(html).not.toMatch(/#(?:ea580c|ff914d|ffb07a)/i);
  });
});
