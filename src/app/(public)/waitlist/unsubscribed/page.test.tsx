import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: mocks.noStore,
}));

import WaitlistUnsubscribedPage, {
  dynamic,
  metadata,
  revalidate,
} from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("waitlist unsubscribed page", () => {
  it("renders the real unsubscribe confirmation by default", () => {
    const markup = renderToStaticMarkup(<WaitlistUnsubscribedPage />);

    expect(mocks.noStore).toHaveBeenCalled();
    expect(markup).toContain("You’ve been unsubscribed");
    expect(markup).toContain(
      "You will not receive Full Suite waitlist or launch emails from us."
    );
    expect(markup).not.toContain("No waitlist preferences were changed");
  });

  it("renders an explicit non-mutating state for test-email previews", () => {
    const markup = renderToStaticMarkup(
      <WaitlistUnsubscribedPage searchParams={{ preview: "1" }} />
    );

    expect(markup).toContain("Unsubscribe preview");
    expect(markup).toContain("No waitlist preferences were changed");
    expect(markup).not.toContain("You’ve been unsubscribed");
  });

  it("remains non-indexed with no referrer", () => {
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    });
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });
});
