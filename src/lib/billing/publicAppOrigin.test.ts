import { afterEach, describe, expect, it, vi } from "vitest";
import { publicAppOrigin } from "./publicAppOrigin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicAppOrigin", () => {
  it("uses and normalizes NEXT_PUBLIC_APP_URL outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/some/path/");

    expect(publicAppOrigin("http://localhost:8080")).toBe(
      "https://simplassist.com"
    );
  });

  it.each(["production", "test"])(
    "fails loudly when NEXT_PUBLIC_APP_URL is missing in %s",
    (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

      expect(() => publicAppOrigin("http://localhost:8080")).toThrow(
        "NEXT_PUBLIC_APP_URL is not set"
      );
    }
  );

  it("rejects a configured localhost origin outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:8080");

    expect(() => publicAppOrigin("http://localhost:8080")).toThrow(
      "NEXT_PUBLIC_APP_URL must not use localhost outside development"
    );
  });

  it("falls back to the request origin only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(publicAppOrigin("http://localhost:3000/some/path")).toBe(
      "http://localhost:3000"
    );
  });
});
