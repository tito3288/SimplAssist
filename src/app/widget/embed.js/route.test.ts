import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/branding/defaultBrand", () => ({
  getCanonicalAppOrigin: () => "https://api.simplassist.test",
}));

import { GET } from "./route";

type EventListener = (event: Record<string, unknown>) => void;
type TimerCallback = () => void;

class FakeClassList {
  constructor(private readonly owner: FakeElement) {}

  add(...tokens: string[]) {
    const classes = this.classes();
    tokens.forEach((token) => classes.add(token));
    this.owner.className = Array.from(classes).join(" ");
  }

  remove(...tokens: string[]) {
    const classes = this.classes();
    tokens.forEach((token) => classes.delete(token));
    this.owner.className = Array.from(classes).join(" ");
  }

  contains(token: string) {
    return this.classes().has(token);
  }

  private classes() {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean));
  }
}

class FakeTextNode {
  parentNode: FakeElement | null = null;

  constructor(readonly textContent: string) {}

  remove() {
    this.parentNode?.removeChild(this);
  }
}

type FakeNode = FakeElement | FakeTextNode;

class FakeElement {
  readonly children: FakeNode[] = [];
  readonly classList = new FakeClassList(this);
  readonly style: Record<string, string> & {
    setProperty: (name: string, value: string) => void;
  };
  parentNode: FakeElement | null = null;
  className = "";
  value = "";
  disabled = false;
  scrollTop = 0;
  focused = false;
  src = "";
  private attributes = new Map<string, string>();
  private listeners = new Map<string, EventListener[]>();
  private ownText = "";
  private markup = "";

  constructor(readonly tagName: string) {
    const style = {} as FakeElement["style"];
    style.setProperty = (name, value) => {
      style[name] = value;
    };
    this.style = style;
  }

  get id() {
    return this.attributes.get("id") ?? "";
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.clearChildren();
    this.ownText = String(value);
    this.markup = "";
  }

  get innerHTML() {
    return this.markup || this.textContent;
  }

  set innerHTML(value: string) {
    this.clearChildren();
    this.ownText = "";
    this.markup = value;
  }

  get scrollHeight() {
    return this.children.length;
  }

  setAttribute(name: string, value: unknown) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "class") this.className = stringValue;
    if (name === "src") this.src = stringValue;
  }

  getAttribute(name: string) {
    if (name === "class") return this.className || null;
    if (name === "src") return this.src || null;
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === "class") this.className = "";
    if (name === "src") this.src = "";
  }

  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore<T extends FakeNode>(child: T, reference: FakeNode): T {
    child.parentNode?.removeChild(child);
    const index = this.children.indexOf(reference);
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  removeChild<T extends FakeNode>(child: T): T {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  before(node: FakeNode) {
    this.parentNode?.insertBefore(node, this);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus() {
    this.focused = true;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    const id = selector.startsWith("#") ? selector.slice(1) : null;

    for (const child of this.children) {
      if (!(child instanceof FakeElement)) continue;
      if (
        (className && child.classList.contains(className)) ||
        (id && child.id === id) ||
        (!className && !id && child.tagName.toLowerCase() === selector.toLowerCase())
      ) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }

    return matches;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  private clearChildren() {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
  }
}

class FakeDocument {
  readonly head = new FakeElement("head");
  readonly body = new FakeElement("body");
  readonly currentScript: FakeElement;

  constructor(
    preview = false,
    homepageOnly = false,
    scriptOrigin = "https://simplassist.test",
  ) {
    this.currentScript = new FakeElement("script");
    this.currentScript.src = `${scriptOrigin}/widget/embed.js`;
    this.currentScript.setAttribute("data-business-id", "business-123");
    if (preview) this.currentScript.setAttribute("data-preview", "true");
    if (homepageOnly) {
      this.currentScript.setAttribute("data-homepage-only", "true");
    }
  }

  createElement(tag: string) {
    return new FakeElement(tag);
  }

  createTextNode(text: string) {
    return new FakeTextNode(text);
  }

  getElementsByTagName(tag: string) {
    if (tag.toLowerCase() === "script") return [this.currentScript];
    return [...this.head.querySelectorAll(tag), ...this.body.querySelectorAll(tag)];
  }

  getElementById(id: string) {
    return this.head.querySelector(`#${id}`) ?? this.body.querySelector(`#${id}`);
  }

  querySelector(selector: string) {
    return this.head.querySelector(selector) ?? this.body.querySelector(selector);
  }
}

class FakeTimers {
  private nextId = 1;
  private scheduled: Array<{
    id: number;
    kind: "timeout" | "interval";
    delay: number;
    callback: TimerCallback;
    active: boolean;
  }> = [];

  readonly setTimeout = (callback: TimerCallback, delay = 0) =>
    this.schedule("timeout", callback, delay);

  readonly setInterval = (callback: TimerCallback, delay = 0) =>
    this.schedule("interval", callback, delay);

  readonly clearTimeout = (id: number) => this.clear(id);
  readonly clearInterval = (id: number) => this.clear(id);

  pendingTimeoutDelays() {
    return this.scheduled
      .filter((timer) => timer.active && timer.kind === "timeout")
      .map((timer) => timer.delay);
  }

  runTimeout(delay: number) {
    const timer = this.scheduled.find(
      (candidate) =>
        candidate.active && candidate.kind === "timeout" && candidate.delay === delay,
    );
    if (!timer) throw new Error(`No active timeout scheduled for ${delay}ms`);
    timer.active = false;
    timer.callback();
  }

  runInterval(delay: number) {
    const timer = this.scheduled.find(
      (candidate) =>
        candidate.active && candidate.kind === "interval" && candidate.delay === delay,
    );
    if (!timer) throw new Error(`No active interval scheduled for ${delay}ms`);
    timer.callback();
  }

  drainIntervalsBelow(maxDelay: number, maxTicks = 1_000) {
    for (let tick = 0; tick < maxTicks; tick += 1) {
      const timer = this.scheduled.find(
        (candidate) =>
          candidate.active &&
          candidate.kind === "interval" &&
          candidate.delay < maxDelay,
      );
      if (!timer) return;
      timer.callback();
    }
    throw new Error(`Active interval did not finish within ${maxTicks} ticks`);
  }

  private schedule(kind: "timeout" | "interval", callback: TimerCallback, delay: number) {
    const id = this.nextId++;
    this.scheduled.push({ id, kind, callback, delay, active: true });
    return id;
  }

  private clear(id: number) {
    const timer = this.scheduled.find((candidate) => candidate.id === id);
    if (timer) timer.active = false;
  }
}

interface QueuedResponse {
  status: number;
  body: Record<string, unknown>;
}

async function createHarness(
  responses: QueuedResponse[],
  options: {
    preview?: boolean;
    homepageOnly?: boolean;
    scriptOrigin?: string;
    uuids?: string[];
  } = {},
) {
  const response = await GET();
  const script = await response.text();
  const document = new FakeDocument(
    options.preview,
    options.homepageOnly,
    options.scriptOrigin,
  );
  const timers = new FakeTimers();
  const requests: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const storage = new Map<string, string>();
  const windowListeners = new Map<string, EventListener[]>();
  const uuids = [...(options.uuids ?? [])];

  const fetch = (url: string, init?: Record<string, unknown>) => {
    requests.push({ url, init });
    const queued = responses.shift();
    if (!queued) return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    return Promise.resolve({
      ok: queued.status >= 200 && queued.status < 300,
      status: queued.status,
      json: () => Promise.resolve(queued.body),
    });
  };

  const window = {
    __saWidgetLoaded: false,
    addEventListener(type: string, listener: EventListener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
  };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };

  const execute = new Function(
    "window",
    "document",
    "localStorage",
    "crypto",
    "fetch",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    script,
  );
  execute(
    window,
    document,
    localStorage,
    {
      randomUUID: () =>
        uuids.shift() ?? "00000000-0000-4000-8000-000000000002",
    },
    fetch,
    timers.setTimeout,
    timers.clearTimeout,
    timers.setInterval,
    timers.clearInterval,
  );

  return { document, requests, script, timers };
}

async function flushPromises() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function requestJsonBody(request: {
  init?: Record<string, unknown>;
} | undefined): Record<string, unknown> {
  const body = request?.init?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(body) as Record<string, unknown>;
}

const availableConfig = {
  available: true,
  businessName: "Acme Landscaping",
  brandColor: "#0066FF",
  position: "bottom_right",
  welcomeMessage: "How can we help?",
  quickReplies: [],
  leadCaptureEnabled: false,
  widgetToken: "test-widget-token",
  widgetSessionNonce: "abcdefghijklmnopqrstuvwx",
  widgetTokenExpiresAt: "2026-08-18T12:05:00.000Z",
};

describe("widget embed runtime", () => {
  it("generates valid standalone JavaScript", async () => {
    const response = await GET();
    const script = await response.text();

    expect(() => new Function(script)).not.toThrow();
  });

  it("is byte-identical across request hosts and preserves public delivery headers", async () => {
    const invokeWithRequest = GET as unknown as (
      request: Request,
    ) => Promise<Response>;
    const first = await invokeWithRequest(
      new Request("https://partner-one.example/widget/embed.js"),
    );
    const second = await invokeWithRequest(
      new Request("https://partner-two.example/widget/embed.js"),
    );

    expect(await first.text()).toBe(await second.text());
    expect(first.headers.get("cache-control")).toBe(
      "public, no-cache, must-revalidate",
    );
    expect(first.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("starts with safe runtime defaults before config resolves", async () => {
    const harness = await createHarness([
      { status: 200, body: availableConfig },
    ]);
    const footerLink = harness.document
      .querySelector(".sa-widget-footer")
      ?.querySelector("a");

    expect(footerLink?.textContent).toBe("Powered by SimplAssist");
    expect(footerLink?.getAttribute("href")).toBe("https://simplassist.test/");
  });

  it("keeps partner script branding while routing public traffic through the canonical API", async () => {
    const harness = await createHarness(
      [
        {
          status: 200,
          body: {
            ...availableConfig,
            poweredByName: "Alpha Dog Agency",
            poweredByUrl: "https://app.partner.test/",
          },
        },
        { status: 200, body: { available: true, response: "We can help." } },
      ],
      { scriptOrigin: "https://app.partner.test" },
    );
    await flushPromises();

    expect(harness.document.currentScript.src).toBe(
      "https://app.partner.test/widget/embed.js",
    );
    expect(harness.requests[0]?.url).toBe(
      "https://api.simplassist.test/api/widget/config?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
    const footerLink = harness.document
      .querySelector(".sa-widget-footer")
      ?.querySelector("a");
    expect(footerLink?.textContent).toBe("Powered by Alpha Dog Agency");
    expect(footerLink?.getAttribute("href")).toBe(
      "https://app.partner.test/",
    );

    const input = harness.document.querySelector(".sa-widget-input");
    const send = harness.document.querySelector(".sa-widget-send");
    if (!input || !send) throw new Error("Widget input controls were not rendered");
    input.value = "Can you help?";
    send.dispatch("click");

    expect(harness.requests[1]?.url).toBe(
      "https://api.simplassist.test/api/widget/chat?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
  });

  it("marks only an explicitly homepage-scoped widget container", async () => {
    const regularHarness = await createHarness([
      { status: 200, body: availableConfig },
    ]);
    const homepageHarness = await createHarness(
      [{ status: 200, body: availableConfig }],
      { homepageOnly: true },
    );

    expect(
      regularHarness.document
        .querySelector(".sa-widget-container")
        ?.getAttribute("data-homepage-only"),
    ).toBeNull();
    expect(
      homepageHarness.document
        .querySelector(".sa-widget-container")
        ?.getAttribute("data-homepage-only"),
    ).toBe("true");
  });

  it("applies partner attribution and resets it on a later default config", async () => {
    const harness = await createHarness([
      {
        status: 200,
        body: {
          ...availableConfig,
          poweredByName: "Alpha Dog Agency",
          poweredByUrl: "https://partner.example/about?from=widget",
        },
      },
      { status: 200, body: availableConfig },
    ]);
    await flushPromises();

    const footerLink = harness.document
      .querySelector(".sa-widget-footer")
      ?.querySelector("a");
    expect(footerLink?.textContent).toBe("Powered by Alpha Dog Agency");
    expect(footerLink?.getAttribute("href")).toBe(
      "https://partner.example/about?from=widget",
    );

    harness.timers.runInterval(60_000);
    await flushPromises();

    expect(footerLink?.textContent).toBe("Powered by SimplAssist");
    expect(footerLink?.getAttribute("href")).toBe("https://simplassist.test/");
  });

  it.each([
    ["a relative URL", "/partner"],
    ["a scheme-relative URL", "//partner.example"],
    ["a script URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,unsafe"],
    ["a credentialed URL", "https://user:secret@partner.example/"],
    ["a whitespace-padded URL", " https://partner.example/"],
  ])("retains the runtime URL for %s", async (_, poweredByUrl) => {
    const harness = await createHarness([
      {
        status: 200,
        body: {
          ...availableConfig,
          poweredByName: "Alpha Dog Agency",
          poweredByUrl,
        },
      },
    ]);
    await flushPromises();

    const footerLink = harness.document
      .querySelector(".sa-widget-footer")
      ?.querySelector("a");
    expect(footerLink?.textContent).toBe("Powered by Alpha Dog Agency");
    expect(footerLink?.getAttribute("href")).toBe("https://simplassist.test/");
  });

  it("uses textContent for an untrusted powered-by name", async () => {
    const harness = await createHarness([
      {
        status: 200,
        body: {
          ...availableConfig,
          poweredByName: "<img src=x onerror=alert(1)>",
          poweredByUrl: "http://partner.example/",
        },
      },
    ]);
    await flushPromises();

    const footerLink = harness.document
      .querySelector(".sa-widget-footer")
      ?.querySelector("a");
    expect(footerLink?.textContent).toBe(
      "Powered by <img src=x onerror=alert(1)>",
    );
    expect(footerLink?.children).toHaveLength(0);
    expect(footerLink?.getAttribute("href")).toBe("http://partner.example/");
  });

  it("keeps partner preview config, chat, and end traffic on the partner origin", async () => {
    const harness = await createHarness(
      [
        { status: 200, body: availableConfig },
        { status: 200, body: { response: "Preview reply" } },
        { status: 200, body: { success: true, available: true } },
        { status: 200, body: availableConfig },
      ],
      {
        preview: true,
        scriptOrigin: "https://app.partner.test",
        uuids: [
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
        ],
      },
    );

    await flushPromises();

    expect(harness.requests[0]?.url).toBe(
      "https://app.partner.test/api/widget/preview-config?businessId=business-123",
    );
    expect(
      harness.document
        .querySelector(".sa-widget-btn")
        ?.classList.contains("sa-btn-visible"),
    ).toBe(true);

    const input = harness.document.querySelector(".sa-widget-input");
    const send = harness.document.querySelector(".sa-widget-send");
    if (!input || !send) throw new Error("Widget input controls were not rendered");

    input.value = "How do I sign up?";
    send.dispatch("click");

    expect(harness.requests[1]?.url).toBe(
      "https://app.partner.test/api/widget/chat?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
    expect(requestJsonBody(harness.requests[1])).toMatchObject({
      businessId: "business-123",
      message: "How do I sign up?",
      sessionId: "00000000-0000-4000-8000-000000000002",
      clientMessageId: "00000000-0000-4000-8000-000000000003",
      preview: true,
    });

    await flushPromises();
    const end = harness.document.querySelector(".sa-widget-end");
    if (!end) throw new Error("End control was not rendered");
    end.dispatch("click");

    expect(harness.requests[2]?.url).toBe(
      "https://app.partner.test/api/widget/end?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
    expect(requestJsonBody(harness.requests[2])).toMatchObject({
      businessId: "business-123",
      sessionId: "00000000-0000-4000-8000-000000000002",
      preview: true,
    });
    await flushPromises();
    expect(harness.requests[3]?.url).toBe(
      "https://app.partner.test/api/widget/preview-config?businessId=business-123",
    );
  });

  it("retries transient config failures with bounded backoff and then initializes", async () => {
    const harness = await createHarness([
      { status: 503, body: { retryable: true } },
      { status: 503, body: { retryable: true } },
      { status: 503, body: { retryable: true } },
      { status: 200, body: availableConfig },
    ]);

    await flushPromises();
    expect(harness.timers.pendingTimeoutDelays()).toContain(750);

    harness.timers.runTimeout(750);
    await flushPromises();
    expect(harness.timers.pendingTimeoutDelays()).toContain(1500);

    harness.timers.runTimeout(1500);
    await flushPromises();
    expect(harness.timers.pendingTimeoutDelays()).toContain(3000);

    harness.timers.runTimeout(3000);
    await flushPromises();

    expect(harness.requests).toHaveLength(4);
    expect(harness.requests.every((request) => request.url.includes("/api/widget/config"))).toBe(
      true,
    );
    expect(harness.document.querySelector(".sa-widget-btn")?.classList.contains("sa-btn-visible")).toBe(
      true,
    );
    expect(harness.document.querySelector(".sa-widget-header-center")?.textContent).toContain(
      "Acme Landscaping",
    );
  });

  it("restores a typed message and re-enables send after a transient chat failure", async () => {
    const harness = await createHarness([
      { status: 200, body: availableConfig },
      { status: 503, body: { retryable: true } },
    ]);
    await flushPromises();

    const input = harness.document.querySelector(".sa-widget-input");
    const send = harness.document.querySelector(".sa-widget-send");
    if (!input || !send) throw new Error("Widget input controls were not rendered");

    input.value = "Can you mow my lawn?";
    send.dispatch("click");
    expect(send.disabled).toBe(true);

    await flushPromises();

    expect(input.value).toBe("Can you mow my lawn?");
    expect(input.focused).toBe(true);
    expect(send.disabled).toBe(false);
    expect(harness.document.querySelector(".sa-widget-messages")?.textContent).toContain(
      "please try again",
    );
    expect(harness.requests[1]).toMatchObject({
      url: "https://api.simplassist.test/api/widget/chat?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
      init: { method: "POST" },
    });
    expect(requestJsonBody(harness.requests[1])).toMatchObject({
      sessionNonce: "abcdefghijklmnopqrstuvwx",
      clientMessageId: "00000000-0000-4000-8000-000000000002",
    });
    expect(requestJsonBody(harness.requests[1])).not.toHaveProperty("preview");
    expect(
      (harness.requests[1]?.init?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer test-widget-token");
  });

  it("preserves the visitor message and submits the forced offline lead form", async () => {
    const harness = await createHarness(
      [
        { status: 200, body: availableConfig },
        {
          status: 200,
          body: {
            available: true,
            response: null,
            mode: "lead_capture",
            reason: "assistant_unavailable",
          },
        },
        { status: 200, body: { success: true } },
      ],
      {
        uuids: [
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
          "00000000-0000-4000-8000-000000000004",
        ],
      },
    );
    await flushPromises();
    harness.timers.drainIntervalsBelow(1_000);

    const launcher = harness.document.querySelector(".sa-widget-btn");
    const panel = harness.document.querySelector(".sa-widget-panel");
    const input = harness.document.querySelector(".sa-widget-input");
    const send = harness.document.querySelector(".sa-widget-send");
    if (!launcher || !panel || !input || !send) {
      throw new Error("Widget controls were not rendered");
    }
    launcher.dispatch("click");
    input.value = "Please contact me about weekly service.";
    send.dispatch("click");
    await flushPromises();
    harness.timers.drainIntervalsBelow(1_000);

    expect(
      harness.document.querySelector(".sa-widget-msg-user")?.textContent,
    ).toBe("Please contact me about weekly service.");
    expect(panel.classList.contains("sa-visible")).toBe(true);
    expect(panel.classList.contains("sa-hidden")).toBe(false);
    expect(launcher.classList.contains("sa-btn-hidden")).toBe(false);
    expect(harness.document.querySelector(".sa-widget-messages")?.textContent)
      .toContain("Our assistant is unavailable right now");

    const leadForm = harness.document.querySelector(".sa-widget-lead-form");
    const leadInputs = leadForm?.querySelectorAll(".sa-widget-lead-input") ?? [];
    const leadSubmit = leadForm?.querySelector(".sa-widget-lead-btn");
    const leadStatus = leadForm?.querySelector(".sa-widget-lead-status");
    if (!leadForm || leadInputs.length !== 2 || !leadSubmit || !leadStatus) {
      throw new Error("Offline lead form was not rendered");
    }
    expect(leadForm.textContent).toContain(
      "Share a name or email so the business can respond.",
    );
    leadSubmit.dispatch("click");
    expect(harness.requests).toHaveLength(2);
    expect(leadStatus.textContent).toContain("Enter a name or email");

    leadInputs[0].value = "Jordan Lee";
    leadSubmit.dispatch("click");
    await flushPromises();

    expect(harness.requests[2]?.url).toBe(
      "https://api.simplassist.test/api/widget/lead?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
    expect(requestJsonBody(harness.requests[2])).toEqual({
      businessId: "business-123",
      sessionId: "00000000-0000-4000-8000-000000000002",
      sessionNonce: "abcdefghijklmnopqrstuvwx",
      clientLeadId: "00000000-0000-4000-8000-000000000004",
      sourceClientMessageId: "00000000-0000-4000-8000-000000000003",
      message: "Please contact me about weekly service.",
      visitorName: "Jordan Lee",
    });
    expect(
      (harness.requests[2]?.init?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer test-widget-token");
    expect(harness.document.querySelector(".sa-widget-lead-form")).toBeNull();
    expect(harness.document.querySelector(".sa-widget-messages")?.textContent)
      .toContain("Your contact information was sent to the business");
  });

  it("keeps the same offline lead id and form values after a failed submission", async () => {
    const harness = await createHarness(
      [
        { status: 200, body: availableConfig },
        {
          status: 200,
          body: {
            available: true,
            response: null,
            mode: "lead_capture",
            reason: "assistant_unavailable",
          },
        },
        { status: 503, body: { error: "service_unavailable", retryable: true } },
        { status: 200, body: { success: true } },
      ],
      {
        uuids: [
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000003",
          "00000000-0000-4000-8000-000000000004",
        ],
      },
    );
    await flushPromises();
    harness.timers.drainIntervalsBelow(1_000);

    const input = harness.document.querySelector(".sa-widget-input");
    const send = harness.document.querySelector(".sa-widget-send");
    if (!input || !send) throw new Error("Widget input controls were not rendered");
    input.value = "Please call me.";
    send.dispatch("click");
    await flushPromises();
    harness.timers.drainIntervalsBelow(1_000);

    const leadForm = harness.document.querySelector(".sa-widget-lead-form");
    const leadInputs = leadForm?.querySelectorAll(".sa-widget-lead-input") ?? [];
    const leadSubmit = leadForm?.querySelector(".sa-widget-lead-btn");
    const leadStatus = leadForm?.querySelector(".sa-widget-lead-status");
    if (leadInputs.length !== 2 || !leadSubmit || !leadStatus) {
      throw new Error("Offline lead form was not rendered");
    }
    leadInputs[1].value = "jordan@example.com";
    leadSubmit.dispatch("click");
    await flushPromises();

    expect(leadInputs[1].value).toBe("jordan@example.com");
    expect(leadSubmit.disabled).toBe(false);
    expect(leadInputs[0].disabled).toBe(true);
    expect(leadInputs[1].disabled).toBe(true);
    expect(leadStatus.textContent).toContain("could not confirm");
    expect(harness.document.querySelector(".sa-widget-lead-form")).toBe(leadForm);

    leadSubmit.dispatch("click");
    await flushPromises();

    expect(requestJsonBody(harness.requests[2]).clientLeadId).toBe(
      "00000000-0000-4000-8000-000000000004",
    );
    expect(requestJsonBody(harness.requests[3]).clientLeadId).toBe(
      "00000000-0000-4000-8000-000000000004",
    );
    expect(harness.document.querySelector(".sa-widget-lead-form")).toBeNull();
  });

  it("closes and hides an open widget when a config refresh reports unavailable", async () => {
    const harness = await createHarness([
      { status: 200, body: availableConfig },
      { status: 200, body: { available: false } },
    ]);
    await flushPromises();

    const launcher = harness.document.querySelector(".sa-widget-btn");
    const panel = harness.document.querySelector(".sa-widget-panel");
    const container = harness.document.querySelector(".sa-widget-container");
    if (!launcher || !panel || !container) throw new Error("Widget shell was not rendered");

    launcher.dispatch("click");
    expect(panel.classList.contains("sa-visible")).toBe(true);
    expect(container.classList.contains("sa-open")).toBe(true);

    harness.timers.runInterval(60_000);
    await flushPromises();

    expect(panel.classList.contains("sa-hidden")).toBe(true);
    expect(panel.classList.contains("sa-visible")).toBe(false);
    expect(container.classList.contains("sa-open")).toBe(false);
    expect(launcher.classList.contains("sa-btn-hidden")).toBe(true);
  });

  it("fails closed when a public config omits its signed session credential", async () => {
    const unsafeConfig: Record<string, unknown> = { ...availableConfig };
    delete unsafeConfig.widgetToken;
    delete unsafeConfig.widgetSessionNonce;
    const harness = await createHarness([{ status: 200, body: unsafeConfig }]);
    await flushPromises();

    const launcher = harness.document.querySelector(".sa-widget-btn");
    expect(launcher === null || launcher.classList.contains("sa-btn-hidden"))
      .toBe(true);
    expect(harness.requests).toHaveLength(1);
  });

  it("binds public config, chat, and retry to one session and client message id", async () => {
    const harness = await createHarness([
      { status: 200, body: availableConfig },
      { status: 503, body: { error: "service_unavailable", retryable: true } },
      { status: 200, body: { available: true, response: "We can help." } },
    ]);
    await flushPromises();

    expect(harness.requests[0]?.url).toBe(
      "https://api.simplassist.test/api/widget/config?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
    const input = harness.document.querySelector(".sa-widget-input");
    const send = harness.document.querySelector(".sa-widget-send");
    if (!input || !send) throw new Error("Widget input controls were not rendered");

    input.value = "Can you help?";
    send.dispatch("click");
    await flushPromises();
    const firstBody = requestJsonBody(harness.requests[1]);
    expect(firstBody).toMatchObject({
      sessionId: "00000000-0000-4000-8000-000000000002",
      sessionNonce: "abcdefghijklmnopqrstuvwx",
      clientMessageId: "00000000-0000-4000-8000-000000000002",
    });

    send.dispatch("click");
    await flushPromises();
    const retryBody = requestJsonBody(harness.requests[2]);
    expect(retryBody.clientMessageId).toBe(firstBody.clientMessageId);
    expect(
      (harness.requests[2]?.init?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer test-widget-token");
  });

  it("ends with the signed credential and refreshes it for the new session", async () => {
    const refreshedConfig = {
      ...availableConfig,
      widgetToken: "refreshed-widget-token",
      widgetSessionNonce: "zyxwvutsrqponmlkjihgfedc",
    };
    const harness = await createHarness(
      [
        { status: 200, body: availableConfig },
        { status: 200, body: { success: true, available: true } },
        { status: 200, body: refreshedConfig },
      ],
      {
        uuids: [
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000004",
        ],
      },
    );
    await flushPromises();

    const end = harness.document.querySelector(".sa-widget-end");
    if (!end) throw new Error("End control was not rendered");
    end.dispatch("click");
    await flushPromises();

    expect(harness.requests[1]?.url).toBe(
      "https://api.simplassist.test/api/widget/end?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000002",
    );
    expect(requestJsonBody(harness.requests[1])).toEqual({
      businessId: "business-123",
      sessionId: "00000000-0000-4000-8000-000000000002",
      sessionNonce: "abcdefghijklmnopqrstuvwx",
    });
    expect(
      (harness.requests[1]?.init?.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer test-widget-token");
    expect(harness.requests[2]?.url).toBe(
      "https://api.simplassist.test/api/widget/config?businessId=business-123&sessionId=00000000-0000-4000-8000-000000000004",
    );
  });
});
