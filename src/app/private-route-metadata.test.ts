import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingStateForOwner: vi.fn(),
}));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitlements: vi.fn(),
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getSmsReadinessForBusiness: vi.fn(),
}));
vi.mock("@/lib/billing/entitlements", () => ({ canUseFeature: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ getAdminGateState: vi.fn() }));

import { metadata as authMetadata } from "./(auth)/layout";
import { metadata as dashboardMetadata } from "./(dashboard)/layout";
import { metadata as onboardingMetadata } from "./(onboarding)/layout";
import { metadata as adminMetadata } from "./admin/layout";
import { metadata as widgetPreviewMetadata } from "./widget/preview/layout";

const privateRouteMetadata = [
  ["auth", authMetadata],
  ["onboarding", onboardingMetadata],
  ["dashboard", dashboardMetadata],
  ["admin", adminMetadata],
  ["widget preview", widgetPreviewMetadata],
] as const;

describe("private route metadata", () => {
  it.each(privateRouteMetadata)(
    "marks the %s route group noindex and nofollow",
    (_name, metadata) => {
      expect(metadata).toMatchObject({
        robots: { index: false, follow: false },
      });
    }
  );
});
