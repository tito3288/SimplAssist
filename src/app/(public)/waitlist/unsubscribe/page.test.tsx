import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: mocks.noStore,
}));

vi.mock("@/lib/waitlist/unsubscribeToken", () => ({
  verifyWaitlistUnsubscribeToken: mocks.verifyToken,
}));

import WaitlistUnsubscribePage, { metadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("waitlist unsubscribe confirmation page", () => {
  it("validates on GET but requires a separate POST to mutate", () => {
    mocks.verifyToken.mockReturnValue(
      "4f3e6823-e07c-4b7f-a643-ff0c2625850d"
    );

    const markup = renderToStaticMarkup(
      <WaitlistUnsubscribePage
        searchParams={{ token: "v1.valid.signature" }}
      />
    );

    expect(mocks.noStore).toHaveBeenCalled();
    expect(mocks.verifyToken).toHaveBeenCalledWith("v1.valid.signature");
    expect(markup).toContain('action="/api/waitlist/unsubscribe"');
    expect(markup).toContain('method="post"');
    expect(markup).toContain('name="token"');
    expect(markup).toContain("Confirm unsubscribe");
  });

  it("shows an inert error for an invalid token", () => {
    mocks.verifyToken.mockReturnValue(null);

    const markup = renderToStaticMarkup(
      <WaitlistUnsubscribePage searchParams={{ token: "tampered" }} />
    );

    expect(markup).toContain("This unsubscribe link is not valid");
    expect(markup).not.toContain("<form");
  });

  it("is marked non-indexed with no referrer", () => {
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    });
  });
});
