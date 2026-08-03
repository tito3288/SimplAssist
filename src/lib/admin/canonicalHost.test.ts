import { afterEach, describe, expect, it, vi } from "vitest";
import { isCanonicalAdminHostname } from "./canonicalHost";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCanonicalAdminHostname", () => {
  it.each([
    "simplassist.com",
    "SIMPLASSIST.COM",
    "simplassist.com.",
    "simplassist.com:443",
  ])("accepts normalized exact canonical Host %s", (host) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
    expect(isCanonicalAdminHostname(host)).toBe(true);
  });

  it.each([
    null,
    "",
    "app.alphadogagency.ai",
    "simplassist.com.evil.example",
    "www.simplassist.com",
    "https://simplassist.com",
    "simplassist.com,app.alphadogagency.ai",
  ])("rejects a noncanonical or malformed Host %s", (host) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
    expect(isCanonicalAdminHostname(host)).toBe(false);
  });

  it.each([undefined, "", "not a URL", "ftp://simplassist.com"])(
    "fails closed for canonical configuration %s",
    (configuredOrigin) => {
      if (configuredOrigin === undefined) {
        vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        vi.stubEnv("NEXT_PUBLIC_APP_URL", configuredOrigin);
      }

      expect(isCanonicalAdminHostname("simplassist.com")).toBe(false);
    },
  );

  it("ignores forwarded-header values because it accepts only the Host value", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
    expect(isCanonicalAdminHostname("app.alphadogagency.ai")).toBe(false);
  });
});
