import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({
  resend: { emails: { send: mocks.send } },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import type { BusinessEmailBrand } from "./businessEmailBrand.server";
import { sendBusinessEmail } from "./sender";

const VERIFIED_BRAND: BusinessEmailBrand = {
  partnerId: "20000000-0000-4000-a000-000000000001",
  name: "Alpha Dog Agency",
  publicOrigin: "https://app.alphadogagency.ai",
  from: '"Alpha Dog Agency" <billing@alphadogagency.ai>',
  usedFallbackSender: false,
};
const MESSAGE = {
  to: ["client@example.com"],
  subject: "Account update",
  text: "Hello",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.send.mockResolvedValue({
    data: { id: "email-1" },
    error: null,
  });
});

describe("sendBusinessEmail", () => {
  it("injects the resolved sender and returns the provider result", async () => {
    const result = await sendBusinessEmail({
      brand: VERIFIED_BRAND,
      context: "registration_approved",
      message: MESSAGE,
    });

    expect(result).toEqual({ data: { id: "email-1" }, error: null });
    expect(mocks.send).toHaveBeenCalledWith({
      ...MESSAGE,
      from: VERIFIED_BRAND.from,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not allow a runtime message From value to override the brand", async () => {
    await sendBusinessEmail({
      brand: VERIFIED_BRAND,
      context: "header_safety",
      message: {
        ...MESSAGE,
        from: "attacker@example.com",
      } as typeof MESSAGE,
    });

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: VERIFIED_BRAND.from }),
    );
  });

  it.each(["resolved", "thrown"] as const)(
    "logs a distinct verified-partner rejection and rethrows a %s provider error",
    async (kind) => {
      const providerError = new Error(`provider ${kind} failure`);
      if (kind === "resolved") {
        mocks.send.mockResolvedValue({ data: null, error: providerError });
      } else {
        mocks.send.mockRejectedValue(providerError);
      }

      await expect(
        sendBusinessEmail({
          brand: VERIFIED_BRAND,
          context: "registration_approved",
          message: MESSAGE,
        }),
      ).rejects.toBe(providerError);

      expect(console.error).toHaveBeenCalledWith(
        "[email:business] registration_approved: verified partner sender rejected",
        {
          partnerId: VERIFIED_BRAND.partnerId,
          from: VERIFIED_BRAND.from,
        },
        providerError,
      );
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "fallback partner",
      brand: { ...VERIFIED_BRAND, usedFallbackSender: true },
    },
    {
      label: "default brand",
      brand: { ...VERIFIED_BRAND, partnerId: null },
    },
  ])("uses the generic failure log for $label", async ({ brand }) => {
    const error = new Error("network failure");
    mocks.send.mockRejectedValue(error);

    await expect(
      sendBusinessEmail({
        brand,
        context: "support",
        message: MESSAGE,
      }),
    ).rejects.toBe(error);

    expect(console.error).toHaveBeenCalledWith(
      "[email:business] support: send failed",
      error,
    );
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("verified partner sender rejected"),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["resolved", "thrown"] as const)(
    "redacts a sensitive %s provider failure while preserving the thrown error",
    async (kind) => {
      const secret =
        "https://app.alphadogagency.ai/api/auth/callback?token_hash=super-secret&type=recovery&flow=concierge";
      const providerError = new Error(`provider echoed ${secret}`);
      if (kind === "resolved") {
        mocks.send.mockResolvedValue({ data: null, error: providerError });
      } else {
        mocks.send.mockRejectedValue(providerError);
      }

      await expect(
        sendBusinessEmail({
          brand: VERIFIED_BRAND,
          context: "conciergeSetup",
          sensitive: true,
          message: { ...MESSAGE, text: secret },
        }),
      ).rejects.toBe(providerError);

      expect(console.error).toHaveBeenCalledWith(
        "[email:business] conciergeSetup: sensitive send failed",
        { partnerId: VERIFIED_BRAND.partnerId },
      );
      const serializedLogs = JSON.stringify(
        vi.mocked(console.error).mock.calls,
      );
      expect(serializedLogs).not.toContain("super-secret");
      expect(serializedLogs).not.toContain("token_hash");
      expect(serializedLogs).not.toContain(VERIFIED_BRAND.from);
      expect(serializedLogs).not.toContain("provider echoed");
    },
  );
});
