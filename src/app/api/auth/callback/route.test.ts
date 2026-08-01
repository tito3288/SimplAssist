import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
  })),
}));

import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("auth callback", () => {
  it("sends completed authentication to the dashboard guards", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");

    const response = await GET(
      new NextRequest("http://localhost:8080/api/auth/callback?code=valid-code")
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/dashboard"
    );
  });

  it("falls back to the request origin and still targets the dashboard", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const response = await GET(
      new NextRequest("https://preview.example.test/api/auth/callback")
    );

    expect(response.headers.get("location")).toBe(
      "https://preview.example.test/dashboard"
    );
  });
});
