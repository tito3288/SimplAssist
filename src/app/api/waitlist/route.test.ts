import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  sendConfirmation: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("@/lib/email/fullSuiteWaitlist", () => ({
  sendFullSuiteWaitlistConfirmation: mocks.sendConfirmation,
}));

import { POST } from "./route";

const SIGNUP_ID = "4f3e6823-e07c-4b7f-a643-ff0c2625850d";
let requestNumber = 0;

function request(
  body: unknown,
  ip = `203.0.113.${++requestNumber}`
): NextRequest {
  return new NextRequest("https://simplassist.com/api/waitlist", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stubInsert(
  result: {
    data: { id: string } | null;
    error: { code?: string; message?: string } | null;
  } = { data: { id: SIGNUP_ID }, error: null }
) {
  const single = vi.fn(async () => result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  mocks.from.mockReturnValue({ insert });
  return { insert, select, single };
}

beforeEach(() => {
  vi.clearAllMocks();
  requestNumber += 1;
  mocks.sendConfirmation.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/waitlist", () => {
  it("rejects invalid JSON", async () => {
    const response = await POST(request("{not json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { email: "" },
    { email: "not-an-email" },
    { email: "a@b" },
    { email: "a@example.com", extra: "not accepted" },
  ])("rejects malformed input %#", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid input" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("silently accepts the honeypot without writing or emailing", async () => {
    const response = await POST(
      request({
        email: "person@example.com",
        website: "https://spam.example",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sendConfirmation).not.toHaveBeenCalled();
  });

  it("normalizes and durably inserts a fresh signup before emailing", async () => {
    const admin = stubInsert();

    const response = await POST(
      request({ email: "  Person@Example.COM  ", website: "" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(admin.insert).toHaveBeenCalledWith({
      email: "person@example.com",
    });
    expect(mocks.sendConfirmation).toHaveBeenCalledWith({
      signupId: SIGNUP_ID,
      email: "person@example.com",
      requestOrigin: "https://simplassist.com",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    "an ordinary duplicate",
    "a previously unsubscribed duplicate",
  ])("returns private success for %s without another email", async () => {
    stubInsert({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "waitlist_signups_email_unique"',
      },
    });

    const response = await POST(
      request({ email: "duplicate@example.com" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.sendConfirmation).not.toHaveBeenCalled();
  });

  it("returns a generic failure and skips email when the insert fails", async () => {
    stubInsert({
      data: null,
      error: { code: "XX000", message: "database unavailable" },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ email: "person@example.com" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Couldn’t join the waitlist right now. Please try again.",
    });
    expect(mocks.sendConfirmation).not.toHaveBeenCalled();
  });

  it("keeps the durable signup successful when confirmation delivery fails", async () => {
    stubInsert();
    mocks.sendConfirmation.mockResolvedValue(false);

    const response = await POST(request({ email: "person@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("keeps the durable signup successful if the sender unexpectedly throws", async () => {
    stubInsert();
    mocks.sendConfirmation.mockRejectedValue(new Error("provider failure"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({ email: "person@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("bounds a stalled confirmation provider without failing the UI", async () => {
    stubInsert();
    mocks.sendConfirmation.mockReturnValue(new Promise(() => undefined));

    const response = await POST(request({ email: "person@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    const [{ signal }] = mocks.sendConfirmation.mock.calls[0] as [
      { signal: AbortSignal },
    ];
    expect(signal.aborted).toBe(true);
  });

  it("spends only the remaining absolute request budget on a stalled provider", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const single = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { data: { id: SIGNUP_ID }, error: null };
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockReturnValue({ insert });
    mocks.sendConfirmation.mockReturnValue(new Promise(() => undefined));

    const responsePromise = POST(request({ email: "person@example.com" }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(400);

    const [{ signal }] = mocks.sendConfirmation.mock.calls[0] as [
      { signal: AbortSignal },
    ];
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(599);
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("rate limits the fourth request from one IP", async () => {
    const ip = "198.51.100.77";
    const botBody = {
      email: "bot@example.com",
      website: "filled-by-bot",
    };

    for (let index = 0; index < 3; index += 1) {
      const response = await POST(request(botBody, ip));
      expect(response.status).toBe(200);
    }

    const limited = await POST(request(botBody, ip));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "Too many requests. Please wait a minute and try again.",
    });
  });
});
