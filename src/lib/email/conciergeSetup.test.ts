import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveBusinessEmailBrand: vi.fn(),
  sendBusinessEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./businessEmailBrand.server", () => ({
  resolveBusinessEmailBrand: mocks.resolveBusinessEmailBrand,
}));
vi.mock("./sender", () => ({
  sendBusinessEmail: mocks.sendBusinessEmail,
}));

import { sendConciergeSetupEmail } from "./conciergeSetup";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const SETUP_URL =
  "https://app.alphadogagency.ai/api/auth/callback?token_hash=secret-token&type=recovery&flow=concierge";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBusinessEmailBrand.mockResolvedValue({
    partnerId: "20000000-0000-4000-a000-000000000001",
    name: "Alpha Dog Agency",
    publicOrigin: "https://app.alphadogagency.ai",
    from: '"Alpha Dog Agency" <hello@alphadogagency.ai>',
    usedFallbackSender: false,
  });
  mocks.sendBusinessEmail.mockResolvedValue({ data: { id: "mail-1" } });
});

describe("sendConciergeSetupEmail", () => {
  it("sends partner-branded setup copy through the sensitive mail path", async () => {
    await sendConciergeSetupEmail({
      businessId: BUSINESS_ID,
      businessName: "Tidy Dogs",
      recipient: "owner@example.com",
      setupUrl: SETUP_URL,
    });

    expect(mocks.resolveBusinessEmailBrand).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.sendBusinessEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "conciergeSetup",
        sensitive: true,
        message: expect.objectContaining({
          to: ["owner@example.com"],
          subject: "Set up your Alpha Dog Agency account",
          text: expect.stringContaining(SETUP_URL),
          html: expect.stringContaining("Choose your password"),
        }),
      }),
    );
  });

  it.each([
    "https://simplassist.com/api/auth/callback?token_hash=secret&type=recovery&flow=concierge",
    "https://app.alphadogagency.ai/api/auth/callback?token_hash=secret&type=signup&flow=concierge",
    "https://app.alphadogagency.ai/api/auth/callback?type=recovery&flow=concierge",
    "https://app.alphadogagency.ai/api/auth/callback?token_hash=secret&token_hash=other&type=recovery&flow=concierge",
    "https://app.alphadogagency.ai/api/auth/callback?token_hash=secret&type=recovery&flow=concierge&next=/admin",
    "https://app.alphadogagency.ai/other?token_hash=secret&type=recovery&flow=concierge",
  ])("rejects an unsafe setup URL before sending: %s", async (setupUrl) => {
    await expect(
      sendConciergeSetupEmail({
        businessId: BUSINESS_ID,
        businessName: "Tidy Dogs",
        recipient: "owner@example.com",
        setupUrl,
      }),
    ).rejects.toThrow("Concierge setup URL is malformed");

    expect(mocks.sendBusinessEmail).not.toHaveBeenCalled();
  });
});
