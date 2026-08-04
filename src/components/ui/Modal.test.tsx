import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders its close control as an explicit non-submit button", () => {
    const html = renderToStaticMarkup(
      <Modal open onClose={vi.fn()} title="Confirmation">
        <p>Body</p>
      </Modal>,
    );

    expect(html).toMatch(/<button\b[^>]*type="button"[^>]*>/);
  });
});
