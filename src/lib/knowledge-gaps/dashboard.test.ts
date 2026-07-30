import { describe, expect, it } from "vitest";
import type {
  Channel,
  KnowledgeGap,
  KnowledgeGapStatus,
} from "@/types/database";
import {
  canManageKnowledgeGap,
  dismissKnowledgeGapInList,
  filterKnowledgeGaps,
  formatKnowledgeGapChannel,
  formatKnowledgeGapLastSeen,
  formatTimesAsked,
  getKnowledgeGapCounts,
  resolveKnowledgeGapInList,
  sortKnowledgeGaps,
  type KnowledgeGapFilter,
  type KnowledgeGapSort,
} from "./dashboard";

function gap(
  id: string,
  status: KnowledgeGapStatus,
  occurrenceCount: number,
  lastSeenAt: string,
  channel: Channel = "sms"
): KnowledgeGap {
  return {
    id,
    business_id: "business-1",
    question_text: `Question ${id}`,
    normalized_question: `question ${id}`,
    ai_response_text: `Response ${id}`,
    channel,
    conversation_id: `conversation-${id}`,
    source_message_id: `message-${id}`,
    occurrence_count: occurrenceCount,
    status,
    resolved_faq_id: status === "resolved" ? `faq-${id}` : null,
    created_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: lastSeenAt,
    updated_at: lastSeenAt,
  };
}

describe("knowledge-gap dashboard presentation", () => {
  const gaps = [
    gap("open-old", "open", 2, "2026-07-20T12:00:00.000Z"),
    gap("resolved", "resolved", 8, "2026-07-28T12:00:00.000Z"),
    gap("dismissed", "dismissed", 1, "2026-07-29T12:00:00.000Z"),
    gap("open-new", "open", 2, "2026-07-30T12:00:00.000Z", "web_chat"),
  ];

  it("counts every lifecycle status", () => {
    expect(getKnowledgeGapCounts(gaps)).toEqual({
      open: 2,
      resolved: 1,
      dismissed: 1,
    });
    expect(getKnowledgeGapCounts([])).toEqual({
      open: 0,
      resolved: 0,
      dismissed: 0,
    });
  });

  it.each<KnowledgeGapFilter>([
    "open",
    "all",
    "resolved",
    "dismissed",
  ])("filters the %s view without mutating the source list", (filter) => {
    const originalOrder = gaps.map(({ id }) => id);
    const result = filterKnowledgeGaps(gaps, filter);

    expect(result.map(({ status }) => status)).toEqual(
      filter === "all"
        ? gaps.map(({ status }) => status)
        : gaps.filter(({ status }) => status === filter).map(({ status }) => status)
    );
    expect(result).not.toBe(gaps);
    expect(gaps.map(({ id }) => id)).toEqual(originalOrder);
  });

  it("sorts Most asked by occurrence count, then most recent sighting", () => {
    const input = [gaps[2], gaps[0], gaps[3], gaps[1]];

    expect(
      sortKnowledgeGaps(input, "most_asked").map(({ id }) => id)
    ).toEqual(["resolved", "open-new", "open-old", "dismissed"]);
    expect(input.map(({ id }) => id)).toEqual([
      "dismissed",
      "open-old",
      "open-new",
      "resolved",
    ]);
  });

  it("sorts Newest by most recent sighting regardless of frequency", () => {
    expect(
      sortKnowledgeGaps(gaps, "newest").map(({ id }) => id)
    ).toEqual(["open-new", "dismissed", "resolved", "open-old"]);
  });

  it("treats an invalid sighting timestamp as older than valid timestamps", () => {
    const invalid = gap("invalid", "open", 1, "not-a-date");
    const valid = gap("valid", "open", 1, "2026-07-01T00:00:00.000Z");

    expect(
      sortKnowledgeGaps([invalid, valid], "newest").map(({ id }) => id)
    ).toEqual(["valid", "invalid"]);
  });

  it("uses the stable row id when sort values tie", () => {
    const first = gap("a", "open", 1, "2026-07-01T00:00:00.000Z");
    const second = gap("b", "open", 1, "2026-07-01T00:00:00.000Z");

    expect(
      sortKnowledgeGaps([second, first], "most_asked").map(({ id }) => id)
    ).toEqual(["a", "b"]);
  });

  it.each<[KnowledgeGapSort, string[]]>([
    ["most_asked", ["resolved", "open-new", "open-old", "dismissed"]],
    ["newest", ["open-new", "dismissed", "resolved", "open-old"]],
  ])("supports the %s sort key", (sort, expected) => {
    expect(sortKnowledgeGaps(gaps, sort).map(({ id }) => id)).toEqual(
      expected
    );
  });

  it("uses singular and plural times-asked copy", () => {
    expect(formatTimesAsked(1)).toBe("Asked 1 time");
    expect(formatTimesAsked(2)).toBe("Asked 2 times");
    expect(formatTimesAsked(0)).toBe("Asked 0 times");
  });

  it("labels both supported channels for owners", () => {
    expect(formatKnowledgeGapChannel("sms")).toBe("SMS");
    expect(formatKnowledgeGapChannel("web_chat")).toBe("Web Chat");
  });

  it("formats last-seen timestamps in the business timezone with safe fallbacks", () => {
    expect(
      formatKnowledgeGapLastSeen(
        "2026-07-30T18:15:00.000Z",
        "America/Indiana/Indianapolis"
      )
    ).toBe("Jul 30, 2026, 2:15 PM");
    expect(formatKnowledgeGapLastSeen("not-a-date", "UTC")).toBe(
      "Unknown"
    );
    expect(
      formatKnowledgeGapLastSeen(
        "2026-07-30T18:15:00.000Z",
        "Invalid/Timezone"
      )
    ).toBe("Jul 30, 2026, 6:15 PM");
  });

  it("keeps resolved and dismissed rows read-only", () => {
    expect(canManageKnowledgeGap("open")).toBe(true);
    expect(canManageKnowledgeGap("resolved")).toBe(false);
    expect(canManageKnowledgeGap("dismissed")).toBe(false);
  });

  it("moves a successfully converted gap to resolved without mutating the list", () => {
    const source = [gaps[0], gaps[1]];
    const result = resolveKnowledgeGapInList(source, "open-old", "faq-new");

    expect(result).not.toBe(source);
    expect(result[0]).toMatchObject({
      status: "resolved",
      resolved_faq_id: "faq-new",
    });
    expect(source[0]).toMatchObject({
      status: "open",
      resolved_faq_id: null,
    });
    expect(getKnowledgeGapCounts(result)).toEqual({
      open: 0,
      resolved: 2,
      dismissed: 0,
    });
  });

  it("moves a successfully dismissed gap to dismissed without mutating the list", () => {
    const source = [gaps[0]];
    const result = dismissKnowledgeGapInList(source, "open-old");

    expect(result).not.toBe(source);
    expect(result[0]).toMatchObject({
      status: "dismissed",
      resolved_faq_id: null,
    });
    expect(source[0].status).toBe("open");
    expect(getKnowledgeGapCounts(result)).toEqual({
      open: 0,
      resolved: 0,
      dismissed: 1,
    });
  });
});
