import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  beginProviderCreateIntent,
  ProviderCreateReconciliationRequiredError,
  resolveProviderCreateIntent,
  resolveProviderCreateIntentForPayload,
  resolveProviderCreateIntents,
} from "./providerCreateIntent";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000351";
const INTENT_ID = "10000000-0000-4000-8000-000000000351";
const OTHER_INTENT_ID = "20000000-0000-4000-8000-000000000351";
const SPEC = {
  eventType: "messaging_profile_create_intent",
  resourceType: "messaging_profile",
} as const;
const PHONE_NUMBER = "+15749318431";
const PHONE_SPEC = {
  eventType: "phone_number_order_create_intent",
  resourceType: "phone_number",
} as const;

type QueryChain = Record<string, ReturnType<typeof vi.fn>>;
const chains: QueryChain[] = [];

function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: QueryChain = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "eq",
      "order",
      "limit",
      "maybeSingle",
      "single",
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
  chains.length = 0;
});

describe("provider create intent fence", () => {
  it("persists and verifies the oldest intent before authorizing a provider create", async () => {
    queueResults(
      { data: null, error: null },
      { data: { id: INTENT_ID }, error: null },
      { data: { id: INTENT_ID }, error: null }
    );

    await expect(
      beginProviderCreateIntent({ businessId: BUSINESS_ID, spec: SPEC })
    ).resolves.toBe(INTENT_ID);

    expect(mocks.from).toHaveBeenCalledTimes(3);
    expect(mocks.from).toHaveBeenNthCalledWith(1, "telnyx_registration_events");
    expect(chains[1].insert).toHaveBeenCalledWith({
      business_id: BUSINESS_ID,
      event_type: SPEC.eventType,
      telnyx_resource_type: SPEC.resourceType,
      status: "started",
      raw_payload: { version: 1 },
    });
    expect(chains[2].order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: true,
    });
    expect(chains[2].order).toHaveBeenNthCalledWith(2, "id", {
      ascending: true,
    });
  });

  it("fails closed on an unresolved prior intent without inserting another", async () => {
    queueResults({ data: { id: INTENT_ID }, error: null });

    await expect(
      beginProviderCreateIntent({ businessId: BUSINESS_ID, spec: SPEC })
    ).rejects.toBeInstanceOf(ProviderCreateReconciliationRequiredError);

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(chains[0].insert).not.toHaveBeenCalled();
  });

  it("fails closed when the database unique fence rejects a contender", async () => {
    queueResults(
      { data: null, error: null },
      { data: null, error: { message: "duplicate key value" } }
    );

    await expect(
      beginProviderCreateIntent({ businessId: BUSINESS_ID, spec: SPEC })
    ).rejects.toThrow("Could not persist messaging_profile create intent");

    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("rejects a contender that is not the deterministic oldest owner", async () => {
    queueResults(
      { data: null, error: null },
      { data: { id: INTENT_ID }, error: null },
      { data: { id: OTHER_INTENT_ID }, error: null }
    );

    await expect(
      beginProviderCreateIntent({ businessId: BUSINESS_ID, spec: SPEC })
    ).rejects.toBeInstanceOf(ProviderCreateReconciliationRequiredError);
  });

  it("resolves only started intents for the exact business and resource kind", async () => {
    queueResults({ error: null });

    await expect(
      resolveProviderCreateIntents({ businessId: BUSINESS_ID, spec: SPEC })
    ).resolves.toBeUndefined();

    expect(chains[0].update).toHaveBeenCalledWith({ status: "resolved" });
    expect(chains[0].eq).toHaveBeenNthCalledWith(1, "business_id", BUSINESS_ID);
    expect(chains[0].eq).toHaveBeenNthCalledWith(2, "event_type", SPEC.eventType);
    expect(chains[0].eq).toHaveBeenNthCalledWith(3, "status", "started");
  });

  it("stores exact phone-number order payload before authorizing a paid POST", async () => {
    queueResults(
      { data: null, error: null },
      { data: { id: INTENT_ID }, error: null },
      { data: { id: INTENT_ID }, error: null }
    );

    await beginProviderCreateIntent({
      businessId: BUSINESS_ID,
      spec: PHONE_SPEC,
      rawPayload: { phoneNumber: PHONE_NUMBER },
    });

    expect(chains[1].insert).toHaveBeenCalledWith({
      business_id: BUSINESS_ID,
      event_type: PHONE_SPEC.eventType,
      telnyx_resource_type: PHONE_SPEC.resourceType,
      status: "started",
      raw_payload: { phoneNumber: PHONE_NUMBER, version: 1 },
    });
  });

  it("resolves a definite provider rejection by exact intent id", async () => {
    queueResults({ data: { id: INTENT_ID }, error: null });

    await resolveProviderCreateIntent({
      businessId: BUSINESS_ID,
      spec: PHONE_SPEC,
      intentId: INTENT_ID,
    });

    expect(chains[0].update).toHaveBeenCalledWith({ status: "resolved" });
    expect(chains[0].eq).toHaveBeenNthCalledWith(1, "id", INTENT_ID);
    expect(chains[0].eq).toHaveBeenNthCalledWith(2, "business_id", BUSINESS_ID);
    expect(chains[0].eq).toHaveBeenNthCalledWith(
      3,
      "event_type",
      PHONE_SPEC.eventType
    );
    expect(chains[0].eq).toHaveBeenNthCalledWith(
      4,
      "telnyx_resource_type",
      PHONE_SPEC.resourceType
    );
    expect(chains[0].eq).toHaveBeenNthCalledWith(5, "status", "started");
  });

  it("resolves recovered ownership only for an intent carrying the same phone number", async () => {
    queueResults(
      {
        data: {
          id: INTENT_ID,
          raw_payload: { version: 1, phoneNumber: PHONE_NUMBER },
        },
        error: null,
      },
      { data: { id: INTENT_ID }, error: null }
    );

    await resolveProviderCreateIntentForPayload({
      businessId: BUSINESS_ID,
      spec: PHONE_SPEC,
      expectedPayload: { version: 1, phoneNumber: PHONE_NUMBER },
    });

    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(chains[1].eq).toHaveBeenNthCalledWith(1, "id", INTENT_ID);
  });

  it.each([
    { version: 1, phoneNumber: "+15745559999" },
    { phoneNumber: PHONE_NUMBER },
    { version: 2, phoneNumber: PHONE_NUMBER },
  ])("keeps a mismatched or unclassified intent fail-closed", async (rawPayload) => {
    queueResults({
      data: {
        id: INTENT_ID,
        raw_payload: rawPayload,
      },
      error: null,
    });

    await expect(
      resolveProviderCreateIntentForPayload({
        businessId: BUSINESS_ID,
        spec: PHONE_SPEC,
        expectedPayload: { version: 1, phoneNumber: PHONE_NUMBER },
      })
    ).rejects.toBeInstanceOf(ProviderCreateReconciliationRequiredError);

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(chains[0].update).not.toHaveBeenCalled();
  });

  it("accepts a concurrent exact resolution only after proving the row is resolved", async () => {
    queueResults(
      { data: null, error: null },
      { data: { id: INTENT_ID, status: "resolved" }, error: null }
    );

    await expect(
      resolveProviderCreateIntent({
        businessId: BUSINESS_ID,
        spec: PHONE_SPEC,
        intentId: INTENT_ID,
      })
    ).resolves.toBeUndefined();

    expect(chains[1].select).toHaveBeenCalledWith("id, status");
  });

  it("fails closed when an exact resolve updates no row and cannot prove resolution", async () => {
    queueResults(
      { data: null, error: null },
      { data: { id: INTENT_ID, status: "started" }, error: null }
    );

    await expect(
      resolveProviderCreateIntent({
        businessId: BUSINESS_ID,
        spec: PHONE_SPEC,
        intentId: INTENT_ID,
      })
    ).rejects.toThrow("intent was not resolved");
  });
});
