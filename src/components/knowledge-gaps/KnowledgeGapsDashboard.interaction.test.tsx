import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Channel,
  KnowledgeGap,
  KnowledgeGapStatus,
} from "@/types/database";

const harness = vi.hoisted(() => ({
  state: [] as unknown[],
  cursor: 0,
}));

const mocks = vi.hoisted(() => ({
  client: { name: "browser-client" },
  createClient: vi.fn(),
  resolveKnowledgeGapWithFaq: vi.fn(),
  dismissKnowledgeGap: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initialValue: T | (() => T)) => {
      const index = harness.cursor;
      harness.cursor += 1;

      if (!Object.prototype.hasOwnProperty.call(harness.state, index)) {
        harness.state[index] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }

      const setValue = (nextValue: T | ((current: T) => T)) => {
        const current = harness.state[index] as T;
        harness.state[index] =
          typeof nextValue === "function"
            ? (nextValue as (value: T) => T)(current)
            : nextValue;
      };

      return [harness.state[index] as T, setValue] as const;
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/knowledge-gaps/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge-gaps/actions")>()),
  resolveKnowledgeGapWithFaq: mocks.resolveKnowledgeGapWithFaq,
  dismissKnowledgeGap: mocks.dismissKnowledgeGap,
}));

import {
  DUPLICATE_FAQ_MESSAGE,
  GAP_NO_LONGER_OPEN_MESSAGE,
} from "@/lib/knowledge-gaps/actions";
import KnowledgeGapsDashboard from "./KnowledgeGapsDashboard";

interface ElementProps {
  children?: ReactNode;
  [key: string]: unknown;
}

type TestElement = ReactElement<ElementProps>;

function gap({
  id,
  question,
  status = "open",
  occurrenceCount = 1,
  channel = "sms",
  lastSeenAt = "2026-07-30T18:15:00.000Z",
}: {
  id: string;
  question: string;
  status?: KnowledgeGapStatus;
  occurrenceCount?: number;
  channel?: Channel;
  lastSeenAt?: string;
}): KnowledgeGap {
  return {
    id,
    business_id: "business-1",
    question_text: question,
    normalized_question: question.toLowerCase(),
    ai_response_text: "Please contact us.",
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

function renderDashboard(initialGaps: KnowledgeGap[]): TestElement {
  harness.cursor = 0;
  return KnowledgeGapsDashboard({
    businessId: "business-1",
    initialGaps,
    loadError: null,
    timeZone: "America/Indiana/Indianapolis",
  }) as TestElement;
}

function childElements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(childElements);
  if (!isValidElement<ElementProps>(node)) return [];

  return [node, ...childElements(node.props.children)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement<ElementProps>(node)) return "";
  return textContent(node.props.children);
}

function findElements(
  tree: TestElement,
  predicate: (element: TestElement) => boolean
): TestElement[] {
  return childElements(tree).filter(predicate);
}

function findButton(
  tree: TestElement,
  label: string,
  index = 0
): TestElement {
  const buttons = findElements(
    tree,
    (element) =>
      element.type === "button" && textContent(element) === label
  );
  const button = buttons[index];
  if (!button) throw new Error(`Button not found: ${label} at ${index}`);
  return button;
}

function invoke(
  element: TestElement,
  prop: string,
  ...args: unknown[]
): unknown {
  const handler = element.props[prop];
  if (typeof handler !== "function") {
    throw new Error(`Missing ${prop} handler`);
  }
  return handler(...args);
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
  harness.state = [];
  harness.cursor = 0;
  mocks.createClient.mockReturnValue(mocks.client);
});

describe("KnowledgeGapsDashboard interactions", () => {
  it("wires All/Newest controls and keeps terminal rows read-only", () => {
    const gaps = [
      gap({
        id: "open",
        question: "Open question",
        occurrenceCount: 5,
        lastSeenAt: "2026-07-20T00:00:00.000Z",
      }),
      gap({
        id: "resolved",
        question: "Resolved question",
        status: "resolved",
        occurrenceCount: 2,
        lastSeenAt: "2026-07-30T00:00:00.000Z",
      }),
      gap({
        id: "dismissed",
        question: "Dismissed question",
        status: "dismissed",
        lastSeenAt: "2026-07-25T00:00:00.000Z",
      }),
    ];

    let tree = renderDashboard(gaps);
    invoke(findButton(tree, "All"), "onClick");
    tree = renderDashboard(gaps);

    let articles = findElements(tree, (element) => element.type === "article");
    expect(articles.map(textContent)).toEqual([
      expect.stringContaining("Open question"),
      expect.stringContaining("Resolved question"),
      expect.stringContaining("Dismissed question"),
    ]);
    for (const terminalArticle of articles.slice(1)) {
      const terminalButtons = childElements(terminalArticle)
        .filter((element) => element.type === "button")
        .map(textContent);
      expect(terminalButtons).not.toContain("Answer this");
      expect(terminalButtons).not.toContain("Dismiss");
    }

    const sortSelect = findElements(
      tree,
      (element) => element.type === "select"
    )[0];
    invoke(sortSelect, "onChange", { target: { value: "newest" } });
    tree = renderDashboard(gaps);
    articles = findElements(tree, (element) => element.type === "article");

    expect(articles.map((article) => textContent(article))).toEqual([
      expect.stringContaining("Resolved question"),
      expect.stringContaining("Dismissed question"),
      expect.stringContaining("Open question"),
    ]);
  });

  it("prefills and resolves an FAQ while globally locking competing actions", async () => {
    const gaps = [
      gap({ id: "first", question: "Do you offer free trials?" }),
      gap({ id: "second", question: "Do you offer memberships?" }),
    ];
    const resolution = deferred<{
      ok: true;
      faqId: string;
      question: string;
      answer: string;
    }>();
    mocks.resolveKnowledgeGapWithFaq.mockReturnValue(resolution.promise);

    let tree = renderDashboard(gaps);
    invoke(findButton(tree, "Answer this"), "onClick");
    tree = renderDashboard(gaps);

    const questionInput = findElements(
      tree,
      (element) => element.type === "input"
    )[0];
    const answerInput = findElements(
      tree,
      (element) => element.type === "textarea"
    )[0];
    expect(questionInput.props.value).toBe("Do you offer free trials?");
    expect(answerInput.props.value).toBe("");

    invoke(questionInput, "onChange", {
      target: { value: "  Are free trials available?  " },
    });
    invoke(answerInput, "onChange", {
      target: { value: "  Yes, for seven days.  " },
    });
    tree = renderDashboard(gaps);

    const form = findElements(tree, (element) => element.type === "form")[0];
    const preventDefault = vi.fn();
    const submission = invoke(form, "onSubmit", {
      preventDefault,
    }) as Promise<void>;

    tree = renderDashboard(gaps);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(findButton(tree, "Answer this").props.disabled).toBe(true);
    expect(findButton(tree, "All").props.disabled).toBe(true);
    expect(
      findElements(tree, (element) => element.type === "select")[0].props
        .disabled
    ).toBe(true);

    resolution.resolve({
      ok: true,
      faqId: "faq-1",
      question: "Are free trials available?",
      answer: "Yes, for seven days.",
    });
    await submission;
    tree = renderDashboard(gaps);

    expect(mocks.resolveKnowledgeGapWithFaq).toHaveBeenCalledWith(
      mocks.client,
      {
        gapId: "first",
        question: "  Are free trials available?  ",
        answer: "  Yes, for seven days.  ",
      }
    );
    expect((harness.state[0] as KnowledgeGap[])[0]).toMatchObject({
      status: "resolved",
      resolved_faq_id: "faq-1",
    });
    expect(textContent(tree)).not.toContain("Do you offer free trials?");
    expect(textContent(tree)).toContain("Do you offer memberships?");
  });

  it("keeps the inline form open for validation and duplicate errors", async () => {
    const gaps = [
      gap({ id: "first", question: "Do you offer free trials?" }),
    ];

    let tree = renderDashboard(gaps);
    invoke(findButton(tree, "Answer this"), "onClick");
    tree = renderDashboard(gaps);

    let form = findElements(tree, (element) => element.type === "form")[0];
    await (invoke(form, "onSubmit", {
      preventDefault: vi.fn(),
    }) as Promise<void>);
    tree = renderDashboard(gaps);
    expect(textContent(tree)).toContain("An answer is required.");
    expect(mocks.resolveKnowledgeGapWithFaq).not.toHaveBeenCalled();

    let answerInput = findElements(
      tree,
      (element) => element.type === "textarea"
    )[0];
    invoke(answerInput, "onChange", {
      target: { value: "a".repeat(2001) },
    });
    tree = renderDashboard(gaps);
    form = findElements(tree, (element) => element.type === "form")[0];
    await (invoke(form, "onSubmit", {
      preventDefault: vi.fn(),
    }) as Promise<void>);
    tree = renderDashboard(gaps);
    expect(textContent(tree)).toContain(
      "Answer must be 2,000 characters or less."
    );
    expect(mocks.resolveKnowledgeGapWithFaq).not.toHaveBeenCalled();

    answerInput = findElements(
      tree,
      (element) => element.type === "textarea"
    )[0];
    invoke(answerInput, "onChange", {
      target: { value: "Please contact us." },
    });
    mocks.resolveKnowledgeGapWithFaq.mockResolvedValue({
      ok: false,
      message: DUPLICATE_FAQ_MESSAGE,
    });
    tree = renderDashboard(gaps);
    form = findElements(tree, (element) => element.type === "form")[0];
    await (invoke(form, "onSubmit", {
      preventDefault: vi.fn(),
    }) as Promise<void>);
    tree = renderDashboard(gaps);

    expect(textContent(tree)).toContain(DUPLICATE_FAQ_MESSAGE);
    expect(findElements(tree, (element) => element.type === "form")).toHaveLength(
      1
    );
    expect((harness.state[0] as KnowledgeGap[])[0].status).toBe("open");
  });

  it("confirms dismissal and updates locally only after success", async () => {
    const gaps = [
      gap({ id: "first", question: "Do you offer free trials?" }),
    ];

    let tree = renderDashboard(gaps);
    invoke(findButton(tree, "Dismiss"), "onClick");
    tree = renderDashboard(gaps);

    mocks.dismissKnowledgeGap.mockResolvedValueOnce({
      ok: false,
      message: GAP_NO_LONGER_OPEN_MESSAGE,
    });
    await (invoke(
      findButton(tree, "Confirm dismiss"),
      "onClick"
    ) as Promise<void>);
    tree = renderDashboard(gaps);
    expect(textContent(tree)).toContain(GAP_NO_LONGER_OPEN_MESSAGE);
    expect((harness.state[0] as KnowledgeGap[])[0].status).toBe("open");

    mocks.dismissKnowledgeGap.mockResolvedValueOnce({ ok: true });
    await (invoke(
      findButton(tree, "Confirm dismiss"),
      "onClick"
    ) as Promise<void>);
    tree = renderDashboard(gaps);

    expect(mocks.dismissKnowledgeGap).toHaveBeenLastCalledWith(
      mocks.client,
      {
        businessId: "business-1",
        gapId: "first",
      }
    );
    expect((harness.state[0] as KnowledgeGap[])[0].status).toBe(
      "dismissed"
    );
    expect(textContent(tree)).toContain("No open knowledge gaps");
  });
});
