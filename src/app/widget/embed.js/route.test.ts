import { describe, expect, it } from "vitest";

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

  constructor(preview = false) {
    this.currentScript = new FakeElement("script");
    this.currentScript.src = "https://simplassist.test/widget/embed.js";
    this.currentScript.setAttribute("data-business-id", "business-123");
    if (preview) this.currentScript.setAttribute("data-preview", "true");
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
  options: { preview?: boolean } = {},
) {
  const response = await GET();
  const script = await response.text();
  const document = new FakeDocument(options.preview);
  const timers = new FakeTimers();
  const requests: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const storage = new Map<string, string>();
  const windowListeners = new Map<string, EventListener[]>();

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
    { randomUUID: () => "session-123" },
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

const availableConfig = {
  available: true,
  businessName: "Acme Landscaping",
  brandColor: "#0066FF",
  position: "bottom_right",
  welcomeMessage: "How can we help?",
  quickReplies: [],
  leadCaptureEnabled: false,
};

describe("widget embed runtime", () => {
  it("generates valid standalone JavaScript", async () => {
    const response = await GET();
    const script = await response.text();

    expect(() => new Function(script)).not.toThrow();
  });

  it("uses the owner-only config route in preview mode", async () => {
    const harness = await createHarness(
      [{ status: 200, body: availableConfig }],
      { preview: true },
    );

    await flushPromises();

    expect(harness.requests[0]?.url).toBe(
      "https://simplassist.test/api/widget/preview-config?businessId=business-123",
    );
    expect(
      harness.document
        .querySelector(".sa-widget-btn")
        ?.classList.contains("sa-btn-visible"),
    ).toBe(true);
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
      url: "https://simplassist.test/api/widget/chat",
      init: { method: "POST" },
    });
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
});
