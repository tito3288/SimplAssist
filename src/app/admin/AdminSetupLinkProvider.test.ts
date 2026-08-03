import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createOneShotAdminSetupLinkTransfer } from "./AdminSetupLinkProvider";

describe("AdminSetupLinkProvider", () => {
  it("transfers each setup link at most once and drops older pending links", () => {
    const transfer = createOneShotAdminSetupLinkTransfer();

    transfer.stage("job-a", "https://partner.example/setup-a");
    transfer.stage("job-b", "https://partner.example/setup-b");

    expect(transfer.take("job-a")).toBeNull();
    expect(transfer.take("job-b")).toBe(
      "https://partner.example/setup-b",
    );
    expect(transfer.take("job-b")).toBeNull();
  });

  it("keeps the transfer memory-only", () => {
    const source = readFileSync(new URL("./AdminSetupLinkProvider.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/i);
    expect(source).not.toMatch(/searchParams|history\.replaceState/i);
    expect(source).not.toMatch(/console\.(?:log|info|warn|error)/i);
  });
});
