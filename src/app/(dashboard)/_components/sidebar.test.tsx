import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

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

vi.mock("next/image", () => ({
  default: ({
    alt,
    priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} />
    );
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock("@/lib/theme-v2/ui", () => ({
  ThemeToggleV2: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/icons/staggered-menu-icon", () => ({
  StaggeredMenuIcon: () => <span>Menu icon</span>,
}));

import Sidebar from "./sidebar";

function renderSidebar(props?: {
  activePath?: string;
  canUseCalendar?: boolean;
  canUseWidget?: boolean;
}) {
  return renderToStaticMarkup(
    <Sidebar
      userEmail="owner@example.com"
      websiteUrl={null}
      {...props}
    />
  );
}

function renderedNavSections(markup: string): string[] {
  return Array.from(markup.matchAll(/<nav\b[^>]*>(.*?)<\/nav>/g), (match) => match[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/dashboard";
});

describe("Sidebar navigation", () => {
  it("shows Knowledge Gaps between Conversations and Contacts", () => {
    const navSections = renderedNavSections(renderSidebar());

    expect(navSections).toHaveLength(2);
    for (const nav of navSections) {
      const conversationsIndex = nav.indexOf('href="/conversations"');
      const knowledgeGapsIndex = nav.indexOf('href="/knowledge-gaps"');
      const contactsIndex = nav.indexOf('href="/contacts"');

      expect(conversationsIndex).toBeGreaterThanOrEqual(0);
      expect(knowledgeGapsIndex).toBeGreaterThan(conversationsIndex);
      expect(contactsIndex).toBeGreaterThan(knowledgeGapsIndex);
      expect(nav).toContain(">Knowledge Gaps</span>");
    }
  });

  it("keeps Knowledge Gaps unlocked when gated features are unavailable", () => {
    const markup = renderSidebar({
      canUseCalendar: false,
      canUseWidget: false,
    });

    expect(markup).toContain(
      'aria-label="Calendar is unavailable on the current subscription"'
    );
    expect(markup).toContain(
      'aria-label="Widget is unavailable on the current subscription"'
    );
    expect(markup).not.toContain(
      'aria-label="Knowledge Gaps is unavailable on the current subscription"'
    );
  });

  it("marks Knowledge Gaps active through the standard pathname match", () => {
    mocks.pathname = "/knowledge-gaps";

    const navSections = renderedNavSections(renderSidebar());

    for (const nav of navSections) {
      const knowledgeGapsLink = nav.match(
        /<a href="\/knowledge-gaps" class="([^"]+)"/
      );

      expect(knowledgeGapsLink?.[1]).toContain("bg-[#fdf1e7]");
    }
  });
});
