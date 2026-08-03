import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DASHBOARD_LEAVES = [
  "./(dashboard)/billing/page.tsx",
  "./(dashboard)/calendar/page.tsx",
  "./(dashboard)/contacts/page.tsx",
  "./(dashboard)/conversations/page.tsx",
  "./(dashboard)/dashboard/page.tsx",
  "./(dashboard)/knowledge-gaps/page.tsx",
  "./(dashboard)/settings/page.tsx",
  "./(dashboard)/widget/page.tsx",
] as const;

describe("workspace access route inventory", () => {
  it.each(DASHBOARD_LEAVES)(
    "gates %s before its dashboard data context",
    (relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      const gate = source.indexOf("await requireWorkspacePageAccess()");
      const businessContext = source.search(
        /await getDashboard(?:Business|Entitled)Context\(\)/,
      );

      expect(gate).toBeGreaterThan(-1);
      expect(businessContext).toBeGreaterThan(gate);
    },
  );

  it("keeps successful login navigation relative to the current Host", () => {
    const source = readFileSync(
      new URL("./(auth)/login/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('router.push("/dashboard")');
    expect(source).not.toMatch(/router\.push\(["']https?:\/\//);
  });
});
