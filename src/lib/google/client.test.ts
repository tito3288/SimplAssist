import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {},
}));

import { generateAuthUrl, getCanonicalGoogleRedirectUri } from "./client";

const CANONICAL_ORIGIN = "https://app.simplassist.test";
const CALLBACK = `${CANONICAL_ORIGIN}/api/google/callback`;
const STATE = Buffer.alloc(32, 0x4a).toString("base64url");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", CANONICAL_ORIGIN);
  vi.stubEnv("GOOGLE_REDIRECT_URI", CALLBACK);
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google OAuth configuration", () => {
  it("accepts only the exact configured canonical callback", () => {
    expect(getCanonicalGoogleRedirectUri()).toBe(CALLBACK);
  });

  it.each([
    undefined,
    "https://app.partner.test/api/google/callback",
    `${CALLBACK}/extra`,
    `${CALLBACK}?next=/settings`,
    `${CALLBACK}#fragment`,
    "https://user:secret@app.simplassist.test/api/google/callback",
    ` ${CALLBACK}`,
  ])("rejects a noncanonical redirect URI: %s", (configured) => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", configured);
    expect(() => getCanonicalGoogleRedirectUri()).toThrow();
  });

  it("generates an opaque-state authorization URL with the canonical redirect", () => {
    const authorization = new URL(generateAuthUrl(STATE));

    expect(authorization.searchParams.get("state")).toBe(STATE);
    expect(authorization.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(authorization.searchParams.get("access_type")).toBe("offline");
    expect(authorization.searchParams.get("prompt")).toBe("consent");
    expect(Buffer.from(STATE, "base64url").toString("utf8")).not.toContain(
      "business",
    );
  });

  it("rejects malformed state before creating an authorization URL", () => {
    expect(() => generateAuthUrl("business-id")).toThrow(
      "Google OAuth state is invalid",
    );
  });
});
