import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmbedCodeGenerator, { buildEmbedCode } from "./EmbedCodeGenerator";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

describe("EmbedCodeGenerator", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the exact script tag from the server-provided origin", () => {
    expect(
      buildEmbedCode("https://app.partner.example", BUSINESS_ID),
    ).toBe(
      `<script src="https://app.partner.example/widget/embed.js" data-business-id="${BUSINESS_ID}"></script>`,
    );
  });

  it("accepts a canonical local HTTP origin", () => {
    expect(buildEmbedCode("http://localhost:3000", BUSINESS_ID)).toContain(
      'src="http://localhost:3000/widget/embed.js"',
    );
  });

  it.each([
    "https://app.partner.example/",
    "https://app.partner.example/path",
    "//app.partner.example",
    "javascript:alert(1)",
    "https://user:secret@app.partner.example",
    'https://app.partner.example\" onload=\"alert(1)',
  ])("rejects an invalid script origin %s", (scriptOrigin) => {
    expect(() => buildEmbedCode(scriptOrigin, BUSINESS_ID)).toThrow(
      "Invalid widget script origin",
    );
  });

  it("rejects a malformed or injectable business ID", () => {
    expect(() =>
      buildEmbedCode(
        "https://app.partner.example",
        `${BUSINESS_ID}\" onload=\"alert(1)`,
      ),
    ).toThrow("Invalid widget business ID");
  });

  it("renders the server-provided origin without consulting public env", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://wrong-request.example");

    const html = renderToStaticMarkup(
      <EmbedCodeGenerator
        businessId={BUSINESS_ID}
        scriptOrigin="https://stored-assignment.example"
      />,
    );

    expect(html).toContain(
      "https://stored-assignment.example/widget/embed.js",
    );
    expect(html).not.toContain("wrong-request.example");
  });
});
