import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { POST } from "./route";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000054";
const REQUEST_ID = "50000000-0000-4000-a000-000000000054";
const HANDLED_AT = "2026-08-11T17:30:00.123456+00:00";

function request(body?: string) {
  return new NextRequest(
    `http://localhost/api/booking-requests/${REQUEST_ID}/handle`,
    {
      method: "POST",
      ...(body === undefined ? {} : { body }),
    }
  );
}

function context(id: string = REQUEST_ID) {
  return { params: { id } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "00000000-0000-4000-a000-000000000054" },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    },
  });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: HANDLED_AT, error: null });
});

describe("POST /api/booking-requests/[id]/handle", () => {
  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i before validation or database work", async (status, body) => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(body, { status }),
    });

    const response = await POST(request(), context("not-a-uuid"));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("waits for workspace access before every other awaited operation", async () => {
    const workspace = deferred<{
      ok: true;
      access: {
        status: "resolved";
        user: { id: string };
        business: { id: string; partner_id: null };
        hostKind: "canonical";
      };
    }>();
    mocks.requireWorkspaceRouteAccess.mockReturnValue(workspace.promise);

    const responsePromise = POST(request(), context());

    expect(mocks.requireWorkspaceRouteAccess).toHaveBeenCalledOnce();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();

    workspace.resolve({
      ok: true,
      access: {
        status: "resolved",
        user: { id: "00000000-0000-4000-a000-000000000054" },
        business: { id: BUSINESS_ID, partner_id: null },
        hostKind: "canonical",
      },
    });

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it.each(["not-a-uuid", "", "../../foreign-request"])(
    "returns the same not-found response for invalid id %j",
    async (id) => {
      const response = await POST(request(), context(id));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Appointment request not found",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["a missing request", "booking request not found"],
    ["a foreign request", "private foreign-row detail"],
  ])("isolates %s behind the same 404", async (_label, message) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message },
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Appointment request not found",
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    ["first transition", HANDLED_AT],
    ["already handled", "2026-08-10T14:15:16.000000+00:00"],
  ])("returns the RPC timestamp for %s", async (_label, handledAt) => {
    mocks.rpc.mockResolvedValue({ data: handledAt, error: null });

    const response = await POST(request(), context());

    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mark_booking_request_handled",
      {
        p_business_id: BUSINESS_ID,
        p_request_id: REQUEST_ID,
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      request: {
        id: REQUEST_ID,
        status: "handled",
        handledAt,
      },
    });
  });

  it("does not read a request body", async () => {
    const incoming = request("{ malformed and deliberately ignored");
    const json = vi.spyOn(incoming, "json");

    const response = await POST(incoming, context());

    expect(response.status).toBe(200);
    expect(json).not.toHaveBeenCalled();
  });

  it("returns a sanitized retryable response for database errors", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "sensitive database detail" },
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain(
      "sensitive database detail"
    );
  });

  it.each([null, "not-a-timestamp", { handled_at: HANDLED_AT }])(
    "fails closed on malformed RPC success data %j",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      const response = await POST(request(), context());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Service temporarily unavailable",
        retryable: true,
      });
    }
  );

  it.each([
    ["client creation", true],
    ["RPC execution", false],
  ])("sanitizes a thrown %s failure", async (_label, failClient) => {
    const privateFailure = new Error("private connection failure");
    if (failClient) {
      mocks.createClient.mockRejectedValue(privateFailure);
    } else {
      mocks.rpc.mockRejectedValue(privateFailure);
    }

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Service temporarily unavailable",
      retryable: true,
    });
  });
});
