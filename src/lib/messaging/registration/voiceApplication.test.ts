import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  from: vi.fn(),
  appendRegistrationEvent: vi.fn(),
  beginProviderCreateIntent: vi.fn(),
  resolveProviderCreateIntents: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    callControlApplications: {
      list: mocks.list,
      create: mocks.create,
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("./audit", () => ({
  appendRegistrationEvent: mocks.appendRegistrationEvent,
  serializeError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));
vi.mock("./providerCreateIntent", () => ({
  beginProviderCreateIntent: mocks.beginProviderCreateIntent,
  resolveProviderCreateIntents: mocks.resolveProviderCreateIntents,
}));

import { createVoiceApplication } from "./voiceApplication";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000371";
const APPLICATION_ID = "12345678901";
const SECOND_APPLICATION_ID = "12345678902";
const INTENT_ID = "30000000-0000-4000-8000-000000000371";

const business = {
  id: BUSINESS_ID,
  name: "Test Business",
  legal_business_name: "Test Business LLC",
  telnyx_voice_application_id: null,
};

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
      "update",
      "eq",
      "is",
      "single",
      "maybeSingle",
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

function asyncItems(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function setApplications(items: unknown[]) {
  mocks.list.mockImplementation(() => asyncItems(items));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test/");
  setApplications([]);
  mocks.beginProviderCreateIntent.mockResolvedValue(INTENT_ID);
  mocks.resolveProviderCreateIntents.mockResolvedValue(undefined);
  mocks.appendRegistrationEvent.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ data: { id: APPLICATION_ID } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createVoiceApplication recover-before-create", () => {
  it("creates once behind an intent and disables unkeyed SDK retries", async () => {
    queueResults(
      { data: business, error: null },
      { data: { telnyx_voice_application_id: null }, error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );

    await createVoiceApplication(BUSINESS_ID);

    expect(mocks.beginProviderCreateIntent).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      spec: {
        eventType: "voice_application_create_intent",
        resourceType: "voice_application",
      },
    });
    expect(mocks.create).toHaveBeenCalledWith(
      {
        application_name: `Test Business LLC (${BUSINESS_ID})`,
        webhook_event_url: "https://app.example.test/api/messaging/voice",
        webhook_event_failover_url:
          "https://app.example.test/api/messaging/voice",
      },
      { maxRetries: 0 }
    );
    expect(chains[2].update).toHaveBeenCalledWith({
      telnyx_voice_application_id: APPLICATION_ID,
    });
    expect(mocks.resolveProviderCreateIntents).toHaveBeenCalledTimes(1);
  });

  it("recovers one exact business-suffixed application without a second create", async () => {
    queueResults(
      { data: business, error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );
    setApplications([
      {
        id: SECOND_APPLICATION_ID,
        application_name: `Contains ${BUSINESS_ID} but not exact`,
      },
      {
        id: `  ${APPLICATION_ID}  `,
        application_name: `Test (${BUSINESS_ID})`,
      },
    ]);

    await createVoiceApplication(BUSINESS_ID);

    expect(mocks.list).toHaveBeenCalledWith({
      filter: { application_name: { contains: BUSINESS_ID } },
    });
    expect(mocks.beginProviderCreateIntent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(chains[1].update).toHaveBeenCalledWith({
      telnyx_voice_application_id: APPLICATION_ID,
    });
    expect(mocks.appendRegistrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "voice_application_created",
        resourceId: APPLICATION_ID,
        status: "success",
        rawPayload: {
          _recovery: {
            source: "telnyx_call_control_application_list",
            businessIdSuffixMatched: true,
          },
        },
      })
    );
  });

  it("recovers a provider success after a local-save failure without creating twice", async () => {
    queueResults(
      { data: business, error: null },
      { data: { telnyx_voice_application_id: null }, error: null },
      { data: null, error: { message: "database unavailable" } }
    );

    await expect(createVoiceApplication(BUSINESS_ID)).rejects.toThrow(
      "Failed to persist application id"
    );

    queueResults(
      { data: business, error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );
    setApplications([
      {
        id: APPLICATION_ID,
        application_name: `Test Business LLC (${BUSINESS_ID})`,
      },
    ]);

    await expect(createVoiceApplication(BUSINESS_ID)).resolves.toBeUndefined();

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.beginProviderCreateIntent).toHaveBeenCalledTimes(1);
    expect(mocks.resolveProviderCreateIntents).toHaveBeenCalledTimes(1);
  });

  it("retries a post-persistence intent-resolution failure without creating twice", async () => {
    queueResults(
      { data: business, error: null },
      { data: { telnyx_voice_application_id: null }, error: null },
      { data: { id: BUSINESS_ID }, error: null }
    );
    mocks.resolveProviderCreateIntents
      .mockRejectedValueOnce(new Error("intent resolution unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(createVoiceApplication(BUSINESS_ID)).rejects.toThrow(
      "intent resolution unavailable"
    );

    queueResults({
      data: { ...business, telnyx_voice_application_id: APPLICATION_ID },
      error: null,
    });
    await expect(createVoiceApplication(BUSINESS_ID)).resolves.toBeUndefined();

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.beginProviderCreateIntent).toHaveBeenCalledTimes(1);
    expect(mocks.resolveProviderCreateIntents).toHaveBeenCalledTimes(2);
  });

  it("does not create when another attempt persisted the pointer after the intent", async () => {
    queueResults(
      { data: business, error: null },
      { data: { telnyx_voice_application_id: APPLICATION_ID }, error: null }
    );

    await createVoiceApplication(BUSINESS_ID);

    expect(mocks.beginProviderCreateIntent).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.resolveProviderCreateIntents).toHaveBeenCalledTimes(1);
  });

  it("uses a saved pointer idempotently and resolves any leftover intent", async () => {
    queueResults({
      data: { ...business, telnyx_voice_application_id: APPLICATION_ID },
      error: null,
    });

    await createVoiceApplication(BUSINESS_ID);

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.beginProviderCreateIntent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.resolveProviderCreateIntents).toHaveBeenCalledTimes(1);
  });

  it("fails closed on ambiguous exact recovery matches", async () => {
    queueResults({ data: business, error: null });
    setApplications([
      { id: APPLICATION_ID, application_name: `First (${BUSINESS_ID})` },
      {
        id: SECOND_APPLICATION_ID,
        application_name: `Second (${BUSINESS_ID})`,
      },
    ]);

    await expect(createVoiceApplication(BUSINESS_ID)).rejects.toThrow(
      "More than one Telnyx application matches"
    );

    expect(mocks.beginProviderCreateIntent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed id for an exact recovery match", async () => {
    queueResults({ data: business, error: null });
    setApplications([
      { id: "voice-app-id", application_name: `Test (${BUSINESS_ID})` },
    ]);

    await expect(createVoiceApplication(BUSINESS_ID)).rejects.toThrow(
      "Could not check Telnyx for an existing application"
    );

    expect(mocks.beginProviderCreateIntent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("honors an unresolved-intent denial before a provider POST", async () => {
    queueResults({ data: business, error: null });
    mocks.beginProviderCreateIntent.mockRejectedValue(
      new Error("unresolved provider attempt")
    );

    await expect(createVoiceApplication(BUSINESS_ID)).rejects.toThrow(
      "unresolved provider attempt"
    );

    expect(mocks.create).not.toHaveBeenCalled();
  });
});
