import { beforeEach, describe, expect, it, vi } from "vitest";

type ReadResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  queues: new Map<string, ReadResult[]>(),
  queries: [] as Array<{
    table: string;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  ACCOUNT_ACTIVITY_COLUMNS,
  loadAdminAccountActivity,
  normalizeAdminAccountActivity,
  type AdminAccountActivitySnapshot,
} from "./accountActivity.server";

const BUSINESS_ID = "10000000-0000-4000-a048-000000000001";
const JOB_ID = "20000000-0000-4000-a048-000000000001";
const ADMIN_ID = "30000000-0000-4000-a048-000000000001";
const AT = "2026-08-04T12:00:00.000Z";

function nextResult(table: string): ReadResult {
  const queue = mocks.queues.get(table);
  if (!queue || queue.length === 0) {
    throw new Error(`Missing mock result for ${table}`);
  }
  return queue.shift()!;
}

function makeQuery(table: string) {
  let promise: Promise<ReadResult> | null = null;
  const read = () => {
    promise ??= Promise.resolve(nextResult(table));
    return promise;
  };
  const query = {
    table,
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(read),
    then: (
      onFulfilled: (value: ReadResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => read().then(onFulfilled, onRejected),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  mocks.queries.push(query);
  return query;
}

function validQueues() {
  return new Map<string, ReadResult[]>([
    [
      "businesses",
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
      "telnyx_resource_release_reasons",
      [
        { data: [], error: null },
        { data: [], error: null },
      ],
    ],
    [
      "admin_action_events",
      [
        { data: [], error: null },
        { data: [], error: null },
      ],
    ],
    ["partner_client_provisioning_jobs", [{ data: null, error: null }]],
    ["a2p_risk_review_events", [{ data: [], error: null }]],
    ["telnyx_registration_events", [{ data: [], error: null }]],
    ["telnyx_brand_link_events", [{ data: [], error: null }]],
    ["rejected_brands", [{ data: [], error: null }]],
    ["rejected_campaigns", [{ data: [], error: null }]],
    ["google_calendar_tokens", [{ data: null, error: null }]],
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
    deletionAdminEvents: [],
    operationalAdminEvents: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queues = validQueues();
  mocks.queries = [];
  mocks.from.mockImplementation((table: string) => makeQuery(table));
});

describe("normalizeAdminAccountActivity", () => {
  it("matches a deletion admin actor by the exact scheduled instant and records cancellation separately", () => {
    const releaseId = "40000000-0000-4000-a048-000000000001";
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
        deletionAdminEvents: [
          {
            id: "41000000-0000-4000-a048-000000000001",
            actor_admin_user_id: ADMIN_ID,
            deletion_scheduled_for: "2026-10-01T12:00:00.000Z",
          },
        ],
      }),
    );

    expect(events).toEqual([
      expect.objectContaining({
        id: `lifecycle:${releaseId}:canceled`,
        title: "Account reactivated; deletion canceled",
        actor: null,
      }),
      expect.objectContaining({
        id: `lifecycle:${releaseId}:scheduled`,
        title: "Account deletion scheduled",
        actor: ADMIN_ID,
      }),
    ]);
  });

  it("does not attribute a customer schedule to a mismatched admin action", () => {
    const [event] = normalizeAdminAccountActivity(
      emptySnapshot({
        releaseScheduled: [
          {
            id: "40000000-0000-4000-a048-000000000002",
            triggered_at: AT,
            release_at: "2026-10-01T12:00:00.000Z",
          },
        ],
        deletionAdminEvents: [
          {
            id: "41000000-0000-4000-a048-000000000002",
            actor_admin_user_id: ADMIN_ID,
            deletion_scheduled_for: "2026-10-02T12:00:00.000Z",
          },
        ],
      }),
    );

    expect(event.actor).toBeNull();
  });

  it("normalizes every operational action, service label, reason, and actor", () => {
    const operationalAdminEvents = [
      {
        id: "41000000-0000-4000-a048-000000000010",
        action: "account_operations_suspended" as const,
        actor_admin_user_id: ADMIN_ID,
        created_at: "2026-08-04T12:08:00.000Z",
        reason: "Compliance review requested",
        service: null,
      },
      {
        id: "41000000-0000-4000-a048-000000000011",
        action: "account_operations_reactivated" as const,
        actor_admin_user_id: ADMIN_ID,
        created_at: "2026-08-04T12:07:00.000Z",
        reason: "Compliance review completed",
        service: null,
      },
      ...(["ai_replies", "texting", "bookings"] as const).flatMap(
        (service, index) => [
          {
            id: `41000000-0000-4000-a048-${String(20 + index * 2).padStart(12, "0")}`,
            action: "account_service_paused" as const,
            actor_admin_user_id: ADMIN_ID,
            created_at: `2026-08-04T12:0${6 - index}:00.000Z`,
            reason: "Administrative maintenance",
            service,
          },
          {
            id: `41000000-0000-4000-a048-${String(21 + index * 2).padStart(12, "0")}`,
            action: "account_service_resumed" as const,
            actor_admin_user_id: ADMIN_ID,
            created_at: `2026-08-04T12:0${3 - index}:00.000Z`,
            reason: null,
            service,
          },
        ],
      ),
    ];

    const events = normalizeAdminAccountActivity(
      emptySnapshot({ operationalAdminEvents }),
    );

    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining([
        "Account operations suspended",
        "Account operations reactivated",
        "AI replies paused",
        "AI replies resumed",
        "Texting paused",
        "Texting resumed",
        "Bookings paused",
        "Bookings resumed",
      ]),
    );
    expect(
      events.find((event) => event.title === "AI replies resumed"),
    ).toMatchObject({
      category: "admin",
      detail: null,
      actor: ADMIN_ID,
    });
    expect(
      events.find((event) => event.title === "Account operations suspended"),
    ).toMatchObject({
      detail: "Compliance review requested",
      actor: ADMIN_ID,
    });
    expect(
      events.find((event) => event.title === "Texting paused"),
    ).toMatchObject({
      detail: "Administrative maintenance",
      actor: ADMIN_ID,
    });
  });

  it("normalizes milestones, exact provisioning actions, rejections, and current Calendar creation", () => {
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        milestones: {
          compliance_info_completed_at: "2026-08-01T12:00:00.000Z",
          onboarding_registration_submitted_at:
            "2026-08-02T12:00:00.000Z",
          onboarding_completed_at: "2026-08-03T12:00:00.000Z",
        },
        provisioningAdminEvents: [
          {
            id: "42000000-0000-4000-a048-000000000001",
            action: "provisioning_job_dismissed",
            actor_admin_user_id: ADMIN_ID,
            created_at: "2026-08-04T12:00:00.000Z",
          },
          {
            id: "42000000-0000-4000-a048-000000000002",
            action: "provisioning_job_restored",
            actor_admin_user_id: ADMIN_ID,
            created_at: "2026-08-05T12:00:00.000Z",
          },
        ],
        rejectedBrands: [
          {
            id: "43000000-0000-4000-a048-000000000001",
            archived_at: "2026-08-06T12:00:00.000Z",
          },
        ],
        rejectedCampaigns: [
          {
            id: "43000000-0000-4000-a048-000000000002",
            archived_at: "2026-08-07T12:00:00.000Z",
          },
        ],
        calendar: { created_at: "2026-08-08T12:00:00.000Z" },
      }),
    );

    expect(events.map((event) => event.title)).toEqual([
      "Calendar connected",
      "Campaign archived during registration recovery",
      "Rejected brand archived",
      "Provisioning issue restored",
      "Provisioning issue dismissed",
      "Onboarding completed; account launched",
      "Registration submitted",
      "Compliance information completed",
    ]);
    expect(events.find((event) => event.category === "admin")?.actor).toBe(
      ADMIN_ID,
    );
  });

  it("maps every known risk, registration, and existing-brand event without arbitrary source text", () => {
    const riskTypes = [
      "scan_passed",
      "scan_blocked",
      "scan_pending_review",
      "review_email_sent",
      "admin_approved",
    ];
    const registrationTypes = [
      "brand_submitted",
      "brand_status_changed",
      "campaign_submitted",
      "campaign_status_changed",
      "campaign_status_refreshed",
      "messaging_profile_created",
      "messaging_profile_create_intent",
      "voice_application_created",
      "voice_application_create_intent",
      "campaign_preflight_checked",
      "phone_number_assignment_started",
      "phone_number_assignment_status_changed",
      "phone_number_assignment_failed",
    ];
    const brandTypes = [
      "approval_invalidated",
      "inspection_recorded",
      "link_staged",
      "link_approved",
      "link_blocked",
      "link_reset",
      "link_consumed",
    ];
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        riskEvents: riskTypes.map((event_type, index) => ({
          id: `50000000-0000-4000-a048-${String(index + 1).padStart(12, "0")}`,
          event_type,
          created_at: AT,
          reviewed_by: event_type === "admin_approved" ? "admin@test" : null,
        })),
        registrationEvents: registrationTypes.map((event_type, index) => ({
          id: `51000000-0000-4000-a048-${String(index + 1).padStart(12, "0")}`,
          event_type,
          created_at: AT,
        })),
        brandLinkEvents: brandTypes.map((event_type, index) => ({
          id: `52000000-0000-4000-a048-${String(index + 1).padStart(12, "0")}`,
          event_type,
          actor_user_id: "system:paid_launch",
          created_at: AT,
        })),
      }),
    );

    expect(events).toHaveLength(
      riskTypes.length + registrationTypes.length + brandTypes.length,
    );
    expect(
      events.find((event) => event.title === "A2P risk review approved")
        ?.actor,
    ).toBe("admin@test");
    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining([
        "Brand submission attempt recorded",
        "Campaign submission attempt recorded",
        "Messaging-profile creation attempt recorded",
        "Voice-application creation attempt recorded",
        "Campaign preflight check recorded",
      ]),
    );
    expect(events.map((event) => event.title).join(" ")).not.toContain(
      "raw provider text",
    );
  });

  it("omits unknown event types and nullable timestamps", () => {
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        riskEvents: [
          {
            id: "50000000-0000-4000-a048-000000000099",
            event_type: "future_risk_event",
            created_at: AT,
            reviewed_by: null,
          },
          {
            id: "50000000-0000-4000-a048-000000000098",
            event_type: "scan_passed",
            created_at: null,
            reviewed_by: null,
          },
          {
            id: "50000000-0000-4000-a048-000000000097",
            event_type: "toString",
            created_at: AT,
            reviewed_by: null,
          },
        ],
        registrationEvents: [
          {
            id: "51000000-0000-4000-a048-000000000099",
            event_type: "future_registration_event",
            created_at: AT,
          },
        ],
        brandLinkEvents: [
          {
            id: "52000000-0000-4000-a048-000000000099",
            event_type: "future_brand_event",
            actor_user_id: null,
            created_at: AT,
          },
        ],
        rejectedBrands: [
          {
            id: "53000000-0000-4000-a048-000000000099",
            archived_at: null,
          },
        ],
        calendar: { created_at: null },
      }),
    );

    expect(events).toEqual([]);
  });

  it("drops unsafe actor scalars without discarding otherwise valid events", () => {
    const events = normalizeAdminAccountActivity(
      emptySnapshot({
        riskEvents: [
          {
            id: "50000000-0000-4000-a048-000000000096",
            event_type: "admin_approved",
            created_at: AT,
            reviewed_by: "x".repeat(255),
          },
        ],
        brandLinkEvents: [
          {
            id: "52000000-0000-4000-a048-000000000096",
            event_type: "link_approved",
            actor_user_id: "unsafe\u0000actor",
            created_at: AT,
          },
        ],
      }),
    );

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.actor === null)).toBe(true);
  });

  it("sorts deterministically and applies the global newest-100 limit", () => {
    const registrationEvents = Array.from({ length: 102 }, (_, index) => ({
      id: `54000000-0000-4000-a048-${String(index + 1).padStart(12, "0")}`,
      event_type: "campaign_status_refreshed",
      created_at:
        index < 2
          ? "2026-08-05T12:00:00.000Z"
          : "2026-08-04T12:00:00.000Z",
    }));

    const events = normalizeAdminAccountActivity(
      emptySnapshot({ registrationEvents }),
    );

    expect(events).toHaveLength(100);
    expect(events[0].id).toContain("000000000001");
    expect(events[1].id).toContain("000000000002");
    expect(events.some((event) => event.id.endsWith("000000000102"))).toBe(
      false,
    );
  });
});

describe("loadAdminAccountActivity", () => {
  it("runs minimized per-account reads and returns an empty complete timeline", async () => {
    await expect(loadAdminAccountActivity(BUSINESS_ID)).resolves.toEqual([]);

    expect(mocks.from).toHaveBeenCalledTimes(12);
    expect(mocks.from).toHaveBeenCalledWith("businesses");
    expect(mocks.from).toHaveBeenCalledWith(
      "telnyx_resource_release_reasons",
    );
    expect(mocks.from).toHaveBeenCalledWith("a2p_risk_review_events");
    expect(mocks.from).toHaveBeenCalledWith("telnyx_registration_events");
    expect(mocks.from).toHaveBeenCalledWith("google_calendar_tokens");
    for (const query of mocks.queries) {
      expect(query.eq).toHaveBeenCalledWith(
        expect.stringMatching(/^(id|business_id)$/),
        BUSINESS_ID,
      );
    }

    const riskQuery = mocks.queries.find(
      (query) => query.table === "a2p_risk_review_events",
    )!;
    expect(riskQuery.in).toHaveBeenCalledWith(
      "event_type",
      expect.arrayContaining(["scan_passed", "admin_approved"]),
    );
    expect(riskQuery.not).toHaveBeenCalledWith("created_at", "is", null);

    const operationalQuery = mocks.queries.find(
      (query) =>
        query.table === "admin_action_events" &&
        query.select.mock.calls[0]?.[0] ===
          ACCOUNT_ACTIVITY_COLUMNS.operationalAdmin,
    )!;
    expect(operationalQuery.eq).toHaveBeenCalledWith(
      "business_id",
      BUSINESS_ID,
    );
    expect(operationalQuery.in).toHaveBeenCalledWith("action", [
      "account_operations_suspended",
      "account_operations_reactivated",
      "account_service_paused",
      "account_service_resumed",
    ]);
    expect(operationalQuery.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(operationalQuery.order).toHaveBeenCalledWith("id", {
      ascending: true,
    });
    expect(operationalQuery.limit).toHaveBeenCalledWith(100);

    const rejectedQueries = mocks.queries.filter((query) =>
      ["rejected_brands", "rejected_campaigns"].includes(query.table),
    );
    for (const query of rejectedQueries) {
      expect(query.not).toHaveBeenCalledWith("archived_at", "is", null);
    }

    for (const query of mocks.queries.filter(
      (query) => query.limit.mock.calls.length > 0,
    )) {
      expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
    }
  });

  it("loads provisioning actions only through the current job's exact business association", async () => {
    mocks.queues.set("partner_client_provisioning_jobs", [
      { data: { id: JOB_ID }, error: null },
    ]);
    mocks.queues.set("admin_action_events", [
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "60000000-0000-4000-a048-000000000001",
            action: "provisioning_job_dismissed",
            actor_admin_user_id: ADMIN_ID,
            created_at: AT,
          },
        ],
        error: null,
      },
    ]);

    const events = await loadAdminAccountActivity(BUSINESS_ID);

    expect(events).toEqual([
      expect.objectContaining({
        category: "admin",
        title: "Provisioning issue dismissed",
      }),
    ]);
    const jobActionQuery = mocks.queries.find(
      (query) =>
        query.table === "admin_action_events" &&
        query.eq.mock.calls.some(([column]) => column === "provisioning_job_id"),
    )!;
    expect(jobActionQuery.eq).toHaveBeenCalledWith(
      "provisioning_job_id",
      JOB_ID,
    );
    expect(jobActionQuery.eq).not.toHaveBeenCalledWith(
      "business_id",
      BUSINESS_ID,
    );
  });

  it("omits orphan provisioning actions when no exact current job exists", async () => {
    await loadAdminAccountActivity(BUSINESS_ID);

    expect(
      mocks.queries.filter(
        (query) =>
          query.table === "admin_action_events" &&
          query.eq.mock.calls.some(
            ([column]) => column === "provisioning_job_id",
          ),
      ),
    ).toHaveLength(0);
  });

  it("fails the entire timeline when any direct source read fails", async () => {
    const failure = { code: "42501", message: "permission denied" };
    mocks.queues.set("a2p_risk_review_events", [
      { data: null, error: failure },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "query_failed",
      source: "risk review activity",
      cause: failure,
    });
  });

  it("loads operational actions through the minimized business query", async () => {
    mocks.queues.set("admin_action_events", [
      { data: [], error: null },
      {
        data: [
          {
            id: "61000000-0000-4000-a048-000000000001",
            action: "account_service_paused",
            actor_admin_user_id: ADMIN_ID,
            created_at: AT,
            reason: "Administrative maintenance",
            service: "texting",
          },
        ],
        error: null,
      },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).resolves.toEqual([
      expect.objectContaining({
        title: "Texting paused",
        detail: "Administrative maintenance",
        actor: ADMIN_ID,
      }),
    ]);
  });

  it("accepts operational reasons up to 500 Unicode code points", async () => {
    const reason = "😀".repeat(500);
    mocks.queues.set("admin_action_events", [
      { data: [], error: null },
      {
        data: [
          {
            id: "61000000-0000-4000-a048-000000000003",
            action: "account_operations_suspended",
            actor_admin_user_id: ADMIN_ID,
            created_at: AT,
            reason,
            service: null,
          },
        ],
        error: null,
      },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).resolves.toEqual([
      expect.objectContaining({
        title: "Account operations suspended",
        detail: reason,
      }),
    ]);
  });

  it("fails the entire timeline when the operational action read fails", async () => {
    const failure = { code: "42501", message: "permission denied" };
    mocks.queues.set("admin_action_events", [
      { data: [], error: null },
      { data: null, error: failure },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "query_failed",
      source: "operational admin actions",
      cause: failure,
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
      "account action with service",
      {
        action: "account_operations_reactivated",
        reason: "Review completed successfully",
        service: "texting",
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
      "service action with short reason",
      {
        action: "account_service_resumed",
        reason: "short",
        service: "bookings",
      },
    ],
    [
      "service action with more than 500 Unicode code points",
      {
        action: "account_service_resumed",
        reason: "😀".repeat(501),
        service: "bookings",
      },
    ],
  ])("rejects malformed operational audit shape: %s", async (_, overrides) => {
    mocks.queues.set("admin_action_events", [
      { data: [], error: null },
      {
        data: [
          {
            id: "61000000-0000-4000-a048-000000000002",
            actor_admin_user_id: ADMIN_ID,
            created_at: AT,
            ...overrides,
          },
        ],
        error: null,
      },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      code: "invalid_response",
      source: "operational admin actions",
    });
  });

  it("fails the entire timeline on malformed source data", async () => {
    mocks.queues.set("telnyx_registration_events", [
      { data: null, error: null },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "invalid_response",
      source: "registration activity",
    });
  });

  it("treats a missing business milestone row as an incomplete snapshot", async () => {
    mocks.queues.set("businesses", [{ data: null, error: null }]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "invalid_response",
      source: "business milestones",
    });
  });

  it("fails the entire timeline when the dependent provisioning action read fails", async () => {
    mocks.queues.set("partner_client_provisioning_jobs", [
      { data: { id: JOB_ID }, error: null },
    ]);
    mocks.queues.set("admin_action_events", [
      { data: [], error: null },
      { data: [], error: null },
      { data: null, error: { message: "job audit unavailable" } },
    ]);

    await expect(loadAdminAccountActivity(BUSINESS_ID)).rejects.toMatchObject({
      name: "AdminAccountActivityUnavailableError",
      code: "query_failed",
      source: "provisioning admin actions",
    });
  });

  it("rejects an invalid business ID before any service-role read", async () => {
    await expect(loadAdminAccountActivity("not-a-uuid")).rejects.toMatchObject({
      code: "invalid_business_id",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("projects only approved scalar fields and uses Calendar created_at only", () => {
    expect(ACCOUNT_ACTIVITY_COLUMNS.risk).toContain(
      "reviewed_by:raw_payload->>reviewedBy",
    );
    expect(ACCOUNT_ACTIVITY_COLUMNS.calendar).toBe("created_at");
    expect(ACCOUNT_ACTIVITY_COLUMNS.operationalAdmin).toBe(
      "id, action, actor_admin_user_id, created_at, reason:summary->>reason, service:summary->>service",
    );

    const projectionsWithoutOperational = Object.entries(
      ACCOUNT_ACTIVITY_COLUMNS,
    )
      .filter(([key]) => key !== "operationalAdmin")
      .map(([, projection]) => projection)
      .join(" ");
    for (const forbidden of [
      "access_token",
      "refresh_token",
      "updated_at",
      "summary",
      "message",
      "findings",
      "rejection_reason",
      "telnyx_resource_id",
      "telnyx_brand_id",
      "telnyx_campaign_id",
      "content",
    ]) {
      expect(projectionsWithoutOperational).not.toContain(forbidden);
    }
    expect(ACCOUNT_ACTIVITY_COLUMNS.operationalAdmin).not.toMatch(
      /(?:^|,\s*)summary(?:,|$)/,
    );
    expect(
      ACCOUNT_ACTIVITY_COLUMNS.operationalAdmin.match(/summary->>/g),
    ).toHaveLength(2);
    expect(projectionsWithoutOperational.match(/raw_payload/g)).toHaveLength(1);
  });
});
