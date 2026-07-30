import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import {
  requestWaitlistSend,
  WaitlistLaunchControls,
  WaitlistSingleSendButton,
} from "./WaitlistSendControls";

describe("WaitlistLaunchControls", () => {
  it("renders the admin-only test and count-bound bulk controls", () => {
    const markup = renderToStaticMarkup(
      <WaitlistLaunchControls
        adminEmailAvailable
        pendingRecipientCount={27}
        cutoff="2026-07-29T20:30:00.000Z"
      />
    );

    expect(markup).toContain("Send admin test");
    expect(markup).toContain("27 sendable pending");
    expect(markup).toContain("recipients");
    expect(markup).toContain("Type");
    expect(markup).toContain("SEND");
    expect(markup).toContain("Send to all pending (27)");
  });

  it("disables test sends without a session-derived admin email", () => {
    const markup = renderToStaticMarkup(
      <WaitlistLaunchControls
        adminEmailAvailable={false}
        pendingRecipientCount={0}
        cutoff="2026-07-29T20:30:00.000Z"
      />
    );

    expect(markup).toContain("signed-in admin account needs an email address");
    expect(markup).toContain("Send to all pending (0)");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("renders a per-row action without exposing the signup id as form data", () => {
    const signupId = "4f3e6823-e07c-4b7f-a643-ff0c2625850d";
    const markup = renderToStaticMarkup(
      <WaitlistSingleSendButton signupId={signupId} />
    );

    expect(markup).toContain(">Send</button>");
    expect(markup).not.toContain(signupId);
    expect(markup).not.toContain("<form");
  });
});

describe("requestWaitlistSend", () => {
  it("posts only the strict bulk confirmation payload", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sent: 7,
        failed: 1,
        skipped: 2,
        needsReview: 1,
      }),
    })) as unknown as typeof fetch;

    await expect(
      requestWaitlistSend(
        {
          action: "bulk",
          confirmation: "SEND",
          expectedCount: 11,
          cutoff: "2026-07-29T20:30:00.000Z",
        },
        fetcher
      )
    ).resolves.toEqual({
      sent: 7,
      failed: 1,
      skipped: 2,
      needsReview: 1,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/admin/waitlist/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bulk",
        confirmation: "SEND",
        expectedCount: 11,
        cutoff: "2026-07-29T20:30:00.000Z",
      }),
    });
  });

  it("surfaces a generic server error without needing recipient details", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Pending count changed. Refresh and review." }),
    })) as unknown as typeof fetch;

    await expect(
      requestWaitlistSend(
        {
          action: "single",
          signupId: "4f3e6823-e07c-4b7f-a643-ff0c2625850d",
        },
        fetcher
      )
    ).rejects.toThrow("Pending count changed. Refresh and review.");
  });

  it("rejects malformed aggregate responses", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sent: 1,
        failed: 0,
        skipped: 0,
        needsReview: -1,
      }),
    })) as unknown as typeof fetch;

    await expect(
      requestWaitlistSend({ action: "test" }, fetcher)
    ).rejects.toThrow("Could not send the launch email.");
  });
});
