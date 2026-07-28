import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
}));
vi.mock("./billing-actions", () => ({
  BillingActions: () => null,
}));

import BillingPage from "./page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function queryThenable(result: Promise<unknown>) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "single", "maybeSingle"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = result.then.bind(result);
  query.catch = result.catch.bind(result);
  return query;
}

describe("BillingPage query scheduling", () => {
  it("starts subscription and usage reads together", async () => {
    const subscription = deferred<{ data: null }>();
    const usage = deferred<{ data: null }>();
    mocks.from.mockImplementation((table: string) =>
      queryThenable(
        table === "subscriptions" ? subscription.promise : usage.promise
      )
    );
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { from: mocks.from },
      user: { id: "user-1" },
      business: { id: "business-1" },
    });

    const page = BillingPage();

    await vi.waitFor(() => {
      expect(mocks.from).toHaveBeenCalledWith("subscriptions");
      expect(mocks.from).toHaveBeenCalledWith("billing_usage_periods");
    });

    subscription.resolve({ data: null });
    usage.resolve({ data: null });
    await expect(page).resolves.toBeDefined();
  });
});
