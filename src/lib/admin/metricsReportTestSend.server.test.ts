import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  render: vi.fn(),
  send: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
vi.mock("@/lib/email/metricsReportRenderer", () => ({
  renderMetricsReportEmail: mocks.render,
}));
vi.mock("@/lib/email/metricsReportSender", () => ({
  sendMetricsReportTestEmail: mocks.send,
}));

import {
  ADMIN_METRICS_REPORT_PREVIEW_RPC,
  sendAdminMetricsReportTest,
} from "./metricsReportTestSend.server";

const CONFIG_ID = "10000000-0000-4000-a051-000000000001";
const TEST_EMAIL = "bryan+metrics@example.com";

const METRIC_KEYS = [
  "ai_conversation_engaged",
  "booking_confirmed",
  "contact_created",
  "hot_lead_classified",
  "missed_call_caught",
  "mms_event_inbound",
  "mms_event_outbound",
  "sms_message_inbound",
  "sms_message_outbound",
  "sms_parts_inbound",
  "sms_parts_outbound",
  "web_chat_session_engaged",
] as const;

const ZERO_COUNTS = {
  ai_conversation_engaged: 0,
  booking_confirmed: 0,
  booking_confirmed_ai: 0,
  booking_confirmed_dashboard: 0,
  contact_created: 0,
  hot_lead_classified: 0,
  missed_call_caught: 0,
  mms_event_inbound: 0,
  mms_event_outbound: 0,
  sms_message_inbound: 0,
  sms_message_outbound: 0,
  sms_parts_inbound: 0,
  sms_parts_outbound: 0,
  web_chat_session_engaged: 0,
};

function validPayload() {
  return {
    period: {
      month: "2026-12",
      start: "2026-12-01T00:00:00+00:00",
      end_exclusive: "2027-01-01T00:00:00+00:00",
    },
    scope: {
      kind: "direct" as const,
      partner_id: null,
      brand_name: "SimplAssist" as const,
      partner_slug: null,
    },
    selection: { mode: "all" as const, business_ids: [] },
    definitions: METRIC_KEYS.map((metric_key) => ({
      metric_key,
      definition_version: 1 as const,
      available_since: "2026-07-14T12:00:00+00:00",
      supports_historical_backfill: ![
        "ai_conversation_engaged",
        "missed_call_caught",
        "web_chat_session_engaged",
      ].includes(metric_key),
    })),
    totals: { ...ZERO_COUNTS },
    businesses: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => {
    throw new Error("test send must not access a ledger table");
  });
  mocks.rpc.mockResolvedValue({ data: validPayload(), error: null });
  mocks.render.mockReturnValue({
    subject: "[TEST] SimplAssist — December 2026 SimplAssist activity report",
    text: "count-only text",
    html: "<p>count-only html</p>",
  });
  mocks.send.mockResolvedValue({
    kind: "accepted",
    providerMessageId: "provider-id-must-not-escape",
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("sendAdminMetricsReportTest", () => {
  it("previews the previous UTC month and sends exactly one in-memory test", async () => {
    await expect(
      sendAdminMetricsReportTest({
        configId: CONFIG_ID,
        email: TEST_EMAIL,
        now: new Date("2027-01-15T18:30:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "accepted" });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(ADMIN_METRICS_REPORT_PREVIEW_RPC, {
      p_config_id: CONFIG_ID,
      p_period_start: "2026-12-01",
    });
    expect(mocks.render).toHaveBeenCalledWith(validPayload(), { test: true });
    expect(mocks.send).toHaveBeenCalledWith({
      message: {
        to: TEST_EMAIL,
        subject:
          "[TEST] SimplAssist — December 2026 SimplAssist activity report",
        text: "count-only text",
        html: "<p>count-only html</p>",
      },
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not apply an enabled gate before previewing a saved config", async () => {
    const preview = vi.fn().mockResolvedValue(validPayload());
    const send = vi.fn().mockResolvedValue({
      kind: "accepted",
      providerMessageId: "provider-id",
    });

    await sendAdminMetricsReportTest(
      {
        configId: CONFIG_ID,
        email: TEST_EMAIL,
        now: new Date("2027-01-01T00:00:00.000Z"),
      },
      { preview, send },
    );

    expect(preview).toHaveBeenCalledWith({
      configId: CONFIG_ID,
      periodStart: "2026-12-01",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not let renderer output override the sole entered recipient", async () => {
    mocks.render.mockReturnValue({
      to: "attacker@example.com",
      subject: "[TEST] Safe subject",
      text: "Safe text",
      html: "<p>Safe HTML</p>",
    });

    await sendAdminMetricsReportTest({
      configId: CONFIG_ID,
      email: TEST_EMAIL,
      now: new Date("2027-01-15T00:00:00.000Z"),
    });

    expect(mocks.send).toHaveBeenCalledWith({
      message: {
        to: TEST_EMAIL,
        subject: "[TEST] Safe subject",
        text: "Safe text",
        html: "<p>Safe HTML</p>",
      },
    });
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain(
      "attacker@example.com",
    );
  });

  it.each([
    [{ kind: "accepted", providerMessageId: "provider-id" }, "accepted"],
    [
      { kind: "definite_no_send", errorCode: "provider_invalid_request" },
      "failed",
    ],
    [{ kind: "ambiguous", errorCode: "provider_timeout" }, "needs_review"],
  ] as const)("maps provider outcome %j to %s", async (provider, outcome) => {
    mocks.send.mockResolvedValue(provider);

    await expect(
      sendAdminMetricsReportTest({
        configId: CONFIG_ID,
        email: TEST_EMAIL,
        now: new Date("2027-01-15T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ outcome });
  });

  it("returns no provider message ID or report identity on acceptance", async () => {
    const result = await sendAdminMetricsReportTest({
      configId: CONFIG_ID,
      email: TEST_EMAIL,
      now: new Date("2027-01-15T00:00:00.000Z"),
    });

    expect(result).toEqual({ outcome: "accepted" });
    expect(JSON.stringify(result)).not.toContain("provider-id");
    expect(Object.keys(result)).toEqual(["outcome"]);
  });

  it("fails closed before rendering or sending an invalid preview payload", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...validPayload(), recipient: TEST_EMAIL },
      error: null,
    });

    await expect(
      sendAdminMetricsReportTest({
        configId: CONFIG_ID,
        email: TEST_EMAIL,
        now: new Date("2027-01-15T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "invalid_snapshot",
      status: 500,
    });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[admin:metrics-report-test-send] invalid snapshot payload",
    );
  });

  it("maps only the exact not-found sentinel and never logs raw RPC errors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "metrics_report_config_not_found" },
    });

    await expect(
      sendAdminMetricsReportTest({
        configId: CONFIG_ID,
        email: TEST_EMAIL,
        now: new Date("2027-01-15T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "config_not_found",
      status: 404,
    });
    expect(console.error).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "XX000",
        message: `${TEST_EMAIL} raw-database-secret`,
      },
    });
    await expect(
      sendAdminMetricsReportTest({
        configId: CONFIG_ID,
        email: TEST_EMAIL,
        now: new Date("2027-01-15T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "preview_failed",
      status: 500,
    });

    const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logs).toContain("preview failed");
    expect(logs).not.toContain(TEST_EMAIL);
    expect(logs).not.toContain("raw-database-secret");
  });
});
