import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("conversation brand tokens", () => {
  it("keeps filters, selection, focus, and unread state request-branded", () => {
    const conversationList = source("./ConversationList.tsx");

    expect(conversationList).toContain(
      "focus:ring-[rgb(var(--brand-primary-rgb)/.25)]",
    );
    expect(conversationList).toContain(
      "dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.30)]",
    );
    expect(conversationList).toContain("bg-[var(--brand-accent-soft)]");
    expect(conversationList).toContain(
      "dark:bg-[rgb(var(--brand-primary-dark-rgb)/.08)]",
    );
    expect(conversationList).toContain("bg-[var(--brand-primary)]");
    expect(conversationList).toContain("dark:bg-[var(--brand-primary-dark)]");
  });

  it("keeps the mobile navigation accent request-branded", () => {
    const inboxLayout = source("./InboxLayout.tsx");

    expect(inboxLayout).toContain("text-[var(--brand-accent)]");
    expect(inboxLayout).toContain("dark:text-[var(--brand-accent-dark)]");
  });

  it("keeps takeover, AI messages, and composer actions request-branded", () => {
    const messageThread = source("./MessageThread.tsx");

    expect(messageThread).toContain("hover:bg-[var(--brand-tint-strong)]");
    expect(messageThread).toContain("dark:text-[var(--brand-text-soft-dark)]");
    expect(messageThread).toContain(
      "dark:hover:bg-[rgb(var(--brand-primary-dark-rgb)/.24)]",
    );
    expect(messageThread).toContain("bg-[var(--brand-primary)]");
    expect(messageThread).toContain("hover:bg-[var(--brand-primary-hover)]");
    expect(messageThread).toContain("active:bg-[var(--brand-primary-active)]");
    expect(messageThread).toContain(
      "dark:hover:bg-[var(--brand-primary-hover-dark)]",
    );
  });
});
