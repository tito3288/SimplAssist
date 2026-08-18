import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BillingPortalButtonView,
  openBillingPortal,
} from "./BillingPortalButton";

describe("BillingPortalButton", () => {
  it("opens the returned portal URL and clears any prior error", async () => {
    const navigate = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await openBillingPortal({
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ url: "https://billing.example.test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
      navigate,
      setLoading,
      setError,
    });

    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith("https://billing.example.test");
  });

  it("surfaces a retryable error when the portal request fails", async () => {
    const navigate = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await openBillingPortal({
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ error: "No active subscription found" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
      navigate,
      setLoading,
      setError,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(
      "Could not open billing right now. Please try again.",
    );
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    consoleError.mockRestore();
  });

  it("associates the visible failure with the portal button", () => {
    const markup = renderToStaticMarkup(
      <BillingPortalButtonView
        label="Manage billing"
        loadingLabel="Opening billing..."
        loading={false}
        error="Could not open billing right now. Please try again."
        errorId="billing-portal-error"
        onClick={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-describedby="billing-portal-error"');
    expect(markup).toContain('id="billing-portal-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Could not open billing right now");
  });
});
