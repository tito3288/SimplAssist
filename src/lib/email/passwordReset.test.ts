import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendBusinessEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./sender", () => ({
  sendBusinessEmail: mocks.sendBusinessEmail,
}));

import { sendPasswordResetEmail } from "./passwordReset";

const PARTNER_BRAND = {
  partnerId: "20000000-0000-4000-a000-000000000001",
  name: "Alpha Dog Agency",
  publicOrigin: "https://app.alphadogagency.ai",
  from: '"Alpha Dog Agency" <hello@alphadogagency.ai>',
  usedFallbackSender: false,
};
const RESET_URL =
  "https://app.alphadogagency.ai/api/auth/callback?flow=reset&token_hash=secret-token&type=recovery&state=signed-state";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendBusinessEmail.mockResolvedValue({ data: { id: "mail-1" } });
});

describe("sendPasswordResetEmail", () => {
  it("sends a brand-aware recovery message through the sensitive transport", async () => {
    await sendPasswordResetEmail({
      brand: PARTNER_BRAND,
      recipient: "owner@example.com",
      resetUrl: RESET_URL,
    });

    expect(mocks.sendBusinessEmail).toHaveBeenCalledWith({
      brand: PARTNER_BRAND,
      context: "passwordReset",
      sensitive: true,
      message: expect.objectContaining({
        to: ["owner@example.com"],
        subject: "Reset your Alpha Dog Agency password",
        text: expect.stringContaining(RESET_URL),
        html: expect.stringContaining("Choose a new password"),
      }),
    });
  });

  it("escapes brand-controlled display text in HTML", async () => {
    await sendPasswordResetEmail({
      brand: { ...PARTNER_BRAND, name: 'Alpha <Dogs> & "Friends"' },
      recipient: "owner@example.com",
      resetUrl: RESET_URL,
    });

    const message = mocks.sendBusinessEmail.mock.calls[0][0].message;
    expect(message.html).toContain("Alpha &lt;Dogs&gt; &amp; &quot;Friends&quot;");
    expect(message.html).not.toContain("Alpha <Dogs>");
  });

  it.each([
    "https://simplassist.com/api/auth/callback?flow=reset&token_hash=secret-token&type=recovery&state=signed-state",
    "https://app.alphadogagency.ai/api/auth/callback?flow=concierge&token_hash=secret-token&type=recovery&state=signed-state",
    "https://app.alphadogagency.ai/api/auth/callback?flow=reset&type=recovery&state=signed-state",
    "https://app.alphadogagency.ai/api/auth/callback?flow=reset&token_hash=secret-token&type=recovery",
    "https://app.alphadogagency.ai/api/auth/callback?flow=reset&token_hash=secret-token&token_hash=other&type=recovery&state=signed-state",
    "https://app.alphadogagency.ai/api/auth/callback?flow=reset&token_hash=secret-token&type=recovery&state=signed-state&next=/admin",
    "https://app.alphadogagency.ai/other?flow=reset&token_hash=secret-token&type=recovery&state=signed-state",
  ])("rejects an unsafe reset URL before sending: %s", async (resetUrl) => {
    await expect(
      sendPasswordResetEmail({
        brand: PARTNER_BRAND,
        recipient: "owner@example.com",
        resetUrl,
      }),
    ).rejects.toThrow("Password reset URL is malformed");

    expect(mocks.sendBusinessEmail).not.toHaveBeenCalled();
  });
});
