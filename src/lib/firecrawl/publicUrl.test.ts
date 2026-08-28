import { describe, expect, it } from "vitest";

import { validatePublicHttpUrl } from "./publicUrl";

describe("website scan public URL guard", () => {
  it.each([
    "http://127.0.0.1",
    "http://0177.0.0.1",
    "http://2130706433",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:0a00:0001]",
    "http://[fe80::1]",
    "http://[febf::1]",
    "http://[fec0::1]",
    "http://[fc00::1]",
    "http://[fd00::1]",
    "http://[ff02::1]",
    "http://[2001:db8::1]",
    "http://[2002:7f00:1::1]",
  ])("rejects non-public literal %s", async (url) => {
    await expect(validatePublicHttpUrl(url)).rejects.toThrow(/private|resolve/i);
  });

  it("allows public IPv4 and global-unicast IPv6 literals", async () => {
    await expect(validatePublicHttpUrl("https://8.8.8.8/path")).resolves.toBe(
      "https://8.8.8.8/path"
    );
    await expect(
      validatePublicHttpUrl("https://[2606:4700:4700::1111]/path")
    ).resolves.toBe("https://[2606:4700:4700::1111]/path");
  });

  it("rejects embedded credentials before sending a URL to a provider", async () => {
    await expect(
      validatePublicHttpUrl("https://user:secret@8.8.8.8/path")
    ).rejects.toThrow(/credentials/i);
  });

  it.each(["http://999.1.1.1", "http://1.2.3.999", "http://[gggg::1]"])(
    "rejects malformed IP literal %s",
    async (url) => {
      await expect(validatePublicHttpUrl(url)).rejects.toThrow();
    }
  );
});
