import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WaitlistSignup } from "@/types/database";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  from: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import AdminWaitlistPage from "./page";
import {
  waitlistClaimIndicator,
  waitlistStatus,
} from "./waitlistView";

type Row = Pick<
  WaitlistSignup,
  | "id"
  | "email"
  | "created_at"
  | "notified_at"
  | "unsubscribed_at"
  | "launch_send_claimed_at"
>;

type QueryMock = {
  select: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  returns: ReturnType<typeof vi.fn>;
  then: Promise<object>["then"];
};

function queryThenable(result: object): QueryMock {
  const promise = Promise.resolve(result);
  const query = {} as QueryMock;
  for (const method of [
    "select",
    "lte",
    "is",
    "not",
    "order",
    "range",
    "returns",
  ] as const) {
    query[method] = vi.fn(() => query);
  }
  query.then = promise.then.bind(promise);
  return query;
}

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "4f3e6823-e07c-4b7f-a643-ff0c2625850d",
    email: "person@example.com",
    created_at: "2026-07-29T20:00:00.000Z",
    notified_at: null,
    unsubscribed_at: null,
    launch_send_claimed_at: null,
    ...overrides,
  };
}

function arrangeQueries({
  total = 205,
  pending = 100,
  notified = 80,
  unsubscribed = 25,
  pendingRecipients = 98,
  rows = [],
}: {
  total?: number;
  pending?: number;
  notified?: number;
  unsubscribed?: number;
  pendingRecipients?: number;
  rows?: Row[];
} = {}) {
  const totalQuery = queryThenable({ count: total, error: null });
  const pendingQuery = queryThenable({ count: pending, error: null });
  const notifiedQuery = queryThenable({ count: notified, error: null });
  const unsubscribedQuery = queryThenable({
    count: unsubscribed,
    error: null,
  });
  const pendingRecipientQuery = queryThenable({
    count: pendingRecipients,
    error: null,
  });
  const rowsQuery = queryThenable({ data: rows, error: null });

  mocks.from
    .mockReturnValueOnce(totalQuery)
    .mockReturnValueOnce(pendingQuery)
    .mockReturnValueOnce(notifiedQuery)
    .mockReturnValueOnce(unsubscribedQuery)
    .mockReturnValueOnce(pendingRecipientQuery)
    .mockReturnValueOnce(rowsQuery);

  return {
    totalQuery,
    pendingQuery,
    notifiedQuery,
    unsubscribedQuery,
    pendingRecipientQuery,
    rowsQuery,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@simplassist.test",
  });
});

describe("waitlist status helpers", () => {
  it("uses Unsubscribed before Notified before Pending", () => {
    expect(
      waitlistStatus(
        makeRow({
          notified_at: "2026-07-28T10:00:00.000Z",
          unsubscribed_at: "2026-07-29T10:00:00.000Z",
        })
      )
    ).toBe("Unsubscribed");
    expect(
      waitlistStatus(
        makeRow({ notified_at: "2026-07-28T10:00:00.000Z" })
      )
    ).toBe("Notified");
    expect(waitlistStatus(makeRow())).toBe("Pending");
  });

  it("distinguishes an active claim from one needing delivery review", () => {
    const now = Date.parse("2026-07-29T20:10:00.000Z");

    expect(
      waitlistClaimIndicator(
        makeRow({ launch_send_claimed_at: "2026-07-29T20:08:00.000Z" }),
        now
      )
    ).toBe("Sending");
    expect(
      waitlistClaimIndicator(
        makeRow({ launch_send_claimed_at: "2026-07-29T20:00:00.000Z" }),
        now
      )
    ).toBe("Delivery review needed");
    expect(
      waitlistClaimIndicator(
        makeRow({
          notified_at: "2026-07-29T20:09:00.000Z",
          launch_send_claimed_at: "2026-07-29T20:08:00.000Z",
        }),
        now
      )
    ).toBeNull();
  });
});

describe("AdminWaitlistPage", () => {
  it("authenticates before service-role reads and renders exact counts", async () => {
    arrangeQueries();

    const element = await AdminWaitlistPage({ searchParams: {} });
    const markup = renderToStaticMarkup(element);

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0]
    );
    expect(markup).toContain('href="/admin"');
    expect(markup).toContain('aria-label="Back to admin"');
    expect(markup).toContain("Back</a>");
    expect(markup).toMatch(/Total[\s\S]*205/);
    expect(markup).toMatch(/Pending[\s\S]*100/);
    expect(markup).toMatch(/Notified[\s\S]*80/);
    expect(markup).toMatch(/Unsubscribed[\s\S]*25/);
    expect(markup).toContain("98 sendable pending");
    expect(markup).toContain(
      "docs/full-suite-waitlist-delivery-review.md"
    );
    expect(markup).toContain("exactly one active replica");
  });

  it("renders status precedence, claim indicators, actions, and page-two range", async () => {
    const recentClaim = new Date(Date.now() - 60_000).toISOString();
    const rows = [
      makeRow({
        id: "00000000-0000-4000-8000-000000000001",
        email: "unsubscribed@example.com",
        notified_at: "2026-07-28T10:00:00.000Z",
        unsubscribed_at: "2026-07-29T10:00:00.000Z",
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000002",
        email: "notified@example.com",
        notified_at: "2026-07-29T10:00:00.000Z",
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000003",
        email: "sending@example.com",
        launch_send_claimed_at: recentClaim,
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000004",
        email: "review@example.com",
        launch_send_claimed_at: "2020-01-01T00:00:00.000Z",
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000005",
        email: "pending@example.com",
      }),
    ];
    const { rowsQuery } = arrangeQueries({ rows });

    const element = await AdminWaitlistPage({
      searchParams: { page: "2" },
    });
    const markup = renderToStaticMarkup(element);

    expect(rowsQuery.range).toHaveBeenCalledWith(100, 199);
    expect(rowsQuery.select).toHaveBeenCalledWith(
      "id, email, created_at, notified_at, unsubscribed_at, launch_send_claimed_at"
    );
    expect(markup).toContain("Page 2 of 3");
    expect(markup).toContain("Unsubscribed");
    expect(markup).toContain("Notified");
    expect(markup).toContain("Pending");
    expect(markup).toContain("Sending");
    expect(markup).toContain("Delivery review needed");
    expect(markup).toContain(">Send</button>");
    expect(markup).toContain("/admin/waitlist?page=1");
    expect(markup).toContain("/admin/waitlist?page=3");
  });

  it("fails closed when an exact count read fails", async () => {
    const queries = arrangeQueries();
    const failedQuery = queryThenable({
      count: null,
      error: { message: "database unavailable" },
    });
    mocks.from.mockReset();
    mocks.from
      .mockReturnValueOnce(queries.totalQuery)
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(queries.notifiedQuery)
      .mockReturnValueOnce(queries.unsubscribedQuery)
      .mockReturnValueOnce(queries.pendingRecipientQuery);

    await expect(
      AdminWaitlistPage({ searchParams: {} })
    ).rejects.toThrow("Could not load the Full Suite waitlist.");
    expect(mocks.from).toHaveBeenCalledTimes(5);
  });

  it("fails closed when an exact count is unexpectedly null", async () => {
    const queries = arrangeQueries();
    const nullCountQuery = queryThenable({ count: null, error: null });
    mocks.from.mockReset();
    mocks.from
      .mockReturnValueOnce(queries.totalQuery)
      .mockReturnValueOnce(nullCountQuery)
      .mockReturnValueOnce(queries.notifiedQuery)
      .mockReturnValueOnce(queries.unsubscribedQuery)
      .mockReturnValueOnce(queries.pendingRecipientQuery);

    await expect(
      AdminWaitlistPage({ searchParams: {} })
    ).rejects.toThrow("Could not load the Full Suite waitlist.");
    expect(mocks.from).toHaveBeenCalledTimes(5);
  });
});
