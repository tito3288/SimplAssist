import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stripeConstructor: vi.fn(function MockStripe(
    _secret: string,
    options: Record<string, unknown>
  ) {
    return { options };
  }),
}));

vi.mock("stripe", () => ({ default: mocks.stripeConstructor }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit_only");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Stripe client configuration", () => {
  it("configures both exported and lazy clients with two bounded network retries", async () => {
    const clientModule = await import("./client");

    expect(mocks.stripeConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.stripeConstructor).toHaveBeenNthCalledWith(
      1,
      "sk_test_unit_only",
      expect.objectContaining({
        apiVersion: "2026-02-25.clover",
        typescript: true,
        maxNetworkRetries: 2,
      })
    );

    const first = clientModule.getStripeClient();
    const second = clientModule.getStripeClient();

    expect(first).toBe(second);
    expect(mocks.stripeConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.stripeConstructor).toHaveBeenNthCalledWith(
      2,
      "sk_test_unit_only",
      expect.objectContaining({ maxNetworkRetries: 2 })
    );
  });

  it("blocks client construction when the Stripe key is missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");

    await expect(import("./client")).rejects.toThrow(
      "STRIPE_SECRET_KEY is required"
    );
    expect(mocks.stripeConstructor).not.toHaveBeenCalled();
  });
});
