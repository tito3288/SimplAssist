import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => {
  throw new Error("slug.shared must not import server-only modules");
});
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("slug.shared must not import the Supabase admin client");
});

import { generateSlug, isPendingSlug } from "./slug.shared";

describe("slug.shared", () => {
  it("recognizes only pending placeholder slugs", () => {
    expect(isPendingSlug("pending-abc123")).toBe(true);
    expect(isPendingSlug("customer-pending-abc123")).toBe(false);
    expect(isPendingSlug("Pending-abc123")).toBe(false);
    expect(isPendingSlug(null)).toBe(false);
    expect(isPendingSlug(undefined)).toBe(false);
  });

  it("derives normalized, bounded slugs without using reserved tombstones", () => {
    expect(generateSlug("Northstar & Sons Home Care")).toBe(
      "northstar-sons-home-care"
    );
    expect(generateSlug("")).toBe("business");
    expect(generateSlug("deleted-customer")).toBe("biz-deleted-customer");
    expect(generateSlug("A".repeat(80))).toHaveLength(60);
  });
});
