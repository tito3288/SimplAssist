import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nextScript: vi.fn(),
}));

vi.mock("next/script", () => ({
  default: (props: unknown) => {
    mocks.nextScript(props);
    return null;
  },
}));

import {
  enableHomepageWidget,
  HOMEPAGE_WIDGET_BODY_CLASS,
  HomepageChatWidget,
} from "./homepage-chat-widget";

describe("homepage chat widget route scope", () => {
  it("marks the body only for the homepage component lifecycle", () => {
    const add = vi.fn();
    const remove = vi.fn();
    const cleanup = enableHomepageWidget({
      classList: { add, remove } as unknown as DOMTokenList,
    });

    expect(add).toHaveBeenCalledWith(HOMEPAGE_WIDGET_BODY_CLASS);
    expect(remove).not.toHaveBeenCalled();

    cleanup();

    expect(remove).toHaveBeenCalledWith(HOMEPAGE_WIDGET_BODY_CLASS);
  });

  it("marks only this embed as homepage-only", () => {
    mocks.nextScript.mockClear();
    renderToStaticMarkup(<HomepageChatWidget />);

    expect(mocks.nextScript.mock.calls[0]?.[0]).toMatchObject({
      src: "https://simplassist.com/widget/embed.js?placement=homepage-v1",
      "data-business-id": "ea848911-ef72-44a6-8cf3-c47b3959be26",
      "data-homepage-only": "true",
      strategy: "afterInteractive",
    });
  });

  it("defaults a leftover homepage embed to hidden off the homepage", () => {
    const globals = readFileSync(
      new URL("../../globals.css", import.meta.url),
      "utf8",
    );

    expect(globals).toContain(
      'body:not(.sa-homepage-widget-route)\n  .sa-widget-container[data-homepage-only="true"]',
    );
    expect(globals).toMatch(
      /\.sa-widget-container\[data-homepage-only="true"\]\s*\{\s*display: none !important;/,
    );
  });
});
