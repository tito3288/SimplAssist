import { getRedirectStatus } from "next/dist/lib/redirect-status";
import { describe, expect, it } from "vitest";
import nextConfig from "./next.config.mjs";

describe("Next redirects", () => {
  it("permanently redirects the legacy homepage to the canonical root", async () => {
    expect(nextConfig.redirects).toBeTypeOf("function");
    const redirects = await nextConfig.redirects!();

    expect(redirects).toEqual([
      {
        source: "/home",
        destination: "/",
        permanent: true,
      },
    ]);
    expect(getRedirectStatus(redirects[0])).toBe(308);
  });
});
