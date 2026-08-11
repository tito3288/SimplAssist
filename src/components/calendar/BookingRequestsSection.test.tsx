import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  state: [] as unknown[],
  stateCursor: 0,
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T,>(initialValue: T) => {
      const index = harness.refCursor;
      harness.refCursor += 1;
      if (!harness.refs[index]) {
        harness.refs[index] = { current: initialValue };
      }
      return harness.refs[index] as { current: T };
    },
    useState: <T,>(initialValue: T | (() => T)) => {
      const index = harness.stateCursor;
      harness.stateCursor += 1;
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

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import BookingRequestsSection, {
  type BookingRequestListItem,
} from "./BookingRequestsSection";

interface ElementProps {
  children?: ReactNode;
  [key: string]: unknown;
}

type TestElement = ReactElement<ElementProps>;

function request(
  id: string,
  overrides: Partial<BookingRequestListItem> = {}
): BookingRequestListItem {
  return {
    id,
    conversation_id: `conversation-${id}`,
    requested_service: `Service ${id}`,
    requested_time_text: "next Tuesday after lunch",
    customer_name: `Customer ${id}`,
    customer_phone: null,
    customer_email: null,
    status: "new",
    handled_at: null,
    created_at: "2026-08-10T17:30:00.000Z",
    contact: {
      name: `Linked ${id}`,
      phone_number: null,
      email: null,
    },
    ...overrides,
  };
}

function renderSection({
  requests = [request("one")],
  count = requests.filter((item) => item.status === "new").length,
  listLoadFailed = false,
  timeZone = "America/Indiana/Indianapolis",
}: {
  requests?: BookingRequestListItem[];
  count?: number | null;
  listLoadFailed?: boolean;
  timeZone?: string;
} = {}): TestElement {
  harness.stateCursor = 0;
  harness.refCursor = 0;
  return BookingRequestsSection({
    initialRequests: requests,
    initialNewCount: count,
    listLoadFailed,
    timeZone,
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

function findButtons(tree: TestElement): TestElement[] {
  return findElements(
    tree,
    (element) =>
      element.type === "button" && textContent(element) === "Mark handled"
  );
}

function invoke(element: TestElement, prop: string): unknown {
  const handler = element.props[prop];
  if (typeof handler !== "function") throw new Error(`Missing ${prop}`);
  return handler();
}

function response({
  ok,
  id = "one",
  handledAt = "2026-08-11T18:00:00.000Z",
}: {
  ok: boolean;
  id?: string;
  handledAt?: string;
}) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(
      ok
        ? { request: { id, status: "handled", handledAt } }
        : { error: "private server detail" }
    ),
  };
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
  harness.stateCursor = 0;
  harness.refs = [];
  harness.refCursor = 0;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BookingRequestsSection rendering", () => {
  it("uses the complete captured-then-linked contact fallback chain", () => {
    const requests = [
      request("captured-name", {
        customer_name: "  Captured Name  ",
      }),
      request("linked-name", {
        customer_name: "   ",
        contact: {
          name: "  Linked Name  ",
          phone_number: "3175550101",
          email: "linked-name@example.test",
        },
      }),
      request("captured-phone", {
        customer_name: null,
        customer_phone: "3175550102",
        contact: {
          name: null,
          phone_number: "3175550199",
          email: "linked-phone@example.test",
        },
      }),
      request("linked-phone", {
        customer_name: null,
        customer_phone: null,
        contact: {
          name: null,
          phone_number: "3175550103",
          email: "linked-phone@example.test",
        },
      }),
      request("captured-email", {
        customer_name: null,
        customer_phone: null,
        customer_email: "  captured@example.test  ",
        contact: {
          name: null,
          phone_number: null,
          email: "linked-email@example.test",
        },
      }),
      request("linked-email", {
        customer_name: null,
        customer_phone: null,
        customer_email: " ",
        contact: {
          name: null,
          phone_number: null,
          email: "  linked@example.test  ",
        },
      }),
      request("unavailable", {
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        contact: null,
      }),
    ];

    const markup = renderToStaticMarkup(renderSection({ requests }));

    expect(markup).toContain("Captured Name");
    expect(markup).toContain("Linked Name");
    expect(markup).toContain("(317) 555-0102");
    expect(markup).toContain("(317) 555-0103");
    expect(markup).toContain("captured@example.test");
    expect(markup).toContain("linked@example.test");
    expect(markup).toContain("Contact unavailable");
    expect(markup).not.toContain("Linked captured-name");
    expect(markup).not.toContain("linked-phone@example.test");
    expect(markup).not.toContain("linked-email@example.test");
  });

  it("keeps natural-language request text verbatim and formats only system time in the business timezone", () => {
    const markup = renderToStaticMarkup(
      renderSection({
        requests: [
          request("raw", {
            conversation_id: "conversation/raw?from=request",
            requested_service: "  Drain cleaning\nwith camera  ",
            requested_time_text: "not specified",
          }),
        ],
      })
    );

    expect(markup).toContain("  Drain cleaning\nwith camera  ");
    expect(markup).toContain("not specified");
    expect(markup).toContain("Aug 10, 2026, 1:30 PM");
    expect(markup).toContain(
      'href="/conversations?conversation=conversation%2Fraw%3Ffrom%3Drequest"'
    );
  });

  it("shows request-only labels, terminal handled rows, and unavailable conversation provenance", () => {
    const tree = renderSection({
      requests: [
        request("new", { conversation_id: null }),
        request("handled", {
          status: "handled",
          handled_at: "2026-08-11T18:00:00.000Z",
        }),
      ],
      count: 1,
    });
    const visibleText = textContent(tree);

    expect(visibleText).toContain("Appointment requests");
    expect(visibleText).toContain("New requests1");
    expect(visibleText).toContain("New request");
    expect(visibleText).toContain("Handled");
    expect(visibleText).toContain("Mark handled");
    expect(visibleText).toContain("Conversation unavailable");
    expect(findButtons(tree)).toHaveLength(1);
    expect(visibleText).not.toMatch(/\b(?:bookings?|booked|confirmed)\b/i);
  });

  it("separates list failure from empty state and renders an unknown count as an em dash", () => {
    const failed = renderToStaticMarkup(
      renderSection({ requests: [], count: null, listLoadFailed: true })
    );
    expect(failed).toContain("Appointment requests could not be loaded.");
    expect(failed).toContain(">—</p>");
    expect(failed).not.toContain("No appointment requests yet.");

    harness.state = [];
    harness.refs = [];
    const empty = renderToStaticMarkup(
      renderSection({ requests: [], count: 0 })
    );
    expect(empty).toContain("No appointment requests yet.");
    expect(empty).toContain(">0</p>");
  });

  it("does not claim an empty history when an independent count indicates rows", () => {
    const markup = renderToStaticMarkup(
      renderSection({ requests: [], count: 3 })
    );
    expect(markup).toContain(">3</p>");
    expect(markup).toContain(
      "Appointment request details are temporarily unavailable."
    );
    expect(markup).not.toContain("No appointment requests yet.");
  });

  it("falls back to UTC for invalid legacy timezones", () => {
    const markup = renderToStaticMarkup(
      renderSection({ timeZone: "Legacy/Invalid" })
    );
    expect(markup).toContain("Aug 10, 2026, 5:30 PM");
  });
});

describe("BookingRequestsSection handling", () => {
  it("updates one row in place and decrements a known new count once", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response({ ok: true }) as never);
    const requests = [request("one"), request("two")];

    let tree = renderSection({ requests, count: 2 });
    await invoke(findButtons(tree)[0], "onClick");
    tree = renderSection({ requests, count: 2 });
    const markup = renderToStaticMarkup(tree);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/booking-requests/one/handle",
      { method: "POST" }
    );
    expect(markup).toContain("New requests</p><p");
    expect(markup).toContain(">1</p>");
    expect(markup).toContain("Aug 11, 2026, 2:00 PM");
    expect(textContent(tree).match(/Handled/g)).toHaveLength(1);
    expect(findButtons(tree)).toHaveLength(1);
  });

  it("synchronously deduplicates rapid clicks and disables only the active row", async () => {
    const pendingResponse = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReturnValue(pendingResponse.promise as never);
    const requests = [request("one"), request("two")];

    let tree = renderSection({ requests, count: 2 });
    const firstButton = findButtons(tree)[0];
    const firstClick = invoke(firstButton, "onClick") as Promise<void>;
    const duplicateClick = invoke(firstButton, "onClick") as Promise<void>;

    expect(fetchMock).toHaveBeenCalledOnce();
    tree = renderSection({ requests, count: 2 });
    expect(findButtons(tree)[0].props.disabled).toBe(true);
    expect(findButtons(tree)[0].props["aria-busy"]).toBe(true);
    expect(findButtons(tree)[1].props.disabled).toBe(false);

    pendingResponse.resolve(response({ ok: true }));
    await Promise.all([firstClick, duplicateClick]);
    tree = renderSection({ requests, count: 2 });
    expect(textContent(tree)).toContain("New requests1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps retry errors scoped to their row and clears one on a successful retry", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response({ ok: false }) as never)
      .mockResolvedValueOnce(response({ ok: true }) as never);
    const requests = [request("one"), request("two")];

    let tree = renderSection({ requests, count: 2 });
    await invoke(findButtons(tree)[0], "onClick");
    tree = renderSection({ requests, count: 2 });
    const articles = findElements(tree, (element) => element.type === "article");
    expect(textContent(articles[0])).toContain(
      "Could not mark this request handled. Please try again."
    );
    expect(textContent(articles[1])).not.toContain("Could not mark");
    expect(textContent(tree)).toContain("New requests2");

    await invoke(findButtons(tree)[0], "onClick");
    tree = renderSection({ requests, count: 2 });
    expect(textContent(tree)).not.toContain("Could not mark");
    expect(textContent(tree)).toContain("New requests1");
  });

  it("rejects malformed success payloads without changing the row or count", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      response({ ok: true, handledAt: "not-a-timestamp" }) as never
    );
    const requests = [request("one")];

    let tree = renderSection({ requests, count: 1 });
    await invoke(findButtons(tree)[0], "onClick");
    tree = renderSection({ requests, count: 1 });

    expect(textContent(tree)).toContain("New requests1");
    expect(textContent(tree)).toContain("Could not mark this request handled");
    expect(findButtons(tree)).toHaveLength(1);
  });

  it("leaves an unknown count as a dash after successful handling", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ ok: true }) as never);
    const requests = [request("one")];

    let tree = renderSection({ requests, count: null });
    await invoke(findButtons(tree)[0], "onClick");
    tree = renderSection({ requests, count: null });

    expect(renderToStaticMarkup(tree)).toContain(">—</p>");
    expect(findButtons(tree)).toHaveLength(0);
  });
});
