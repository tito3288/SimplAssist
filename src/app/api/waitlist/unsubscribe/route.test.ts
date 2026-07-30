import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("@/lib/waitlist/unsubscribeToken", () => ({
  verifyWaitlistUnsubscribeToken: mocks.verifyToken,
}));

import { POST } from "./route";

const SIGNUP_ID = "4f3e6823-e07c-4b7f-a643-ff0c2625850d";

function request(token?: string): NextRequest {
  const body = new URLSearchParams();
  if (token !== undefined) body.set("token", token);

  return new NextRequest(
    "https://simplassist.com/api/waitlist/unsubscribe",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );
}

function stubUpdate(
  result: { error: { code?: string; message?: string } | null } = {
    error: null,
  }
) {
  const is = vi.fn(async () => result);
  const eq = vi.fn(() => ({ is }));
  const update = vi.fn(() => ({ eq }));
  mocks.from.mockReturnValue({ update });
  return { update, eq, is };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyToken.mockReturnValue(SIGNUP_ID);
});

describe("POST /api/waitlist/unsubscribe", () => {
  it("sets unsubscribe once and redirects without the token", async () => {
    const admin = stubUpdate();

    const response = await POST(request("v1.valid.signature"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://simplassist.com/waitlist/unsubscribed"
    );
    expect(response.headers.get("location")).not.toContain("token");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(admin.update).toHaveBeenCalledWith({
      unsubscribed_at: expect.any(String),
    });
    expect(admin.eq).toHaveBeenCalledWith("id", SIGNUP_ID);
    expect(admin.is).toHaveBeenCalledWith("unsubscribed_at", null);
  });

  it("is idempotent on a repeated valid submission", async () => {
    const admin = stubUpdate();

    const first = await POST(request("v1.valid.signature"));
    const second = await POST(request("v1.valid.signature"));

    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    expect(admin.update).toHaveBeenCalledTimes(2);
    expect(admin.is).toHaveBeenCalledTimes(2);
  });

  it("never writes for a malformed or tampered token", async () => {
    mocks.verifyToken.mockReturnValue(null);

    const response = await POST(request("tampered"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid unsubscribe link",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("never writes when the form omits the token", async () => {
    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed when token verification is unavailable", async () => {
    mocks.verifyToken.mockImplementation(() => {
      throw new Error("missing secret");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request("v1.valid.signature"));

    expect(response.status).toBe(500);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not redirect when the database update fails", async () => {
    stubUpdate({
      error: { code: "XX000", message: "database unavailable" },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request("v1.valid.signature"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unsubscribe is temporarily unavailable",
    });
  });
});
