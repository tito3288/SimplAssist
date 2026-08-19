import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { normalizeWidgetOrigin } from "./origin.server";
import { resolvePublicWidgetAccess } from "./access.server";

function databaseResult(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  const promise = Promise.resolve({ data, error });
  Object.assign(chain, {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  });
  mocks.from.mockReturnValue(chain);
}

beforeEach(() => vi.clearAllMocks());

describe("public widget origin access", () => {
  it("allows an exact configured hostname", async () => {
    databaseResult({
      id: "widget-1",
      business_id: "00000000-0000-4000-8000-000000000001",
      is_active: true,
      allowed_hostnames: ["example.com"],
    });
    const result = await resolvePublicWidgetAccess(
      "00000000-0000-4000-8000-000000000001",
      normalizeWidgetOrigin("https://example.com")!,
    );
    expect(result).toMatchObject({ status: "allowed" });
  });

  it.each([
    [null, "missing config"],
    [{ allowed_hostnames: [] }, "empty allowlist"],
    [{ allowed_hostnames: ["other.example"] }, "different hostname"],
  ])("returns the same forbidden result for %s", async (data, label) => {
    void label;
    databaseResult(data);
    expect(
      await resolvePublicWidgetAccess(
        "00000000-0000-4000-8000-000000000001",
        normalizeWidgetOrigin("https://example.com")!,
      ),
    ).toEqual({ status: "forbidden" });
  });

  it("fails closed for malformed persisted hostnames and DB errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    databaseResult({ allowed_hostnames: ["*.example.com"] });
    expect(
      await resolvePublicWidgetAccess(
        "00000000-0000-4000-8000-000000000001",
        normalizeWidgetOrigin("https://example.com")!,
      ),
    ).toEqual({ status: "unavailable" });

    databaseResult(null, { message: "down" });
    expect(
      await resolvePublicWidgetAccess(
        "00000000-0000-4000-8000-000000000001",
        normalizeWidgetOrigin("https://example.com")!,
      ),
    ).toEqual({ status: "unavailable" });
  });
});
