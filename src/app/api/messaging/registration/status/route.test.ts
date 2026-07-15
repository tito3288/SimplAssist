import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unwrap: vi.fn(),
  markProcessedOnce: vi.fn(),
  releaseProcessedEvent: vi.fn(),
  from: vi.fn(),
  appendRegistrationEvent: vi.fn(),
  serializeError: vi.fn(),
  ensureCampaignAssignmentForBusiness: vi.fn(),
  mapBrandStatus: vi.fn(),
  mapCampaignStatus: vi.fn(),
  extractRejectionReason: vi.fn(),
  dedupeRecipients: vi.fn(),
  sendBrandApprovedEmail: vi.fn(),
  sendBrandRejectedEmail: vi.fn(),
  sendCampaignApprovedEmail: vi.fn(),
  sendCampaignRejectedEmail: vi.fn(),
}));

vi.mock("@/lib/messaging/client", () => ({
  telnyx: { webhooks: { unwrap: mocks.unwrap } },
}));
vi.mock("@/lib/messaging/idempotency", () => ({
  markProcessedOnce: mocks.markProcessedOnce,
  releaseProcessedEvent: mocks.releaseProcessedEvent,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "owner@test.dev" } }, error: null }) } },
  },
}));
vi.mock("@/lib/messaging/registration/audit", () => ({
  appendRegistrationEvent: mocks.appendRegistrationEvent,
  serializeError: mocks.serializeError,
}));
vi.mock("@/lib/messaging/registration/phoneNumberAssignment", () => ({
  ensureCampaignAssignmentForBusiness: mocks.ensureCampaignAssignmentForBusiness,
}));
vi.mock("@/lib/messaging/registration/statusMapper", () => ({
  mapBrandStatus: mocks.mapBrandStatus,
  mapCampaignStatus: mocks.mapCampaignStatus,
  extractRejectionReason: mocks.extractRejectionReason,
}));
vi.mock("@/lib/email/registrationStatus", () => ({
  dedupeRecipients: mocks.dedupeRecipients,
  sendBrandApprovedEmail: mocks.sendBrandApprovedEmail,
  sendBrandRejectedEmail: mocks.sendBrandRejectedEmail,
  sendCampaignApprovedEmail: mocks.sendCampaignApprovedEmail,
  sendCampaignRejectedEmail: mocks.sendCampaignRejectedEmail,
}));

import { POST as statusWebhook } from "./route";

const BUSINESS = {
  id: "00000000-0000-4000-8000-00000000b1z1",
  name: "Test Biz",
  owner_id: "00000000-0000-4000-8000-00000000own1",
  authorized_rep_email: "rep@test.dev",
};

// Chainable, awaitable supabase query mock: every method returns the chain,
// awaiting it resolves the queued result. from() consumes results FIFO.
const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of ["select", "update", "eq", "or", "maybeSingle", "single"]) {
      chain[m] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    chains.push(chain);
    return chain;
  });
}

function request() {
  return new NextRequest("http://localhost/api/messaging/registration/status", {
    method: "POST",
    body: "{}",
  });
}

function campaignEvent(id = "evt_status_1") {
  return {
    data: {
      id,
      event_type: "campaign.status.update",
      payload: { campaignId: "cmp_test_1", campaignStatus: "ACTIVE" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.markProcessedOnce.mockResolvedValue(true);
  mocks.releaseProcessedEvent.mockResolvedValue(undefined);
  mocks.appendRegistrationEvent.mockResolvedValue(undefined);
  mocks.serializeError.mockReturnValue({ error: "serialized" });
  mocks.ensureCampaignAssignmentForBusiness.mockResolvedValue(undefined);
  mocks.mapCampaignStatus.mockReturnValue({
    dbStatus: "approved",
    isTerminal: true,
  });
  mocks.extractRejectionReason.mockReturnValue(null);
  mocks.dedupeRecipients.mockReturnValue(["rep@test.dev"]);
  mocks.sendCampaignApprovedEmail.mockResolvedValue(undefined);
  queueResults();
});

describe("POST /api/messaging/registration/status", () => {
  it("applies a terminal transition and keeps the claim on success", async () => {
    mocks.unwrap.mockResolvedValue(campaignEvent());
    queueResults(
      { data: BUSINESS, error: null }, // lookupBusiness
      { data: [{ id: BUSINESS.id }], error: null } // applyStatusTransition
    );

    const response = await statusWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.appendRegistrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS.id, status: "approved" })
    );
    expect(mocks.releaseProcessedEvent).not.toHaveBeenCalled();
  });

  it("dedups duplicate deliveries without touching the database", async () => {
    mocks.unwrap.mockResolvedValue(campaignEvent());
    mocks.markProcessedOnce.mockResolvedValue(false);

    const response = await statusWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.releaseProcessedEvent).not.toHaveBeenCalled();
  });

  it("releases the claim and 500s when the business lookup hits a DB error", async () => {
    mocks.unwrap.mockResolvedValue(campaignEvent());
    queueResults({ data: null, error: { message: "connection reset" } });

    const response = await statusWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.releaseProcessedEvent).toHaveBeenCalledWith("evt_status_1");
  });

  it("acks a genuine not-found (archived/foreign resource) without releasing", async () => {
    mocks.unwrap.mockResolvedValue(campaignEvent());
    queueResults({ data: null, error: null });

    const response = await statusWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.releaseProcessedEvent).not.toHaveBeenCalled();
  });

  it("audits, releases, and 500s when the conditional update fails", async () => {
    mocks.unwrap.mockResolvedValue(campaignEvent());
    queueResults(
      { data: BUSINESS, error: null }, // lookupBusiness
      { data: null, error: { message: "serialization failure" } } // update
    );

    const response = await statusWebhook(request());

    expect(response.status).toBe(500);
    // The error-audit path still records the failure before rethrowing.
    expect(mocks.appendRegistrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS.id, status: "error" })
    );
    expect(mocks.releaseProcessedEvent).toHaveBeenCalledWith("evt_status_1");
  });

  // NOTE deliberately absent: an "audit append fails → 500" test would be
  // theater — the real appendRegistrationEvent swallows its own DB errors
  // and never rejects (src/lib/messaging/registration/audit.ts), so that
  // branch is unreachable in production. Audit writes are best-effort.

  it("returns 403 before any claim when the signature fails", async () => {
    mocks.unwrap.mockRejectedValue(new Error("bad signature"));

    const response = await statusWebhook(request());

    expect(response.status).toBe(403);
    expect(mocks.markProcessedOnce).not.toHaveBeenCalled();
  });
});
