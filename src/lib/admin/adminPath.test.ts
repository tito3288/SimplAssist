import { describe, expect, it } from "vitest";

import { isAdminPath } from "./adminPath";

describe("isAdminPath", () => {
  it("matches the admin page tree", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/tickets")).toBe(true);
    expect(isAdminPath("/admin/aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb")).toBe(
      true
    );
  });

  it("matches the admin API tree", () => {
    expect(isAdminPath("/api/admin")).toBe(true);
    expect(isAdminPath("/api/admin/business-flags")).toBe(true);
    expect(isAdminPath("/api/admin/a2p-risk-review")).toBe(true);
  });

  it("never matches customer paths that merely start with admin-like text", () => {
    expect(isAdminPath("/administrators")).toBe(false);
    expect(isAdminPath("/admin-panel")).toBe(false);
    expect(isAdminPath("/api/administrate")).toBe(false);
    expect(isAdminPath("/dashboard")).toBe(false);
    expect(isAdminPath("/")).toBe(false);
  });
});
