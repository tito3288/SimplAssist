import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { markRegistrationSubmitted } from "./registrationAttempt";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";
const STARTED_AT = "2026-08-28T12:00:00.000Z";

const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
      "select",
      "update",
      "eq",
      "is",
      "maybeSingle",
      "returns",
    ]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    Object.assign(chain, {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    });
    chains.push(chain);
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markRegistrationSubmitted", () => {
  it("completes only the exact submitting claim", async () => {
    queueResults({
      data: {
        id: BUSINESS_ID,
        onboarding_registration_status: "submitted",
        onboarding_registration_started_at: STARTED_AT,
        onboarding_registration_submitted_at: "2026-08-28T12:01:00.000Z",
        onboarding_registration_error: null,
      },
      error: null,
    });

    await expect(
      markRegistrationSubmitted(BUSINESS_ID, STARTED_AT),
    ).resolves.toEqual({ completed: true });

    expect(chains).toHaveLength(1);
    expect(chains[0].eq).toHaveBeenCalledWith("id", BUSINESS_ID);
    expect(chains[0].eq).toHaveBeenCalledWith(
      "onboarding_registration_status",
      "submitting",
    );
    expect(chains[0].eq).toHaveBeenCalledWith(
      "onboarding_registration_started_at",
      STARTED_AT,
    );
  });

  it("returns the current row when a rejection wins the completion CAS", async () => {
    const rejectionRow = {
      id: BUSINESS_ID,
      onboarding_registration_status: "failed",
      onboarding_registration_started_at: STARTED_AT,
      onboarding_registration_submitted_at: null,
      onboarding_registration_error: "Exact carrier rejection reason",
    };
    queueResults(
      { data: null, error: null },
      { data: rejectionRow, error: null },
    );

    await expect(
      markRegistrationSubmitted(BUSINESS_ID, STARTED_AT),
    ).resolves.toEqual({ completed: false, current: rejectionRow });

    expect(chains).toHaveLength(2);
    expect(chains[1].select).toHaveBeenCalledWith(
      expect.stringContaining("onboarding_registration_error"),
    );
    expect(chains[1].eq).toHaveBeenCalledWith("id", BUSINESS_ID);
  });

  it("fails closed when the exact completion update errors", async () => {
    queueResults({ data: null, error: { message: "database unavailable" } });

    await expect(
      markRegistrationSubmitted(BUSINESS_ID, STARTED_AT),
    ).rejects.toThrow("Failed to mark registration submitted");

    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
