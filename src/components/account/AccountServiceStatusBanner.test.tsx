import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccountServiceStatusBanner,
  type AccountServiceStatusBannerProps,
} from "./AccountServiceStatusBanner";

const ACTIVE_CONTROLS: AccountServiceStatusBannerProps = {
  operationsSuspendedAt: null,
  aiRepliesPausedAt: null,
  textingPausedAt: null,
  bookingsPausedAt: null,
};

function render(
  controls: Partial<typeof ACTIVE_CONTROLS> = {},
): string {
  return renderToStaticMarkup(
    <AccountServiceStatusBanner {...ACTIVE_CONTROLS} {...controls} />,
  );
}

describe("AccountServiceStatusBanner", () => {
  it("does not render when the account and all services are active", () => {
    expect(render()).toBe("");
  });

  it("explains suspension while preserving dashboard access and stored data", () => {
    const html = render({
      operationsSuspendedAt: "2026-08-04T12:00:00.000Z",
    });

    expect(html).toContain("Account services are suspended");
    expect(html).toContain("Your dashboard remains available");
    expect(html).toContain("your stored data is preserved");
    expect(html).toContain(
      "AI replies, texting, new bookings, call forwarding, and missed-call texts are paused",
    );
    expect(html).not.toContain("After reactivation");
    expect(html).not.toContain("SimplAssist");
  });

  it("lists only independent pauses that survive account reactivation", () => {
    const html = render({
      operationsSuspendedAt: "2026-08-04T12:00:00.000Z",
      aiRepliesPausedAt: "2026-08-04T12:01:00.000Z",
      bookingsPausedAt: "2026-08-04T12:02:00.000Z",
    });

    expect(html).toContain(
      "After reactivation, AI replies and bookings will remain paused",
    );
    expect(html).not.toContain(
      "After reactivation, AI replies, texting, and bookings",
    );
  });

  it("lists pause-only services while saying the remaining services stay available", () => {
    const html = render({
      aiRepliesPausedAt: "2026-08-04T12:01:00.000Z",
      textingPausedAt: "2026-08-04T12:02:00.000Z",
    });

    expect(html).toContain("Some account services are paused");
    expect(html).toContain(
      "The following services are paused: AI replies and texting",
    );
    expect(html).toContain("All other account services remain available");
    expect(html).not.toContain("Account services are suspended");
  });

  it("is non-dismissible and cannot reveal an admin reason", () => {
    const html = render({
      operationsSuspendedAt: "2026-08-04T12:00:00.000Z",
      textingPausedAt: "2026-08-04T12:01:00.000Z",
    });

    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Dismiss");
    expect(html).not.toContain("reason");
    expect(html).not.toContain("2026-08-04");
  });
});
