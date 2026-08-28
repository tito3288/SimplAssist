import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scrape: vi.fn() }));

vi.mock("@mendable/firecrawl-js", () => ({
  default: class Firecrawl {
    v1 = { scrapeUrl: mocks.scrape };
  },
}));

import { scrapeBusinessWebsite, scrapePageWithLinks } from "./client";

describe("legacy Firecrawl compatibility adapter", () => {
  beforeEach(() => mocks.scrape.mockReset());

  it("preserves the markdown-only contract used by A2P crawling", async () => {
    mocks.scrape.mockResolvedValue({ success: true, markdown: "Rendered content" });

    await expect(scrapeBusinessWebsite("https://example.com/menu")).resolves.toBe(
      "Rendered content"
    );
    expect(mocks.scrape).toHaveBeenCalledWith("https://example.com/menu", {
      formats: ["markdown"],
    });
  });

  it("preserves homepage link discovery and lets provider failures reject", async () => {
    mocks.scrape.mockResolvedValueOnce({
      success: true,
      markdown: "Home",
      links: ["/menu"],
    });
    await expect(scrapePageWithLinks("https://example.com")).resolves.toEqual({
      markdown: "Home",
      links: ["/menu"],
    });

    mocks.scrape.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(scrapeBusinessWebsite("https://example.com")).rejects.toThrow(
      "provider unavailable"
    );
  });

  it("keeps empty provider fields safe for legacy callers", async () => {
    mocks.scrape.mockResolvedValue({ success: true });
    await expect(scrapePageWithLinks("https://example.com")).resolves.toEqual({
      markdown: "",
      links: [],
    });
  });

  it("keeps legacy unsuccessful responses on the existing thrown-error path", async () => {
    mocks.scrape.mockResolvedValue({ success: false, error: "request failed" });
    await expect(scrapeBusinessWebsite("https://example.com")).rejects.toThrow(
      "Firecrawl scrape failed: request failed"
    );
  });
});
