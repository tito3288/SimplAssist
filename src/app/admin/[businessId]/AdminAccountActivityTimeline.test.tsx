import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AdminAccountActivityEvent,
  AdminAccountActivityFacet,
} from "@/lib/admin/accountActivity.server";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_WINDOW_SIZE,
  AdminAccountActivityTimeline,
  buildAdminAccountActivityTimelineView,
  reduceAdminAccountActivityView,
  type AdminAccountActivityFilter,
  type AdminAccountActivityTimelineItem,
  type AdminAccountActivityViewState,
} from "./AdminAccountActivityTimeline";

const CAPTION =
  "Recorded activity only. Partner assignment, billing-mode, and billing-flag changes were not historically recorded. Historical provisioning actions are available only while a stored job association still links them to the account.";

function defaultFacets(
  category: AdminAccountActivityEvent["category"],
): AdminAccountActivityFacet[] {
  if (category === "lifecycle") return ["lifecycle"];
  if (category === "admin") return ["admin"];
  if (
    category === "risk_review" ||
    category === "registration" ||
    category === "brand" ||
    category === "rejection"
  ) {
    return ["registration"];
  }
  return [];
}

function event(
  id: string,
  category: AdminAccountActivityEvent["category"],
  occurredAt: string,
  overrides: Partial<AdminAccountActivityEvent> = {},
): AdminAccountActivityEvent {
  return {
    id,
    category,
    facets: defaultFacets(category),
    registrationEventType: null,
    occurredAt,
    title: `${category} event ${id}`,
    detail: `${category} detail`,
    actor: `${category} actor`,
    ...overrides,
  };
}

function state(
  filter: AdminAccountActivityFilter = "all",
  visibleOptionalItems = ACTIVITY_WINDOW_SIZE,
): AdminAccountActivityViewState {
  return { filter, visibleOptionalItems };
}

function itemEventIds(items: AdminAccountActivityTimelineItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === "event"
      ? [item.event.id]
      : item.events.map((groupedEvent) => groupedEvent.id),
  );
}

describe("AdminAccountActivityTimeline", () => {
  it("defaults to All with exclusive filter buttons in the approved order", () => {
    const events = [
      event("lifecycle:1", "lifecycle", "2026-08-01T12:00:00.000Z"),
      event("admin:1", "admin", "2026-08-07T12:00:00.000Z"),
      event("risk:1", "risk_review", "2026-08-06T12:00:00.000Z"),
      event("registration:1", "registration", "2026-08-05T12:00:00.000Z"),
      event("brand:1", "brand", "2026-08-04T12:00:00.000Z"),
      event("rejection:1", "rejection", "2026-08-03T12:00:00.000Z"),
      event("calendar:1", "calendar", "2026-08-02T12:00:00.000Z"),
    ];

    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline events={events} />,
    );

    expect(ACTIVITY_FILTERS.map((filter) => filter.label)).toEqual([
      "All",
      "Lifecycle",
      "Admin actions",
      "Registration",
    ]);
    expect(html).toContain(
      'role="group" aria-label="Filter account activity"',
    );
    expect(html).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*>All<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*aria-pressed="false"[^>]*>Lifecycle<\/button>/,
    );
    expect(html.indexOf(">All</button>")).toBeLessThan(
      html.indexOf(">Lifecycle</button>"),
    );
    expect(html.indexOf(">Lifecycle</button>")).toBeLessThan(
      html.indexOf(">Admin actions</button>"),
    );
    expect(html.indexOf(">Admin actions</button>")).toBeLessThan(
      html.indexOf(">Registration</button>"),
    );
    expect(html).toContain(
      '<ol id="recorded-account-activity" aria-label="Recorded account activity"',
    );
    for (const label of [
      "Lifecycle",
      "Admin action",
      "Risk review",
      "Registration",
      "Brand",
      "Rejection",
      "Calendar",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(
      '<time dateTime="2026-08-07T12:00:00.000Z"',
    );
    expect(html).toContain("Aug 7, 2026, 12:00 PM UTC");
    expect(html.indexOf("admin event admin:1")).toBeLessThan(
      html.indexOf("lifecycle event lifecycle:1"),
    );
  });

  it("maps filters exclusively, keeps a dual-facet deletion in both views, and never duplicates it in All", () => {
    const events = [
      event("deletion", "lifecycle", "2026-08-08T12:00:00.000Z", {
        facets: ["lifecycle", "admin"],
      }),
      event("lifecycle", "lifecycle", "2026-08-07T12:00:00.000Z"),
      event("admin", "admin", "2026-08-06T12:00:00.000Z"),
      event("risk", "risk_review", "2026-08-05T12:00:00.000Z"),
      event("registration", "registration", "2026-08-04T12:00:00.000Z"),
      event("brand", "brand", "2026-08-03T12:00:00.000Z"),
      event("rejection", "rejection", "2026-08-02T12:00:00.000Z"),
      event("calendar", "calendar", "2026-08-01T12:00:00.000Z"),
    ];

    const all = buildAdminAccountActivityTimelineView(events, state("all"));
    const lifecycle = buildAdminAccountActivityTimelineView(
      events,
      state("lifecycle"),
    );
    const admin = buildAdminAccountActivityTimelineView(
      events,
      state("admin"),
    );
    const registration = buildAdminAccountActivityTimelineView(
      events,
      state("registration"),
    );

    expect(itemEventIds(all.items)).toEqual([
      "deletion",
      "lifecycle",
      "admin",
      "risk",
      "registration",
      "brand",
      "rejection",
      "calendar",
    ]);
    expect(itemEventIds(all.items).filter((id) => id === "deletion")).toHaveLength(
      1,
    );
    expect(itemEventIds(lifecycle.items)).toEqual(["deletion", "lifecycle"]);
    expect(itemEventIds(admin.items)).toEqual(["deletion", "admin"]);
    expect(itemEventIds(registration.items)).toEqual([
      "risk",
      "registration",
      "brand",
      "rejection",
    ]);
    expect(itemEventIds(registration.items)).not.toContain("calendar");
  });

  it("always shows old protected rows in All behind more than 15 newer optional rows", () => {
    const optional = Array.from({ length: 20 }, (_, index) =>
      event(
        `registration:${String(index).padStart(2, "0")}`,
        "registration",
        `2026-08-${String(30 - index).padStart(2, "0")}T12:00:00.000Z`,
      ),
    );
    const oldLifecycle = event(
      "lifecycle:old",
      "lifecycle",
      "2025-01-01T12:00:00.000Z",
      { title: "Old lifecycle milestone" },
    );
    const oldAdmin = event(
      "admin:old",
      "admin",
      "2025-01-02T12:00:00.000Z",
      { title: "Old admin action" },
    );

    const view = buildAdminAccountActivityTimelineView(
      [...optional, oldLifecycle, oldAdmin],
      state("all"),
    );

    expect(view.items).toHaveLength(17);
    expect(view.hiddenOptionalItems).toBe(5);
    expect(itemEventIds(view.items)).toContain("lifecycle:old");
    expect(itemEventIds(view.items)).toContain("admin:old");
    expect(itemEventIds(view.items)).not.toContain("registration:15");

    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline
        events={[...optional, oldLifecycle, oldAdmin]}
      />,
    );
    expect(html).toContain("Old lifecycle milestone");
    expect(html).toContain("Old admin action");
    expect(html).toContain("Show more");
  });

  it("groups only two or more exact campaign checks on the same UTC date and exposes every original row", () => {
    const events = [
      event("check:a1", "registration", "2026-08-04T23:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
        title: "Check A1",
      }),
      event("check:a2", "registration", "2026-08-04T01:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
        title: "Check A2",
      }),
      event("check:b1", "registration", "2026-08-05T23:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
        title: "Check B1",
      }),
      event("check:b2", "registration", "2026-08-05T01:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
        title: "Check B2",
      }),
      event("check:single", "registration", "2026-08-06T12:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
        title: "Singleton check",
      }),
      event("status:title-only", "registration", "2026-08-04T12:00:00.000Z", {
        title: "Campaign registration status check recorded",
        registrationEventType: null,
      }),
    ];

    const view = buildAdminAccountActivityTimelineView(
      events,
      state("registration"),
    );
    const groups = view.items.filter(
      (item) => item.kind === "campaign_check_group",
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((item) => item.id)).toEqual([
      "campaign-status-checks:2026-08-05",
      "campaign-status-checks:2026-08-04",
    ]);
    expect(itemEventIds(groups)).toEqual([
      "check:b1",
      "check:b2",
      "check:a1",
      "check:a2",
    ]);
    expect(view.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "event",
          id: "check:single",
        }),
        expect.objectContaining({
          kind: "event",
          id: "status:title-only",
        }),
      ]),
    );

    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline events={events} />,
    );
    expect(html).toMatch(/<details(?![^>]*open)/);
    expect(html).toContain(
      "2 campaign registration status checks · Aug 5, 2026 UTC",
    );
    expect(html).toContain(
      'aria-label="Campaign registration status checks for Aug 5, 2026 UTC"',
    );
    for (const title of ["Check A1", "Check A2", "Check B1", "Check B2"]) {
      expect(html).toContain(title);
    }
  });

  it("never groups or paginates protected rows even if they carry the check discriminator", () => {
    const protectedCheck = event(
      "protected:check",
      "lifecycle",
      "2026-09-04T23:30:00.000Z",
      {
        facets: ["lifecycle", "admin"],
        registrationEventType: "campaign_status_refreshed",
      },
    );
    const optionalChecks = [
      event("optional:1", "registration", "2026-09-04T22:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
      }),
      event("optional:2", "registration", "2026-09-04T21:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
      }),
    ];
    const newerOptional = Array.from({ length: 18 }, (_, index) =>
      event(
        `newer:${index}`,
        "registration",
        `2026-08-${String(30 - index).padStart(2, "0")}T12:00:00.000Z`,
      ),
    );

    const view = buildAdminAccountActivityTimelineView(
      [...newerOptional, protectedCheck, ...optionalChecks],
      state("all"),
    );

    expect(itemEventIds(view.items)).toContain("protected:check");
    expect(
      view.items.filter(
        (item) => item.kind === "event" && item.id === "protected:check",
      ),
    ).toHaveLength(1);
    const campaignGroup = view.items.find(
      (item) => item.kind === "campaign_check_group",
    );
    expect(campaignGroup).toMatchObject({
      events: [
        expect.objectContaining({ id: "optional:1" }),
        expect.objectContaining({ id: "optional:2" }),
      ],
    });
  });

  it("counts a grouped disclosure as one top-level optional item", () => {
    const groupedChecks = [
      event("group:1", "registration", "2026-08-30T12:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
      }),
      event("group:2", "registration", "2026-08-30T11:00:00.000Z", {
        registrationEventType: "campaign_status_refreshed",
      }),
    ];
    const singles = Array.from({ length: 15 }, (_, index) =>
      event(
        `single:${index}`,
        "registration",
        `2026-08-${String(29 - index).padStart(2, "0")}T12:00:00.000Z`,
      ),
    );

    const view = buildAdminAccountActivityTimelineView(
      [...groupedChecks, ...singles],
      state("registration"),
    );

    expect(view.totalTopLevelItems).toBe(16);
    expect(view.items).toHaveLength(15);
    expect(view.hiddenOptionalItems).toBe(1);
    expect(itemEventIds(view.items)).toEqual(
      expect.arrayContaining(["group:1", "group:2"]),
    );
  });

  it("repeated Show more reaches every optional row and a filter change resets the window", () => {
    const events = Array.from({ length: 38 }, (_, index) =>
      event(
        `registration:${String(index).padStart(2, "0")}`,
        "registration",
        new Date(Date.UTC(2026, 7, 31, 12, 0, -index)).toISOString(),
      ),
    );
    let viewState = state("registration");

    expect(
      buildAdminAccountActivityTimelineView(events, viewState).items,
    ).toHaveLength(15);
    viewState = reduceAdminAccountActivityView(viewState, {
      type: "show_more",
    });
    expect(viewState.visibleOptionalItems).toBe(30);
    expect(
      buildAdminAccountActivityTimelineView(events, viewState).items,
    ).toHaveLength(30);
    viewState = reduceAdminAccountActivityView(viewState, {
      type: "show_more",
    });
    const complete = buildAdminAccountActivityTimelineView(events, viewState);
    expect(complete.items).toHaveLength(38);
    expect(complete.hiddenOptionalItems).toBe(0);
    expect(new Set(itemEventIds(complete.items))).toEqual(
      new Set(events.map((item) => item.id)),
    );

    viewState = reduceAdminAccountActivityView(viewState, {
      type: "filter",
      filter: "all",
    });
    expect(viewState).toEqual({
      filter: "all",
      visibleOptionalItems: ACTIVITY_WINDOW_SIZE,
    });
    expect(
      buildAdminAccountActivityTimelineView(events, viewState).items,
    ).toHaveLength(15);
  });

  it("removes both 100-row caps and retains deterministic ID tie-breakers", () => {
    const events = Array.from({ length: 102 }, (_, index) =>
      event(
        `lifecycle:${String(index).padStart(3, "0")}`,
        "lifecycle",
        "2026-08-04T12:00:00.000Z",
      ),
    ).reverse();

    const view = buildAdminAccountActivityTimelineView(
      events,
      state("lifecycle"),
    );

    expect(view.items).toHaveLength(102);
    expect(itemEventIds(view.items)[0]).toBe("lifecycle:000");
    expect(itemEventIds(view.items).at(-1)).toBe("lifecycle:101");
    expect(view.hiddenOptionalItems).toBe(0);
  });

  it("omits absent detail and actor instead of inventing attribution", () => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline
        events={[
          event("calendar:1", "calendar", "2026-08-04T12:00:00.000Z", {
            title: "Calendar connected",
            detail: null,
            actor: null,
          }),
        ]}
      />,
    );

    expect(html).toContain("Calendar connected");
    expect(html).not.toContain("calendar detail");
    expect(html).not.toContain("Actor:");
    expect(html).not.toContain("Unknown actor");
  });

  it("renders an explicit empty recorded-activity state", () => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline events={[]} />,
    );

    expect(html).toContain("No recorded activity is available for this account.");
    expect(html).not.toContain('aria-label="Filter account activity"');
    expect(html).not.toContain('<ol aria-label="Recorded account activity"');
  });

  it("renders Timeline unavailable without presenting supplied partial events", () => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline
        unavailable
        events={[
          event("risk:partial", "risk_review", "2026-08-04T12:00:00.000Z", {
            title: "Partial event must stay hidden",
          }),
        ]}
      />,
    );

    expect(html).toContain("Timeline unavailable");
    expect(html).toContain("No partial timeline is shown.");
    expect(html).not.toContain("Partial event must stay hidden");
    expect(html).not.toContain('aria-label="Filter account activity"');
    expect(html).not.toContain('<ol aria-label="Recorded account activity"');
  });

  it.each([
    { events: [], unavailable: false },
    { events: [], unavailable: true },
    {
      events: [
        event("lifecycle:1", "lifecycle", "2026-08-04T12:00:00.000Z"),
      ],
      unavailable: false,
    },
  ])("always renders the complete recorded-activity limitation caption", (props) => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline {...props} />,
    );

    expect(html).toContain(CAPTION);
  });
});
