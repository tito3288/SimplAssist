import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processPasswordResetRequest: vi.fn(),
}));

vi.mock("@/lib/auth/recovery.server", () => ({
  processPasswordResetRequest: mocks.processPasswordResetRequest,
}));

vi.mock("server-only", () => ({}));

let POST: typeof import("./route").POST;

const NEUTRAL_MESSAGE =
  "If an account exists for this email, a reset link is on its way.";
let ipSequence = 0;

function request(
  body: unknown,
  options: {
    ip?: string;
    host?: string;
    origin?: string | null;
    fetchSite?: string | null;
    contentType?: string | null;
    raw?: boolean;
  } = {},
): NextRequest {
  const ip = options.ip ?? `203.0.113.${++ipSequence}`;
  const host = options.host ?? "simplassist.com";
  const origin =
    options.origin === undefined
      ? host === "simplassist.com"
        ? "https://simplassist.com"
        : `https://${host}`
      : options.origin;
  const headers: Record<string, string> = {
    host,
    "x-forwarded-for": ip,
  };
  if (options.contentType !== null) {
    headers["content-type"] = options.contentType ?? "application/json";
  }
  if (origin !== null) headers.origin = origin;
  if (options.fetchSite !== null) {
    headers["sec-fetch-site"] = options.fetchSite ?? "same-origin";
  }
  return new NextRequest("https://simplassist.com/api/auth/forgot-password", {
    method: "POST",
    headers,
    body: options.raw ? String(body) : JSON.stringify(body),
  });
}

async function settleAtMinimum<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1_099);
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  return promise;
}

type TimedResponse = {
  response: Response;
  elapsedMs: number;
};

function timedPost(nextRequest: NextRequest): Promise<TimedResponse> {
  const startedAt = Date.now();
  return POST(nextRequest).then((response) => ({
    response,
    elapsedMs: Date.now() - startedAt,
  }));
}

async function publicResponseSnapshot({
  response,
  elapsedMs,
}: TimedResponse) {
  return {
    status: response.status,
    body: await response.json(),
    headers: Array.from(response.headers.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    elapsedMs,
  };
}

async function settleTimedSequence(promises: Promise<TimedResponse>[]) {
  const settled = promises.map(() => false);
  promises.forEach((promise, index) => {
    void promise.then(() => {
      settled[index] = true;
    });
  });

  await vi.advanceTimersByTimeAsync(1_099);
  await vi.advanceTimersByTimeAsync(0);
  expect(settled.every((value) => value === false)).toBe(true);

  await vi.advanceTimersByTimeAsync(1);
  return Promise.all(
    promises.map(async (promise) => publicResponseSnapshot(await promise)),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-secret");
  mocks.processPasswordResetRequest.mockResolvedValue(undefined);
  ({ POST } = await import("./route"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/auth/forgot-password", () => {
  it("normalizes a valid request and returns the exact delayed neutral response", async () => {
    const responsePromise = POST(
      request({ email: "  Owner@Example.COM  " }),
    );
    const response = await settleAtMinimum(responsePromise);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: NEUTRAL_MESSAGE });
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledWith({
      email: "owner@example.com",
      rawHost: "simplassist.com",
    });
  });

  it.each([
    ["invalid JSON", "{not-json", true],
    ["invalid email", { email: "not-an-email" }, false],
    ["unknown property", { email: "owner@example.com", next: "/admin" }, false],
  ])("pads and rejects %s without starting recovery", async (_label, body, raw) => {
    const responsePromise = POST(request(body, { raw }));
    const response = await settleAtMinimum(responsePromise);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid request." });
    expect(mocks.processPasswordResetRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["missing content type", { contentType: null }],
    ["cross-origin form content type", { contentType: "text/plain" }],
    ["missing Origin", { origin: null }],
    ["cross-site Origin", { origin: "https://attacker.example" }],
    ["missing fetch metadata", { fetchSite: null }],
    ["cross-site fetch metadata", { fetchSite: "cross-site" }],
  ])("pads and rejects %s before account work", async (_label, options) => {
    const response = await settleAtMinimum(
      POST(request({ email: "owner@example.com" }, options)),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "Invalid request." });
    expect(mocks.processPasswordResetRequest).not.toHaveBeenCalled();
  });

  it("uses the same status, body, headers, and response time for known and unknown work", async () => {
    mocks.processPasswordResetRequest
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 400)),
      )
      .mockResolvedValueOnce(undefined);

    const knownPromise = POST(request({ email: "known@example.com" }));
    const unknownPromise = POST(request({ email: "unknown@example.com" }));
    await vi.advanceTimersByTimeAsync(1_099);
    let knownSettled = false;
    let unknownSettled = false;
    void knownPromise.then(() => {
      knownSettled = true;
    });
    void unknownPromise.then(() => {
      unknownSettled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect([knownSettled, unknownSettled]).toEqual([false, false]);

    await vi.advanceTimersByTimeAsync(1);
    const [known, unknown] = await Promise.all([knownPromise, unknownPromise]);
    expect(known.status).toBe(unknown.status);
    expect(known.headers.get("cache-control")).toBe(
      unknown.headers.get("cache-control"),
    );
    expect(await known.json()).toEqual(await unknown.json());
  });

  it("keeps known and unknown email-suppression sequences indistinguishable and consumes both buckets equally", async () => {
    mocks.processPasswordResetRequest.mockImplementation(
      ({ email }: { email: string }) =>
        email === "known@example.com"
          ? new Promise<void>((resolve) => setTimeout(resolve, 400))
          : Promise.resolve(),
    );

    const knownSequence = Array.from({ length: 5 }, (_, index) =>
      timedPost(
        request(
          { email: "known@example.com" },
          { ip: `email-known-${index}` },
        ),
      ),
    );
    const unknownSequence = Array.from({ length: 5 }, (_, index) =>
      timedPost(
        request(
          { email: "unknown@example.com" },
          { ip: `email-unknown-${index}` },
        ),
      ),
    );

    const snapshots = await settleTimedSequence([
      ...knownSequence,
      ...unknownSequence,
    ]);
    const knownSnapshots = snapshots.slice(0, knownSequence.length);
    const unknownSnapshots = snapshots.slice(knownSequence.length);

    expect(knownSnapshots).toEqual(unknownSnapshots);
    expect(knownSnapshots).toEqual(
      Array.from({ length: 5 }, () => ({
        status: 200,
        body: { message: NEUTRAL_MESSAGE },
        headers: [
          ["cache-control", "no-store"],
          ["content-type", "application/json"],
        ],
        elapsedMs: 1_100,
      })),
    );

    const recoveryEmails = mocks.processPasswordResetRequest.mock.calls.map(
      ([{ email }]) => email,
    );
    expect(
      recoveryEmails.filter((email) => email === "known@example.com"),
    ).toHaveLength(3);
    expect(
      recoveryEmails.filter((email) => email === "unknown@example.com"),
    ).toHaveLength(3);
  });

  it("does not let stalled downstream work extend the public timing profile", async () => {
    mocks.processPasswordResetRequest.mockReturnValue(
      new Promise(() => undefined),
    );

    const response = await settleAtMinimum(
      POST(request({ email: "known@example.com" })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: NEUTRAL_MESSAGE });
  });

  it("catches an early failure without changing the response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.processPasswordResetRequest.mockRejectedValue(
      new Error("secret early provider details"),
    );

    const response = await settleAtMinimum(
      POST(request({ email: "known@example.com" })),
    );
    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      "[auth:forgot-password] recovery processing failed",
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret");
  });

  it("catches a post-response failure without changing the response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectWork!: (error: Error) => void;
    mocks.processPasswordResetRequest.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectWork = reject;
      }),
    );

    const response = await settleAtMinimum(
      POST(request({ email: "known@example.com" })),
    );
    expect(response.status).toBe(200);
    rejectWork(new Error("secret provider details"));
    await vi.advanceTimersByTimeAsync(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "[auth:forgot-password] recovery processing failed",
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret");
  });

  it("silently suppresses the fourth request without replacing an outstanding setup token", async () => {
    let currentRecoveryToken = "setup-token-before-resets";
    mocks.processPasswordResetRequest.mockImplementation(async () => {
      currentRecoveryToken = `reset-token-${mocks.processPasswordResetRequest.mock.calls.length}`;
    });
    const firstThree = Array.from({ length: 3 }, (_, index) =>
      POST(
        request(
          { email: "owner@example.com" },
          { ip: `198.51.100.${index + 1}` },
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    const firstResponses = await Promise.all(firstThree);
    expect(
      firstResponses.every((response) => response.status === 200),
    ).toBe(true);
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(3);

    // Model Bryan issuing setup A after the bucket has filled. The suppressed
    // request must never enter recovery processing, so it cannot replace A in
    // Supabase's shared recovery-token pool.
    currentRecoveryToken = "setup-token-a";
    const fourth = POST(
      request(
        { email: "owner@example.com" },
        { ip: "198.51.100.4" },
      ),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    const fourthResponse = await fourth;

    expect(fourthResponse.status).toBe(200);
    expect(await fourthResponse.json()).toEqual({ message: NEUTRAL_MESSAGE });
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(3);
    expect(currentRecoveryToken).toBe("setup-token-a");
  });

  it("keeps email limits independent across request hosts", async () => {
    const firstHost = Array.from({ length: 4 }, (_, index) =>
      POST(
        request(
          { email: "owner@example.com" },
          { ip: `198.51.100.${index + 1}`, host: "simplassist.com" },
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    await Promise.all(firstHost);
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(3);

    const partnerPromise = POST(
      request(
        { email: "owner@example.com" },
        { ip: "198.51.100.50", host: "app.alphadogagency.ai" },
      ),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    await partnerPromise;
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(4);
  });

  it("returns the same delayed IP-limit response regardless of email", async () => {
    const ip = "198.51.100.99";
    const admitted = Array.from({ length: 10 }, (_, index) =>
      POST(request({ email: `person${index}@example.com` }, { ip })),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    await Promise.all(admitted);

    const limitedPromise = POST(
      request({ email: "known-or-unknown@example.com" }, { ip }),
    );
    const response = await settleAtMinimum(limitedPromise);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      message: "Too many requests. Please wait and try again.",
    });
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(10);
  });

  it("keeps known and unknown IP-limit sequences indistinguishable and consumes both buckets equally", async () => {
    mocks.processPasswordResetRequest.mockImplementation(
      ({ email }: { email: string }) =>
        email.startsWith("known-")
          ? new Promise<void>((resolve) => setTimeout(resolve, 400))
          : Promise.resolve(),
    );

    const knownSequence = Array.from({ length: 12 }, (_, index) =>
      timedPost(
        request(
          { email: `known-${index}@example.com` },
          { ip: "ip-known-sequence" },
        ),
      ),
    );
    const unknownSequence = Array.from({ length: 12 }, (_, index) =>
      timedPost(
        request(
          { email: `unknown-${index}@example.com` },
          { ip: "ip-unknown-sequence" },
        ),
      ),
    );

    const snapshots = await settleTimedSequence([
      ...knownSequence,
      ...unknownSequence,
    ]);
    const knownSnapshots = snapshots.slice(0, knownSequence.length);
    const unknownSnapshots = snapshots.slice(knownSequence.length);

    expect(knownSnapshots).toEqual(unknownSnapshots);
    expect(knownSnapshots.slice(0, 10)).toEqual(
      Array.from({ length: 10 }, () => ({
        status: 200,
        body: { message: NEUTRAL_MESSAGE },
        headers: [
          ["cache-control", "no-store"],
          ["content-type", "application/json"],
        ],
        elapsedMs: 1_100,
      })),
    );
    expect(knownSnapshots.slice(10)).toEqual(
      Array.from({ length: 2 }, () => ({
        status: 429,
        body: { message: "Too many requests. Please wait and try again." },
        headers: [
          ["cache-control", "no-store"],
          ["content-type", "application/json"],
          ["retry-after", "900"],
        ],
        elapsedMs: 1_100,
      })),
    );

    const recoveryEmails = mocks.processPasswordResetRequest.mock.calls.map(
      ([{ email }]) => email,
    );
    expect(
      recoveryEmails.filter((email) => email.startsWith("known-")),
    ).toHaveLength(10);
    expect(
      recoveryEmails.filter((email) => email.startsWith("unknown-")),
    ).toHaveLength(10);
  });

  it("evicts the oldest bucket when the 10,000-identifier bound is reached", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: () => void) => {
        handler();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    );
    const oldestIp = "oldest-rate-limit-identifier";
    const rateLimitOnlyRequest = (ip: string) =>
      ({
        headers: new Headers({
          "content-type": "application/json",
          host: "simplassist.com",
          origin: "https://simplassist.com",
          "sec-fetch-site": "cross-site",
          "x-forwarded-for": ip,
        }),
      }) as NextRequest;

    const seededRequests: Array<ReturnType<typeof POST>> = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      seededRequests.push(POST(rateLimitOnlyRequest(oldestIp)));
    }
    for (let index = 0; index < 9_999; index += 1) {
      seededRequests.push(
        POST(rateLimitOnlyRequest(`bounded-identifier-${index}`)),
      );
    }
    await Promise.all(seededRequests);

    const overflow = POST(rateLimitOnlyRequest("overflow-identifier"));
    const restartedOldestBucket = Array.from({ length: 11 }, () =>
      POST(rateLimitOnlyRequest(oldestIp)),
    );

    expect((await overflow).status).toBe(400);

    const restartedStatuses = await Promise.all(
      restartedOldestBucket.map(async (response) => (await response).status),
    );
    expect(restartedStatuses).toEqual([
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      429,
    ]);
  });

  it("admits both buckets again after fifteen minutes", async () => {
    const email = "owner@example.com";
    const ip = "198.51.100.77";
    const initial = Array.from({ length: 4 }, () =>
      POST(request({ email }, { ip })),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    await Promise.all(initial);
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    const admitted = POST(request({ email }, { ip }));
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await admitted).status).toBe(200);
    expect(mocks.processPasswordResetRequest).toHaveBeenCalledTimes(4);
  });

  it("uses the 1,299ms upper jitter boundary", async () => {
    vi.mocked(Math.random).mockReturnValue(0.999999);
    const responsePromise = POST(request({ email: "owner@example.com" }));
    await vi.advanceTimersByTimeAsync(1_298);
    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await responsePromise).status).toBe(200);
  });
});
