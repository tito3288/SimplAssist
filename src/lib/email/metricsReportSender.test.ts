import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  sendBusinessEmail: vi.fn(),
  randomUUID: vi.fn(),
  from: "SimplAssist <notifications@simplassist.com>",
}));

vi.mock("server-only", () => ({}));
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, randomUUID: mocks.randomUUID };
});
vi.mock("./client", () => ({
  resend: { emails: { send: mocks.send } },
  get RESEND_FROM() {
    return mocks.from;
  },
}));
vi.mock("./sender", () => ({
  sendBusinessEmail: mocks.sendBusinessEmail,
}));

import {
  METRICS_REPORT_PROVIDER_TIMEOUT_MS,
  type MetricsReportEmailMessage,
  sendMetricsReportEmail,
  sendMetricsReportTestEmail,
} from "./metricsReportSender";

const DELIVERY_ID = "4f3e6823-e07c-4b7f-a643-ff0c2625850d";
const TEST_KEY_UUID_1 = "62cc7e29-ebbf-41c7-b9c5-ef3aa8dca312";
const TEST_KEY_UUID_2 = "a8e662f4-85da-4d76-9f3f-b7d1cf6b5074";
const MESSAGE: MetricsReportEmailMessage = {
  to: "admin@example.com",
  subject: "SimplAssist — July 2026 SimplAssist activity report",
  text: "Frozen monthly counts. private-text-marker",
  html: "<p>Frozen monthly counts. private-html-marker</p>",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from = "SimplAssist <notifications@simplassist.com>";
  mocks.randomUUID.mockReturnValue(TEST_KEY_UUID_1);
  mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("metrics report provider sender", () => {
  it("sends one durable admin recipient directly through Resend with RESEND_FROM", async () => {
    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "accepted",
      providerMessageId: "email-1",
    });

    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(
      {
        from: "SimplAssist <notifications@simplassist.com>",
        to: ["admin@example.com"],
        subject: MESSAGE.subject,
        text: MESSAGE.text,
        html: MESSAGE.html,
      },
      {
        idempotencyKey: `metrics-report-v1/${DELIVERY_ID}`,
        signal: expect.any(AbortSignal),
      },
    );
    expect(mocks.sendBusinessEmail).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("keeps the durable idempotency key stable across exact retries", async () => {
    mocks.send
      .mockResolvedValueOnce({ data: { id: "email-1" }, error: null })
      .mockResolvedValueOnce({ data: { id: "email-1" }, error: null });

    await sendMetricsReportEmail({
      deliveryId: ` ${DELIVERY_ID.toUpperCase()} `,
      message: MESSAGE,
    });
    await sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE });

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(
      [`metrics-report-v1/${DELIVERY_ID}`, `metrics-report-v1/${DELIVERY_ID}`],
    );
  });

  it("uses a fresh random test idempotency key for every test send", async () => {
    mocks.randomUUID
      .mockReturnValueOnce(TEST_KEY_UUID_1)
      .mockReturnValueOnce(TEST_KEY_UUID_2);

    await sendMetricsReportTestEmail({ message: MESSAGE });
    await sendMetricsReportTestEmail({ message: MESSAGE });

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(
      [
        `metrics-report-test-v1/${TEST_KEY_UUID_1}`,
        `metrics-report-test-v1/${TEST_KEY_UUID_2}`,
      ],
    );
    expect(mocks.send.mock.calls.map((call) => call[0].to)).toEqual([
      [MESSAGE.to],
      [MESSAGE.to],
    ]);
  });

  it("does not let a runtime From field override RESEND_FROM", async () => {
    const messageWithInjectedFrom = {
      ...MESSAGE,
      from: "attacker@example.com",
    } as MetricsReportEmailMessage;

    await sendMetricsReportEmail({
      deliveryId: DELIVERY_ID,
      message: messageWithInjectedFrom,
    });

    expect(mocks.send.mock.calls[0][0].from).toBe(
      "SimplAssist <notifications@simplassist.com>",
    );
  });

  it("normalizes a nonblank provider ID before returning acceptance", async () => {
    mocks.send.mockResolvedValue({ data: { id: "  email-1  " }, error: null });

    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "accepted",
      providerMessageId: "email-1",
    });
  });

  it.each([
    ["missing_required_field", "provider_invalid_request"],
    ["invalid_idempotency_key", "provider_invalid_request"],
    ["invalid_parameter", "provider_invalid_request"],
    ["invalid_region", "provider_invalid_request"],
    ["invalid_from_address", "provider_invalid_request"],
    ["invalid_attachment", "provider_invalid_request"],
    ["validation_error", "provider_invalid_request"],
    ["restricted_api_key", "provider_auth_rejected"],
    ["invalid_api_key", "provider_auth_rejected"],
    ["invalid_api_Key", "provider_auth_rejected"],
    ["invalid_access", "provider_auth_rejected"],
    ["missing_api_key", "provider_auth_rejected"],
    ["rate_limit_exceeded", "provider_rate_limited"],
    ["daily_quota_exceeded", "provider_quota_exceeded"],
    ["monthly_quota_exceeded", "provider_quota_exceeded"],
    ["not_found", "provider_not_found"],
    ["method_not_allowed", "provider_method_not_allowed"],
    ["security_error", "provider_security_rejected"],
  ] as const)(
    "maps returned provider rejection %s to bounded definite code %s",
    async (name, errorCode) => {
      mocks.send.mockResolvedValue({
        data: null,
        error: {
          name,
          message: `${MESSAGE.to} private-provider-secret private-text-marker`,
        },
      });

      await expect(
        sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
      ).resolves.toEqual({ kind: "definite_no_send", errorCode });

      const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logs).toContain("definite_no_send");
      expect(logs).toContain(errorCode);
      expect(logs).not.toContain(MESSAGE.to);
      expect(logs).not.toContain("private-provider-secret");
      expect(logs).not.toContain("private-text-marker");
    },
  );

  it.each([
    "application_error",
    "internal_server_error",
    "concurrent_idempotent_requests",
    "invalid_idempotent_request",
    "future_provider_error",
  ])("keeps returned provider rejection %s ambiguous", async (name) => {
    mocks.send.mockResolvedValue({
      data: null,
      error: {
        name,
        message: `${MESSAGE.to} private-provider-secret private-html-marker`,
      },
    });

    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "ambiguous",
      errorCode: "provider_rejection_ambiguous",
    });

    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).toContain("ambiguous");
    expect(logs).not.toContain(MESSAGE.to);
    expect(logs).not.toContain("private-provider-secret");
    expect(logs).not.toContain("private-html-marker");
  });

  it.each([
    undefined,
    null,
    {},
    { id: "" },
    { id: "   " },
    { id: 42 },
    { id: "email\n1" },
    { id: "e".repeat(256) },
  ])("treats malformed provider acceptance %j as ambiguous", async (data) => {
    mocks.send.mockResolvedValue({ data, error: null });

    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "ambiguous",
      errorCode: "provider_response_invalid",
    });
  });

  it.each([
    undefined,
    null,
    {},
    { data: { id: "email-1" } },
    { data: { id: "email-1" }, error: false },
    {
      data: { id: "email-1" },
      error: { name: "validation_error" },
    },
  ])(
    "contains malformed whole provider response %j as ambiguous",
    async (response) => {
      mocks.send.mockResolvedValue(response);

      await expect(
        sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
      ).resolves.toEqual({
        kind: "ambiguous",
        errorCode: "provider_response_invalid",
      });
    },
  );

  it.each([
    new Error("admin@example.com private-provider-secret"),
    "admin@example.com private-provider-secret",
    { message: "admin@example.com private-provider-secret" },
  ])("contains a thrown provider outcome as ambiguous", async (failure) => {
    mocks.send.mockRejectedValue(failure);

    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "ambiguous",
      errorCode: "provider_request_failed",
    });

    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(MESSAGE.to);
    expect(logs).not.toContain("private-provider-secret");
  });

  it("aborts at the 15-second provider deadline and returns ambiguity", async () => {
    vi.useFakeTimers();
    mocks.send.mockImplementation(
      (_message, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new Error(`${MESSAGE.to} abort-provider-secret`));
          });
        }),
    );

    const pending = sendMetricsReportEmail({
      deliveryId: DELIVERY_ID,
      message: MESSAGE,
    });
    const signal = mocks.send.mock.calls[0][1].signal as AbortSignal;

    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(METRICS_REPORT_PROVIDER_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({
      kind: "ambiguous",
      errorCode: "provider_timeout",
    });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(MESSAGE.to);
    expect(logs).not.toContain("abort-provider-secret");
  });

  it("returns at the deadline when the provider ignores abort and contains a late rejection", async () => {
    vi.useFakeTimers();
    let rejectProvider!: (error: unknown) => void;
    mocks.send.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectProvider = reject;
        }),
    );

    const pending = sendMetricsReportEmail({
      deliveryId: DELIVERY_ID,
      message: MESSAGE,
    });
    const signal = mocks.send.mock.calls[0][1].signal as AbortSignal;

    await vi.advanceTimersByTimeAsync(METRICS_REPORT_PROVIDER_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({
      kind: "ambiguous",
      errorCode: "provider_timeout",
    });
    expect(signal.aborted).toBe(true);

    rejectProvider(new Error(`${MESSAGE.to} late-private-provider-rejection`));
    await Promise.resolve();
    await Promise.resolve();

    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(MESSAGE.to);
    expect(logs).not.toContain("late-private-provider-rejection");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the provider deadline after an immediate acceptance", async () => {
    vi.useFakeTimers();

    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "accepted",
      providerMessageId: "email-1",
    });

    const signal = mocks.send.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(METRICS_REPORT_PROVIDER_TIMEOUT_MS);
    expect(signal.aborted).toBe(false);
  });

  it.each([
    ["invalid delivery ID", "not-a-uuid", MESSAGE],
    ["blank recipient", DELIVERY_ID, { ...MESSAGE, to: " " }],
    ["blank subject", DELIVERY_ID, { ...MESSAGE, subject: "" }],
    ["blank text", DELIVERY_ID, { ...MESSAGE, text: "" }],
    ["blank HTML", DELIVERY_ID, { ...MESSAGE, html: "" }],
  ] as const)(
    "returns a definite no-send before provider work for %s",
    async (_label, deliveryId, message) => {
      await expect(
        sendMetricsReportEmail({ deliveryId, message }),
      ).resolves.toEqual({
        kind: "definite_no_send",
        errorCode: "invalid_sender_input",
      });
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("fails definitely before provider work when RESEND_FROM is blank", async () => {
    mocks.from = "   ";

    await expect(
      sendMetricsReportEmail({ deliveryId: DELIVERY_ID, message: MESSAGE }),
    ).resolves.toEqual({
      kind: "definite_no_send",
      errorCode: "sender_not_configured",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("contains test-key construction failure before provider work", async () => {
    mocks.randomUUID.mockImplementation(() => {
      throw new Error(`${MESSAGE.to} private-random-failure`);
    });

    await expect(
      sendMetricsReportTestEmail({ message: MESSAGE }),
    ).resolves.toEqual({
      kind: "definite_no_send",
      errorCode: "sender_internal_error",
    });
    expect(mocks.send).not.toHaveBeenCalled();
    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).not.toContain(MESSAGE.to);
    expect(logs).not.toContain("private-random-failure");
  });
});
