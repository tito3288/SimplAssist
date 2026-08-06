import { beforeEach, describe, expect, it, vi } from "vitest";

type ReadResult = { data: unknown; error: unknown };

type MockQuery = {
  table: string;
  selection: string;
  eqValues: Map<string, unknown>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  queues: new Map<string, ReadResult[]>(),
  queries: [] as MockQuery[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  ACCOUNT_ACTIVITY_COLUMNS,
  ACCOUNT_ACTIVITY_PAGE_SIZE,
  loadAdminAccountActivity,
  normalizeAdminAccountActivity,
  type AdminAccountActivitySnapshot,
} from "./accountActivity.server";

const BUSINESS_ID = "10000000-0000-4000-a048-000000000001";
const JOB_ID = "20000000-0000-4000-a048-000000000001";
const ADMIN_ID = "30000000-0000-4000-a048-000000000001";
const AT = "2026-08-04T12:00:00.000Z";

function resultKey(
  table: string,
  selection: string,
  scope?: "business" | "provisioning",
): string {
  return `${table}|${selection}${scope ? `|${scope}` : ""}`;
}

function queryResultKey(query: MockQuery): string {
  if (query.table !== "admin_action_events") {
    return resultKey(query.table, query.selection);
  }
  return resultKey(
    query.table,
    query.selection,
    query.eqValues.has("provisioning_job_id") ? "provisioning" : "business",
  );
}

function nextResult(query: MockQuery): ReadResult {
  const key = queryResultKey(query);
  const queue = mocks.queues.get(key);
  if (!queue || queue.length === 0) {
    throw new Error(`Missing mock result for ${key}`);
  }
  return queue.shift()!;
}

function makeQuery(table: string) {
  let promise: Promise<ReadResult> | null = null;
  const query = {
    table,
    selection: "",
    eqValues: new Map<string, unknown>(),
    select: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: (
      onFulfilled: (value: ReadResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => read().then(onFulfilled, onRejected),
  } as MockQuery & {
    then: (
      onFulfilled: (value: ReadResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
  const read = () => {
    promise ??= Promise.resolve(nextResult(query));
    return promise;
  };
  query.select.mockImplementation((selection: string) => {
    query.selection = selection;
    return query;
  });
  query.eq.mockImplementation((column: string, value: unknown) => {
    query.eqValues.set(column, value);
    return query;
  });
  query.gt.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.maybeSingle.mockImplementation(read);
  mocks.queries.push(query);
  return query;
}

function validQueues(): Map<string, ReadResult[]> {
  return new Map([
    [
      resultKey("businesses", ACCOUNT_ACTIVITY_COLUMNS.milestones),
      [
        {
          data: {
            compliance_info_completed_at: null,
            onboarding_registration_submitted_at: null,
            onboarding_completed_at: null,
          },
          error: null,
        },
      ],
    ],
    [
      resultKey(
        "telnyx_resource_release_reasons",
        ACCOUNT_ACTIVITY_COLUMNS.releaseScheduled,
      ),
      [{ data: [], error: null }],
    ],
    [
      resultKey(
        "telnyx_resource_release_reasons",
        ACCOUNT_ACTIVITY_COLUMNS.releaseCanceled,
      ),
      [{ data: [], error: null }],
    ],
    [
      resultKey(
        "admin_action_events",
        ACCOUNT_ACTIVITY_COLUMNS.adminActions,
        "business",
      ),
      [{ data: [], error: null }],
    ],
    [
      resultKey("a2p_risk_review_events", ACCOUNT_ACTIVITY_COLUMNS.risk),
      [{ data: [], error: null }],
    ],
    [
      resultKey(
        "telnyx_registration_events",
        ACCOUNT_ACTIVITY_COLUMNS.registration,
      ),
      [{ data: [], error: null }],
    ],
    [
      resultKey(
        "telnyx_brand_link_events",
        ACCOUNT_ACTIVITY_COLUMNS.brandLink,
      ),
      [{ data: [], error: null }],
    ],
    [
      resultKey("rejected_brands", ACCOUNT_ACTIVITY_COLUMNS.rejected),
      [{ data: [], error: null }],
    ],
    [
      resultKey("rejected_campaigns", ACCOUNT_ACTIVITY_COLUMNS.rejected),
      [{ data: [], error: null }],
    ],
    [
      resultKey("google_calendar_tokens", ACCOUNT_ACTIVITY_COLUMNS.calendar),
      [{ data: null, error: null }],
    ],
    [
      resultKey(
        "partner_client_provisioning_jobs",
        ACCOUNT_ACTIVITY_COLUMNS.provisioningJob,
      ),
      [{ data: null, error: null }],
    ],
  ]);
}

function emptySnapshot(
  overrides: Partial<AdminAccountActivitySnapshot> = {},
): AdminAccountActivitySnapshot {
  return {
    businessId: BUSINESS_ID,
    milestones: null,
    releaseScheduled: [],
    releaseCanceled: [],
    businessAdminEvents: [],
    provisioningAdminEvents: [],
    riskEvents: [],
    registrationEvents: [],
    brandLinkEvents: [],
    rejectedBrands: [],
    rejectedCampaigns: [],
    calendar: null,
    ...overrides,
  };
}

function uuid(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(12, "0")}`;
}

function adminEvent(
  id: string,
  action: string,
  overrides: Partial<
    AdminAccountActivitySnapshot["businessAdminEvents"][number]
  > = {},
) {
  return {
    id,
    action,
    actor_admin_user_id: ADMIN_ID,
    created_at: AT,
    deletion_scheduled_for: null,
    reason: null,
    service: null,
    ...overrides,
  };
}

function setPagedQueue(
  table: string,
  selection: string,
  pages: unknown[][],
  scope?: "business" | "provisioning",
) {
  mocks.queues.set(
    resultKey(table, selection, scope),
    pages.map((data) => ({ data, error: null })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queues = validQueues();
  mocks.queries = [];
  mocks.from.mockImplementation((table: string) => makeQuery(table));
});

describe("normalizeAdminAccountActivity", () => {
  it("merges the newest exact deletion audit, gives it both facets, and preserves every unmatched audit", () => {
    const releaseId = "40000000-0000-4000-a048-000000000001";
    const olderId = "41000000-0000-4000-a048-000000000001";
    const newestId = "41000000-0000-4000-a048-000000000002";
    const unmatchedId = "41000000-0000-4000-a048-000000000003";
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        releaseScheduled: [
          {
            id: releaseId,
            triggered_at: "2026-08-01T12:00:00.000Z",
            release_at: "2026-10-01T12:00:00.000Z",
          },
        ],
        releaseCanceled: [
          {
            id: releaseId,
            canceled_at: "2026-08-02T12:00:00.000Z",
          },
        ],
        businessAdminEvents: [
          adminEvent(olderId, "account_deletion_scheduled", {
            actor_admin_user_id: "30000000-0000-4000-a048-000000000002",
            created_at: "2026-07-31T10:00:00.000Z",
            deletion_scheduled_for: "2026-10-01T12:00:00.000Z",
            reason: "Older administrative closure reason",
          }),
          adminEvent(newestId, "account_deletion_scheduled", {
            created_at: "2026-07-31T11:00:00.000Z",
            deletion_scheduled_for: "2026-10-01T12:00:00.000Z",
            reason: "Customer requested administrative closure",
          }),
          adminEvent(unmatchedId, "account_deletion_scheduled", {
            created_at: "2026-08-03T12:00:00.000Z",
            deletion_scheduled_for: "2026-10-03T12:00:00.000Z",
            reason: "Unmatched administrative closure reason",
          }),
        ],
      }),
    );

    expect(events).toHaveLength(4);
    expect(
      events.find((event) => event.id === `lifecycle:${releaseId}:scheduled`),
    ).toMatchObject({
      category: "lifecycle",
      facets: ["lifecycle", "admin"],
      title: "Account deletion scheduled",
      detail:
        "Reason: Customer requested administrative closure · Terminal cleanup target: 2026-10-01T12:00:00.000Z",
      actor: ADMIN_ID,
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `admin:${olderId}`,
          category: "admin",
          title: "Account deletion scheduled",
        }),
        expect.objectContaining({
          id: `admin:${unmatchedId}`,
          category: "admin",
          title: "Account deletion scheduled",
        }),
        expect.objectContaining({
          id: `lifecycle:${releaseId}:canceled`,
          facets: ["lifecycle"],
        }),
      ]),
    );
    expect(events.some((event) => event.id === `admin:${newestId}`)).toBe(
      false,
    );
  });

  it("retains friendly labels for every post-049 admin action and service", () => {
    const businessAdminEvents = [
      adminEvent(
        uuid("41000000-0000-4000-a048", 10),
        "account_operations_suspended",
        { reason: "Compliance review requested" },
      ),
      adminEvent(
        uuid("41000000-0000-4000-a048", 11),
        "account_operations_reactivated",
        { reason: "Compliance review completed" },
      ),
      adminEvent(
        uuid("41000000-0000-4000-a048", 12),
        "phone_assignment_recheck_requested",
      ),
      ...(["ai_replies", "texting", "bookings"] as const).flatMap(
        (service, index) => [
          adminEvent(
            uuid("41000000-0000-4000-a048", 20 + index * 2),
            "account_service_paused",
            { reason: "Administrative maintenance", service },
          ),
          adminEvent(
            uuid("41000000-0000-4000-a048", 21 + index * 2),
            "account_service_resumed",
            { service },
          ),
        ],
      ),
    ];
    const provisioningAdminEvents = [
      adminEvent(
        uuid("42000000-0000-4000-a048", 1),
        "provisioning_job_dismissed",
      ),
      adminEvent(
        uuid("42000000-0000-4000-a048", 2),
        "provisioning_job_restored",
      ),
    ];

    const events = normalizeAdminAccountActivity(
      emptySnapshot({ businessAdminEvents, provisioningAdminEvents }),
    );

    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining([
        "Account operations suspended",
        "Account operations reactivated",
        "Phone assignment recheck requested",
        "AI replies paused",
        "AI replies resumed",
        "Texting paused",
        "Texting resumed",
        "Bookings paused",
        "Bookings resumed",
        "Provisioning issue dismissed",
        "Provisioning issue restored",
      ]),
    );
    expect(events.map((event) => event.title)).not.toContain(
      "Admin action recorded",
    );
    expect(events.every((event) => event.facets.includes("admin"))).toBe(true);
  });

  it("maps known registration activity and adds only the durable campaign-check discriminator", () => {
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        riskEvents: [
          {
            id: uuid("50000000-0000-4000-a048", 1),
            event_type: "admin_approved",
            created_at: AT,
            reviewed_by: "admin@test",
          },
        ],
        registrationEvents: [
          {
            id: uuid("51000000-0000-4000-a048", 1),
            event_type: "campaign_status_refreshed",
            created_at: AT,
          },
          {
            id: uuid("51000000-0000-4000-a048", 2),
            event_type: "brand_submitted",
            created_at: AT,
          },
        ],
        brandLinkEvents: [
          {
            id: uuid("52000000-0000-4000-a048", 1),
            event_type: "link_approved",
            actor_user_id: "system:paid_launch",
            created_at: AT,
          },
        ],
      }),
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "A2P risk review approved",
          actor: "admin@test",
          facets: ["registration"],
        }),
        expect.objectContaining({
          title: "Campaign registration status check recorded",
          registrationEventType: "campaign_status_refreshed",
        }),
        expect.objectContaining({
          title: "Brand submission attempt recorded",
          registrationEventType: null,
        }),
        expect.objectContaining({
          title: "Existing brand link approved",
          actor: "system:paid_launch",
        }),
      ]),
    );
  });

  it("keeps every unknown source type reachable as a fixed label-only entry", () => {
    const rawFragments = [
      "future_admin_action",
      "future_job_action",
      "future_risk_event",
      "future_registration_event",
      "future_brand_event",
      "RAW ADMIN BODY",
      "RAW ACTOR BODY",
    ];
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        businessAdminEvents: [
          adminEvent(
            uuid("61000000-0000-4000-a048", 1),
            "future_admin_action",
            { reason: "RAW ADMIN BODY", service: "future_service" },
          ),
        ],
        provisioningAdminEvents: [
          adminEvent(
            uuid("61000000-0000-4000-a048", 2),
            "future_job_action",
            { reason: "RAW ADMIN BODY", service: "future_service" },
          ),
        ],
        riskEvents: [
          {
            id: uuid("61000000-0000-4000-a048", 3),
            event_type: "future_risk_event",
            created_at: AT,
            reviewed_by: "RAW ACTOR BODY",
          },
        ],
        registrationEvents: [
          {
            id: uuid("61000000-0000-4000-a048", 4),
            event_type: "future_registration_event",
            created_at: AT,
          },
        ],
        brandLinkEvents: [
          {
            id: uuid("61000000-0000-4000-a048", 5),
            event_type: "future_brand_event",
            actor_user_id: "RAW ACTOR BODY",
            created_at: AT,
          },
          {
            id: uuid("61000000-0000-4000-a048", 6),
            event_type: "toString",
            actor_user_id: null,
            created_at: AT,
          },
        ],
      }),
    );

    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining([
        "Admin action recorded",
        "Provisioning admin action recorded",
        "A2P risk review event recorded",
        "Registration event recorded",
        "Existing-brand event recorded",
      ]),
    );
    expect(events).toHaveLength(6);
    expect(events.every((event) => event.detail === null)).toBe(true);
    expect(events.every((event) => event.actor === null)).toBe(true);
    expect(events.every((event) => event.registrationEventType === null)).toBe(
      true,
    );
    const renderedFields = events
      .flatMap((event) => [event.title, event.detail, event.actor])
      .join(" ");
    for (const raw of rawFragments) expect(renderedFields).not.toContain(raw);
  });

  it("normalizes milestones, rejections, Calendar, and every row without a global cap", () => {
    const registrationEvents = Array.from({ length: 1_002 }, (_, index) => ({
      id: uuid("54000000-0000-4000-a048", index + 1),
      event_type: "campaign_status_refreshed",
      created_at:
        index < 2
          ? "2026-08-09T12:00:00.000Z"
          : "2026-08-04T12:00:00.000Z",
    }));
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        milestones: {
          compliance_info_completed_at: "2026-08-01T12:00:00.000Z",
          onboarding_registration_submitted_at:
            "2026-08-02T12:00:00.000Z",
          onboarding_completed_at: "2026-08-03T12:00:00.000Z",
        },
        registrationEvents,
        rejectedBrands: [
          {
            id: uuid("55000000-0000-4000-a048", 1),
            archived_at: "2026-08-06T12:00:00.000Z",
          },
        ],
        rejectedCampaigns: [
          {
            id: uuid("55000000-0000-4000-a048", 2),
            archived_at: "2026-08-07T12:00:00.000Z",
          },
        ],
        calendar: { created_at: "2026-08-08T12:00:00.000Z" },
      }),
    );

    expect(events).toHaveLength(1_008);
    expect(events[0].id).toContain("000000000001");
    expect(events[1].id).toContain("000000000002");
    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining([
        "Calendar connected",
        "Campaign archived during registration recovery",
        "Rejected brand archived",
        "Onboarding completed; account launched",
        "Registration submitted",
        "Compliance information completed",
      ]),
    );
    expect(events.some((event) => event.id.endsWith("000000001002"))).toBe(
      true,
    );
  });

  it("omits nullable timestamp rows and drops unsafe actors from known events", () => {
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        riskEvents: [
          {
            id: uuid("56000000-0000-4000-a048", 1),
            event_type: "scan_passed",
            created_at: null,
            reviewed_by: null,
          },
          {
            id: uuid("56000000-0000-4000-a048", 2),
            event_type: "admin_approved",
            created_at: AT,
            reviewed_by: "x".repeat(255),
          },
        ],
        rejectedBrands: [
          {
            id: uuid("56000000-0000-4000-a048", 3),
            archived_at: null,
          },
        ],
        calendar: { created_at: null },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "A2P risk review approved",
      actor: null,
    });
  });
});

describe("loadAdminAccountActivity", () => {
  it("uses one exhaustive ID-keyset shape for every direct pageable source", async () => {
    await expect(loadAdminAccountActivity(BUSINESS_ID)).resolves.toEqual([]);

    expect(mocks.from).toHaveBeenCalledTimes(11);
    const pagedQueries = mocks.queries.filter(
      (query) => query.limit.mock.calls.length > 0,
    );
    expect(pagedQueries).toHaveLength(8);
    for (const query of pagedQueries) {
      expect(query.order).toHaveBeenCalledTimes(1);
      expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
      expect(query.limit).toHaveBeenCalledWith(ACCOUNT_ACTIVITY_PAGE_SIZE);
      expect(query.gt).not.toHaveBeenCalled();
      expect(query.in).not.toHaveBeenCalled();
      expect(query.order).not.toHaveBeenCalledWith(
        expect.stringMatching(/created_at|triggered_at|archived_at/),
        expect.anything(),
      );
    }
    const adminQuery = pagedQueries.find(
      (query) => query.table === "admin_action_events",
    )!;
    expect(adminQuery.eq).toHaveBeenCalledWith("business_id", BUSINESS_ID);
    expect(adminQuery.in).not.toHaveBeenCalled();
    const typedEventQueries = pagedQueries.filter((query) =>
      [
        "a2p_risk_review_events",
        "telnyx_registration_events",
        "telnyx_brand_link_events",
      ].includes(query.table),
    );
    expect(typedEventQueries).toHaveLength(3);
    expect(typedEventQueries.every((query) => query.in.mock.calls.length === 0)).toBe(
      true,
    );
  });

  it("loads more than 1,000 rows through exact 500-row ID cursors and the terminating empty page", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: uuid("57000000-0000-4000-a048", index + 1),
      event_type: "campaign_status_refreshed",
      created_at: AT,
    }));
    setPagedQueue(
      "telnyx_registration_events",
      ACCOUNT_ACTIVITY_COLUMNS.registration,
      [rows.slice(0, 500), rows.slice(500, 1_000), rows.slice(1_000), []],
    );

    const events = await loadAdminAccountActivity(BUSINESS_ID);

    expect(events).toHaveLength(1_001);
    expect(events[0].id).toContain("000000000001");
    expect(events.at(-1)?.id).toContain("000000001001");
    const queries = mocks.queries.filter(
      (query) => query.table === "telnyx_registration_events",
    );
    expect(queries).toHaveLength(4);
    expect(queries[0].gt).not.toHaveBeenCalled();
    expect(queries[1].gt).toHaveBeenCalledWith("id", rows[499].id);
    expect(queries[2].gt).toHaveBeenCalledWith("id", rows[999].id);
    expect(queries[3].gt).toHaveBeenCalledWith("id", rows[1_000].id);
    expect(
      queries.every((query) =>
        query.limit.mock.calls.some(
          ([size]) => size === ACCOUNT_ACTIVITY_PAGE_SIZE,
        ),
      ),
    ).toBe(true);
  });

  it("reads all current-job actions through the exact stored association", async () => {
    mocks.queues.set(
      resultKey(
        "partner_client_provisioning_jobs",
        ACCOUNT_ACTIVITY_COLUMNS.provisioningJob,
      ),
      [{ data: { id: JOB_ID }, error: null }],
    );
    setPagedQueue(
      "admin_action_events",
      ACCOUNT_ACTIVITY_COLUMNS.adminActions,
      [
        [
          adminEvent(
            uuid("58000000-0000-4000-a048", 1),
            "future_job_action",
            { created_at: AT },
          ),
        ],
        [],
      ],
      "provisioning",
    );

    const events = await loadAdminAccountActivity(BUSINESS_ID);

    expect(events).toEqual([
      expect.objectContaining({
        category: "admin",
        title: "Provisioning admin action recorded",
        detail: null,
        actor: null,
      }),
    ]);
    const jobQueries = mocks.queries.filter(
      (query) => query.eqValues.has("provisioning_job_id"),
    );
    expect(jobQueries).toHaveLength(2);
    for (const query of jobQueries) {
      expect(query.eq).toHaveBeenCalledWith("provisioning_job_id", JOB_ID);
      expect(query.eq).not.toHaveBeenCalledWith("business_id", BUSINESS_ID);
      expect(query.in).not.toHaveBeenCalled();
      expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
      expect(query.limit).toHaveBeenCalledWith(500);
    }
  });

  it("does not query already-orphaned provisioning actions without a current job", async () => {
    await loadAdminAccountActivity(BUSINESS_ID);

    expect(
      mocks.queries.filter((query) =>
        query.eqValues.has("provisioning_job_id"),
      ),
    ).toHaveLength(0);
  });

  it("loads unknown source types without reflecting raw discriminators or bodies", async () => {
    setPagedQueue(
      "admin_action_events",
      ACCOUNT_ACTIVITY_COLUMNS.adminActions,
      [
        [
          adminEvent(
            uuid("59000000-0000-4000-a048", 1),
            "future_admin_action",
            { reason: "RAW JSON FRAGMENT", service: "future_service" },
          ),
        ],
        [],
      ],
      "business",
    );
    setPagedQueue("a2p_risk_review_events", ACCOUNT_ACTIVITY_COLUMNS.risk, [
      [
        {
          id: uuid("59000000-0000-4000-a048", 2),
          event_type: "future_risk_event",
          created_at: AT,
          reviewed_by: "RAW EVENT BODY",
        },
      ],
      [],
    ]);
    setPagedQueue(
      "telnyx_registration_events",
      ACCOUNT_ACTIVITY_COLUMNS.registration,
      [
        [
          {
            id: uuid("59000000-0000-4000-a048", 3),
            event_type: "future_registration_event",
            created_at: AT,
          },
        ],
        [],
      ],
    );
    setPagedQueue(
      "telnyx_brand_link_events",
      ACCOUNT_ACTIVITY_COLUMNS.brandLink,
      [
        [
          {
            id: uuid("59000000-0000-4000-a048", 4),
            event_type: "future_brand_event",
            actor_user_id: "RAW EVENT BODY",
            created_at: AT,
          },
        ],
        [],
      ],
    );

    const events = await loadAdminAccountActivity(BUSINESS_ID);
    const visibleText = events
      .flatMap((event) => [event.title, event.detail, event.actor])
      .join(" ");

    expect(events).toHaveLength(4);
    expect(events.every((event) => event.detail === null)).toBe(true);
    expect(events.every((event) => event.actor === null)).toBe(true);
    for (const raw of [
      "future_admin_action",
      "future_risk_event",
      "future_registration_event",
      "future_brand_event",
      "RAW JSON FRAGMENT",
      "RAW EVENT BODY",
    ]) {
      expect(visibleText).not.toContain(raw);
    }
  });

  it("fails the complete timeline with the correct source on a later page error", async () => {
    const firstRow = {
      id: uuid("60000000-0000-4000-a048", 1),
      event_type: "brand_submitted",
      created_at: AT,
    };
    const failure = { code: "42501", message: "permission denied" };
    mocks.queues.set(
      resultKey(
        "telnyx_registration_events",
        ACCOUNT_ACTIVITY_COLUMNS.registration,
      ),
      [
        { data: [firstRow], error: null },
        { data: null, error: failure },
      ],
    );

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "query_failed",
      source: "registration activity",
      cause: failure,
    });
  });

  it("fails the complete timeline on malformed data from a later page", async () => {
    const firstRow = {
      id: uuid("60000000-0000-4000-a048", 1),
      event_type: "brand_submitted",
      created_at: AT,
    };
    mocks.queues.set(
      resultKey(
        "telnyx_registration_events",
        ACCOUNT_ACTIVITY_COLUMNS.registration,
      ),
      [
        { data: [firstRow], error: null },
        { data: [{ ...firstRow, id: "not-a-uuid" }], error: null },
      ],
    );

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "invalid_response",
      source: "registration activity",
    });
  });

  it.each([
    [
      "account action without reason",
      {
        action: "account_operations_suspended",
        reason: null,
        service: null,
      },
    ],
    [
      "service action without service",
      {
        action: "account_service_paused",
        reason: null,
        service: null,
      },
    ],
    [
      "assignment recheck with payload",
      {
        action: "phone_assignment_recheck_requested",
        reason: "Unexpected admin reason",
        service: null,
      },
    ],
    [
      "deletion action without target",
      {
        action: "account_deletion_scheduled",
        reason: "Customer requested administrative closure",
        service: null,
      },
    ],
  ])("rejects malformed known admin audit shape: %s", async (_, overrides) => {
    setPagedQueue(
      "admin_action_events",
      ACCOUNT_ACTIVITY_COLUMNS.adminActions,
      [
        [
          {
            ...adminEvent(
              uuid("61000000-0000-4000-a048", 1),
              "future_action",
            ),
            ...overrides,
          },
        ],
      ],
      "business",
    );

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      code: "invalid_response",
      source: "business admin actions",
    });
  });

  it("rejects an invalid business ID before any service-role read", async () => {
    await expect(loadAdminAccountActivity("not-a-uuid")).rejects.toMatchObject({
      code: "invalid_business_id",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("projects only approved scalar fields and never selects event bodies or JSON payloads", () => {
    expect(ACCOUNT_ACTIVITY_COLUMNS.adminActions).toContain("created_at");
    expect(ACCOUNT_ACTIVITY_COLUMNS.adminActions).toContain(
      "deletion_scheduled_for",
    );
    expect(ACCOUNT_ACTIVITY_COLUMNS.adminActions).not.toMatch(
      /(?:^|,\s*)summary(?:,|$)/,
    );
    expect(ACCOUNT_ACTIVITY_COLUMNS.adminActions.match(/summary->>/g)).toHaveLength(
      2,
    );
    expect(ACCOUNT_ACTIVITY_COLUMNS.risk).toContain(
      "reviewed_by:raw_payload->>reviewedBy",
    );
    expect(ACCOUNT_ACTIVITY_COLUMNS.risk).not.toMatch(
      /(?:^|,\s*)raw_payload(?:,|$)/,
    );

    const projections = Object.values(ACCOUNT_ACTIVITY_COLUMNS).join(" ");
    for (const forbidden of [
      "access_token",
      "refresh_token",
      "event_body",
      "content",
      "message",
      "findings",
      "rejection_reason",
      "telnyx_resource_id",
      "telnyx_brand_id",
      "telnyx_campaign_id",
    ]) {
      expect(projections).not.toContain(forbidden);
    }
    expect(ACCOUNT_ACTIVITY_COLUMNS.calendar).toBe("created_at");
  });
});
