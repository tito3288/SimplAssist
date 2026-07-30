import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullSuiteLaunchSendOutcome } from "@/lib/email/fullSuiteLaunch";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  sendLaunchEmail: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  lte: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/email/fullSuiteLaunch", () => ({
  sendFullSuiteLaunchEmail: mocks.sendLaunchEmail,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

import { POST } from "./route";

const ADMIN_ID = "47a389a8-41ee-4e30-8dd2-d6cd83c67ee4";
const SIGNUP_ID = "4f3e6823-e07c-4b7f-a643-ff0c2625850d";
const SECOND_SIGNUP_ID = "fc19a1dd-d84b-4f50-9521-b44f568c26f7";
const THIRD_SIGNUP_ID = "ba0f8cb8-0132-4e76-a330-164c36fe4f82";
const CUTOFF = "2026-01-01T12:00:00.000Z";

let currentRecheckId = SIGNUP_ID;

const queryBuilder = {
  select: mocks.select,
  eq: mocks.eq,
  is: mocks.is,
  lte: mocks.lte,
  order: mocks.order,
  range: mocks.range,
  maybeSingle: mocks.maybeSingle,
};

function makeRequest(
  body: unknown,
  options: {
    origin?: string | null;
    fetchSite?: string | null;
    rawBody?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.origin !== null) {
    headers.origin = options.origin ?? "https://simplassist.com";
  }
  if (options.fetchSite !== null) {
    headers["sec-fetch-site"] = options.fetchSite ?? "same-origin";
  }

  return new NextRequest(
    "https://simplassist-production.up.railway.app/api/admin/waitlist/send",
    {
      method: "POST",
      body: options.rawBody ?? JSON.stringify(body),
      headers,
    }
  );
}

function senderResult(outcome: FullSuiteLaunchSendOutcome) {
  return async (
    _input: unknown,
    beforeProviderSend?: () => Promise<boolean>
  ) => {
    if (beforeProviderSend && !(await beforeProviderSend())) {
      return "cancelled";
    }
    return outcome;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
  vi.stubEnv("WAITLIST_UNSUBSCRIBE_SECRET", "s".repeat(32));
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  currentRecheckId = SIGNUP_ID;
  mocks.getAdminUser.mockResolvedValue({
    id: ADMIN_ID,
    email: "admin@simplassist.com",
  });
  mocks.from.mockReturnValue(queryBuilder);
  mocks.select.mockReturnValue(queryBuilder);
  mocks.eq.mockImplementation((field: string, value: unknown) => {
    if (field === "id" && typeof value === "string") {
      currentRecheckId = value;
    }
    return queryBuilder;
  });
  mocks.is.mockReturnValue(queryBuilder);
  mocks.lte.mockReturnValue(queryBuilder);
  mocks.order.mockReturnValue(queryBuilder);
  mocks.range.mockResolvedValue({ data: [], error: null });
  mocks.maybeSingle.mockImplementation(async () => ({
    data: { id: currentRecheckId },
    error: null,
  }));
  mocks.sendLaunchEmail.mockImplementation(senderResult("accepted"));
  mocks.rpc.mockImplementation(
    async (name: string, args: Record<string, string>) => {
      if (name === "claim_waitlist_launch_send") {
        return {
          data: [
            {
              signup_id: args.p_signup_id,
              signup_email: "claimed-recipient@example.com",
            },
          ],
          error: null,
        };
      }
      return { data: true, error: null };
    }
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/waitlist/send", () => {
  it("authenticates before parsing and returns only 404 to a non-admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const json = vi.fn().mockRejectedValue(new Error("must not parse"));
    const request = {
      json,
      headers: new Headers(),
      nextUrl: new URL(
        "https://simplassist.com/api/admin/waitlist/send"
      ),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
  });

  it("requires the configured exact same origin before parsing", async () => {
    const json = vi.fn();
    const request = {
      json,
      headers: new Headers({
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
      nextUrl: new URL(
        "https://simplassist.com/api/admin/waitlist/send"
      ),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["", "https://simplassist.com", "same-origin"],
    ["https://simplassist.com/", null, "same-origin"],
    ["https://simplassist.com/", "https://simplassist.com", "cross-site"],
  ])(
    "fails closed for missing configuration/origin or non-same-origin fetch metadata",
    async (configuredUrl, origin, fetchSite) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", configuredUrl);

      const response = await POST(
        makeRequest(
          { action: "test" },
          { origin, fetchSite }
        )
      );

      expect(response.status).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { action: "single", signupId: "not-a-uuid" },
    { action: "single", signupId: SIGNUP_ID, recipient: "evil@example.com" },
    { action: "test", email: "evil@example.com" },
    {
      action: "bulk",
      confirmation: "send",
      expectedCount: 1,
      cutoff: CUTOFF,
    },
    {
      action: "bulk",
      confirmation: "SEND",
      expectedCount: 1,
      cutoff: CUTOFF,
      template: "attacker-template",
    },
  ])("rejects the strict payload %# before database/provider use", async (body) => {
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON after authentication", async () => {
    const response = await POST(
      makeRequest(null, { rawBody: "{not-json" })
    );

    expect(response.status).toBe(400);
    expect(mocks.getAdminUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the session-derived admin email for test sends", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });

    const response = await POST(makeRequest({ action: "test" }));

    expect(response.status).toBe(409);
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["accepted", { sent: 1, failed: 0, skipped: 0, needsReview: 0 }],
    [
      "definite_failure",
      { sent: 0, failed: 1, skipped: 0, needsReview: 0 },
    ],
    ["ambiguous", { sent: 0, failed: 0, skipped: 0, needsReview: 1 }],
  ] as const)(
    "returns aggregate-only test-send result for %s",
    async (outcome, expected) => {
      mocks.sendLaunchEmail.mockImplementation(senderResult(outcome));

      const response = await POST(makeRequest({ action: "test" }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expected);
      expect(mocks.sendLaunchEmail).toHaveBeenCalledWith({
        kind: "test",
        email: "admin@simplassist.com",
        requestOrigin:
          "https://simplassist-production.up.railway.app",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    }
  );

  it("claims, revalidates, sends only to the claimed email, and completes", async () => {
    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sent: 1,
      failed: 0,
      skipped: 0,
      needsReview: 0,
    });
    expect(mocks.rpc.mock.calls[0][0]).toBe(
      "claim_waitlist_launch_send"
    );
    expect(mocks.sendLaunchEmail).toHaveBeenCalledWith(
      {
        kind: "launch",
        signupId: SIGNUP_ID,
        email: "claimed-recipient@example.com",
        requestOrigin:
          "https://simplassist-production.up.railway.app",
      },
      expect.any(Function)
    );
    expect(mocks.select).toHaveBeenCalledWith("id");
    expect(mocks.eq).toHaveBeenCalledWith("id", SIGNUP_ID);
    expect(mocks.is).toHaveBeenCalledWith("notified_at", null);
    expect(mocks.is).toHaveBeenCalledWith("unsubscribed_at", null);
    expect(mocks.rpc.mock.calls.at(-1)?.[0]).toBe(
      "complete_waitlist_launch_send"
    );
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_signup_id: SIGNUP_ID,
      p_claim_token: mocks.rpc.mock.calls[0][1].p_claim_token,
    });
  });

  it("skips a row that cannot be claimed without sending", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    await expect(response.json()).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: 1,
      needsReview: 0,
    });
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
  });

  it("releases and skips when the final pre-send recheck sees an unsubscribe/state change", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    await expect(response.json()).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: 1,
      needsReview: 0,
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_waitlist_launch_send",
      "release_waitlist_launch_send",
    ]);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_waitlist_launch_send",
      expect.anything()
    );
  });

  it("rejects claim-result recipient substitution and releases the requested row", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          signup_id: SECOND_SIGNUP_ID,
          signup_email: "substituted@example.com",
        },
      ],
      error: null,
    });

    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    await expect(response.json()).resolves.toEqual({
      sent: 0,
      failed: 1,
      skipped: 0,
      needsReview: 0,
    });
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[1]).toEqual([
      "release_waitlist_launch_send",
      expect.objectContaining({ p_signup_id: SIGNUP_ID }),
    ]);
  });

  it("rejects multiple claim rows instead of choosing a recipient", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          signup_id: SIGNUP_ID,
          signup_email: "first@example.com",
        },
        {
          signup_id: SIGNUP_ID,
          signup_email: "second@example.com",
        },
      ],
      error: null,
    });

    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    await expect(response.json()).resolves.toMatchObject({
      failed: 1,
      sent: 0,
    });
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
  });

  it("releases explicit definite provider failures for safe retry", async () => {
    mocks.sendLaunchEmail.mockImplementation(
      senderResult("definite_failure")
    );

    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    await expect(response.json()).resolves.toEqual({
      sent: 0,
      failed: 1,
      skipped: 0,
      needsReview: 0,
    });
    expect(mocks.rpc.mock.calls.at(-1)?.[0]).toBe(
      "release_waitlist_launch_send"
    );
  });

  it("preserves ambiguous provider claims for manual review", async () => {
    mocks.sendLaunchEmail.mockImplementation(senderResult("ambiguous"));

    const response = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );

    await expect(response.json()).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
      needsReview: 1,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "release_waitlist_launch_send",
      expect.anything()
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_waitlist_launch_send",
      expect.anything()
    );
  });

  it("marks accepted-but-uncompleted sends and failed releases for review", async () => {
    mocks.rpc.mockImplementation(
      async (name: string, args: Record<string, string>) => {
        if (name === "claim_waitlist_launch_send") {
          return {
            data: [
              {
                signup_id: args.p_signup_id,
                signup_email: "claimed-recipient@example.com",
              },
            ],
            error: null,
          };
        }
        if (name === "complete_waitlist_launch_send") {
          return { data: false, error: null };
        }
        return { data: false, error: null };
      }
    );

    const accepted = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );
    await expect(accepted.json()).resolves.toMatchObject({ needsReview: 1 });

    vi.clearAllMocks();
    currentRecheckId = SIGNUP_ID;
    mocks.getAdminUser.mockResolvedValue({
      id: ADMIN_ID,
      email: "admin@simplassist.com",
    });
    mocks.from.mockReturnValue(queryBuilder);
    mocks.select.mockReturnValue(queryBuilder);
    mocks.eq.mockImplementation((field: string, value: unknown) => {
      if (field === "id" && typeof value === "string") currentRecheckId = value;
      return queryBuilder;
    });
    mocks.is.mockReturnValue(queryBuilder);
    mocks.maybeSingle.mockImplementation(async () => ({
      data: { id: currentRecheckId },
      error: null,
    }));
    mocks.sendLaunchEmail.mockImplementation(
      senderResult("definite_failure")
    );
    mocks.rpc.mockImplementation(
      async (name: string, args: Record<string, string>) => {
        if (name === "claim_waitlist_launch_send") {
          return {
            data: [
              {
                signup_id: args.p_signup_id,
                signup_email: "claimed-recipient@example.com",
              },
            ],
            error: null,
          };
        }
        return { data: false, error: null };
      }
    );

    const failedRelease = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );
    await expect(failedRelease.json()).resolves.toMatchObject({
      needsReview: 1,
      failed: 0,
    });
  });

  it("binds bulk to unclaimed pending candidates at the cutoff", async () => {
    mocks.range.mockResolvedValueOnce({
      data: [{ id: SIGNUP_ID }, { id: SECOND_SIGNUP_ID }],
      error: null,
    });

    const response = await POST(
      makeRequest({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 2,
        cutoff: CUTOFF,
      })
    );

    await expect(response.json()).resolves.toEqual({
      sent: 2,
      failed: 0,
      skipped: 0,
      needsReview: 0,
    });
    expect(mocks.select.mock.calls.every(([columns]) => columns === "id")).toBe(
      true
    );
    expect(mocks.is).toHaveBeenCalledWith("notified_at", null);
    expect(mocks.is).toHaveBeenCalledWith("unsubscribed_at", null);
    expect(mocks.is).toHaveBeenCalledWith(
      "launch_send_claim_token",
      null
    );
    expect(mocks.lte).toHaveBeenCalledWith("created_at", CUTOFF);
  });

  it("returns 409 on bulk drift before any claim or send", async () => {
    mocks.range.mockResolvedValueOnce({
      data: [{ id: SIGNUP_ID }],
      error: null,
    });

    const response = await POST(
      makeRequest({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 2,
        cutoff: CUTOFF,
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Pending waitlist changed; refresh before sending",
      code: "waitlist_count_drift",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
  });

  it("contains a thrown bulk-query failure before any claim or send", async () => {
    mocks.range.mockRejectedValueOnce(
      new Error("recipient@example.com database-secret")
    );

    const response = await POST(
      makeRequest({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 1,
        cutoff: CUTOFF,
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Couldn’t load pending waitlist recipients",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendLaunchEmail).not.toHaveBeenCalled();
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain("recipient@example.com");
    expect(logs).not.toContain("database-secret");
  });

  it("returns drift on a replay after the first bulk has consumed the candidates", async () => {
    mocks.range
      .mockResolvedValueOnce({
        data: [{ id: SIGNUP_ID }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const payload = {
      action: "bulk",
      confirmation: "SEND",
      expectedCount: 1,
      cutoff: CUTOFF,
    };
    const first = await POST(makeRequest(payload));
    const replay = await POST(makeRequest(payload));

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ sent: 1 });
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({
      code: "waitlist_count_drift",
    });
    expect(mocks.sendLaunchEmail).toHaveBeenCalledTimes(1);
  });

  it("enumerates beyond Supabase's 1000-row response cap before drift checking", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    mocks.range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [{ id: "00000000-0000-4000-8000-000000001000" }],
        error: null,
      });

    const response = await POST(
      makeRequest({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 1_002,
        cutoff: CUTOFF,
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 1_000, 1_999);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports aggregate partial bulk outcomes without recipient data", async () => {
    mocks.range.mockResolvedValueOnce({
      data: [
        { id: SIGNUP_ID },
        { id: SECOND_SIGNUP_ID },
        { id: THIRD_SIGNUP_ID },
      ],
      error: null,
    });
    mocks.sendLaunchEmail
      .mockImplementationOnce(senderResult("accepted"))
      .mockImplementationOnce(senderResult("definite_failure"))
      .mockImplementationOnce(senderResult("ambiguous"));

    const response = await POST(
      makeRequest({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 3,
        cutoff: CUTOFF,
      })
    );
    const body = await response.json();

    expect(body).toEqual({
      sent: 1,
      failed: 1,
      skipped: 0,
      needsReview: 1,
    });
    expect(JSON.stringify(body)).not.toContain("@");
    expect(JSON.stringify(body)).not.toContain(SIGNUP_ID);
    expect(JSON.stringify(body)).not.toContain("claim");
  });

  it("lets one concurrent single claim win and skips the replay", async () => {
    let claimed = false;
    mocks.rpc.mockImplementation(
      async (name: string, args: Record<string, string>) => {
        if (name === "claim_waitlist_launch_send") {
          if (claimed) return { data: [], error: null };
          claimed = true;
          return {
            data: [
              {
                signup_id: args.p_signup_id,
                signup_email: "claimed-recipient@example.com",
              },
            ],
            error: null,
          };
        }
        return { data: true, error: null };
      }
    );

    const [first, second] = await Promise.all([
      POST(makeRequest({ action: "single", signupId: SIGNUP_ID })),
      POST(makeRequest({ action: "single", signupId: SIGNUP_ID })),
    ]);
    const results = await Promise.all([first.json(), second.json()]);

    expect(results).toContainEqual({
      sent: 1,
      failed: 0,
      skipped: 0,
      needsReview: 0,
    });
    expect(results).toContainEqual({
      sent: 0,
      failed: 0,
      skipped: 1,
      needsReview: 0,
    });
    expect(mocks.sendLaunchEmail).toHaveBeenCalledTimes(1);
  });

  it("rejects future bulk cutoffs and contains database/provider secrets in logs", async () => {
    const futureResponse = await POST(
      makeRequest({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 0,
        cutoff: "2999-01-01T00:00:00.000Z",
      })
    );
    expect(futureResponse.status).toBe(400);

    mocks.rpc.mockRejectedValueOnce(
      new Error("claimed-recipient@example.com claim-token-secret")
    );
    const failedResponse = await POST(
      makeRequest({ action: "single", signupId: SIGNUP_ID })
    );
    await expect(failedResponse.json()).resolves.toMatchObject({ failed: 1 });
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain("claimed-recipient@example.com");
    expect(logs).not.toContain("claim-token-secret");
  });
});
