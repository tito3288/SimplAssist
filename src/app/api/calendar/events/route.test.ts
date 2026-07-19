import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedFeature: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getCalendarService: vi.fn(),
}));

vi.mock("@/lib/google/routeAccess", () => ({
  requireAuthenticatedFeature: mocks.requireAuthenticatedFeature,
}));
vi.mock("@/lib/google/client", () => ({
  getAuthenticatedClient: mocks.getAuthenticatedClient,
  getCalendarService: mocks.getCalendarService,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const operations = [
  {
    method: "GET",
    invoke: () =>
      GET(
        new NextRequest(
          "http://localhost/api/calendar/events?start=2026-07-01T00%3A00%3A00Z&end=2026-08-01T00%3A00%3A00Z"
        )
      ),
  },
  {
    method: "POST",
    invoke: () =>
      POST(
        new NextRequest("http://localhost/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Estimate",
            startTime: "2026-07-20T13:00:00Z",
            endTime: "2026-07-20T14:00:00Z",
          }),
        })
      ),
  },
  {
    method: "PATCH",
    invoke: () =>
      PATCH(
        new NextRequest("http://localhost/api/calendar/events", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: "event-1",
            title: "Updated estimate",
          }),
        })
      ),
  },
  {
    method: "DELETE",
    invoke: () =>
      DELETE(
        new NextRequest(
          "http://localhost/api/calendar/events?eventId=event-1",
          { method: "DELETE" }
        )
      ),
  },
] as const;

function denyAccess(status: 403 | 503) {
  mocks.requireAuthenticatedFeature.mockResolvedValue({
    ok: false,
    response: NextResponse.json(
      status === 403
        ? {
            error: "feature_unavailable",
            feature: "calendar",
            requiredPlan: "sms_and_chat",
          }
        : { error: "service_unavailable", retryable: true },
      { status }
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Calendar event entitlement boundary", () => {
  it.each(operations)(
    "$method returns 403 before token or Google access for a known plan denial",
    async ({ invoke }) => {
      denyAccess(403);

      const response = await invoke();

      expect(response.status).toBe(403);
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
    }
  );

  it.each(operations)(
    "$method returns retryable 503 before token or Google access when access is indeterminate",
    async ({ invoke }) => {
      denyAccess(503);

      const response = await invoke();

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ retryable: true });
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
    }
  );
});
