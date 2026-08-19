import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildWidgetChatRequestFingerprint,
  buildWidgetLeadSubmissionFingerprint,
  buildWidgetMessageFingerprint,
  buildWidgetSourceProviderEventId,
} from "./idempotency.server";

const REQUEST = {
  businessId: "00000000-0000-4000-8000-000000000001",
  origin: "https://allowed.example",
  sessionId: "00000000-0000-4000-8000-000000000002",
  clientMessageId: "00000000-0000-4000-8000-000000000003",
  message: "Can I book tomorrow?",
  visitorEmail: "pat@example.com",
  visitorName: "Pat",
};

describe("buildWidgetChatRequestFingerprint", () => {
  it("is deterministic and content-free", () => {
    const first = buildWidgetChatRequestFingerprint(REQUEST);
    const second = buildWidgetChatRequestFingerprint({ ...REQUEST });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(REQUEST.message);
    expect(first).not.toContain(REQUEST.visitorEmail);
  });

  it.each([
    ["origin", { origin: "https://other.example" }],
    ["session", { sessionId: "00000000-0000-4000-8000-000000000004" }],
    ["message id", { clientMessageId: "00000000-0000-4000-8000-000000000005" }],
    ["message", { message: "A different request" }],
    ["email", { visitorEmail: "other@example.com" }],
    ["name", { visitorName: "Other" }],
  ])("changes when immutable %s changes", (_label, patch) => {
    expect(
      buildWidgetChatRequestFingerprint({ ...REQUEST, ...patch }),
    ).not.toBe(buildWidgetChatRequestFingerprint(REQUEST));
  });
});

describe("widget durable identity proofs", () => {
  it("derives a stable content-free source provider id", () => {
    const id = buildWidgetSourceProviderEventId({
      businessId: REQUEST.businessId,
      clientMessageId: REQUEST.clientMessageId,
    });
    expect(id).toMatch(/^widget:[0-9a-f]{64}$/);
    expect(id).not.toContain(REQUEST.businessId);
    expect(id).not.toContain(REQUEST.clientMessageId);
  });

  it("hashes the exact persisted message text", () => {
    expect(buildWidgetMessageFingerprint(REQUEST.message)).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(buildWidgetMessageFingerprint(`${REQUEST.message} `)).not.toBe(
      buildWidgetMessageFingerprint(REQUEST.message),
    );
  });

  it("binds offline lead proof to source, identity, and contact fields", () => {
    const input = {
      businessId: REQUEST.businessId,
      sessionId: REQUEST.sessionId,
      clientLeadId: "00000000-0000-4000-8000-000000000006",
      sourceClientMessageId: REQUEST.clientMessageId,
      message: REQUEST.message,
      visitorEmail: REQUEST.visitorEmail,
      visitorName: REQUEST.visitorName,
    };
    const fingerprint = buildWidgetLeadSubmissionFingerprint(input);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      buildWidgetLeadSubmissionFingerprint({
        ...input,
        visitorName: "Someone else",
      }),
    ).not.toBe(fingerprint);
  });
});
