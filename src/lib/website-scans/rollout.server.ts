import "server-only";

export const RICHER_WEBSITE_SCAN_ENV = {
  broad: "RICHER_WEBSITE_SCAN_ENABLED",
  canaryBusinessId: "RICHER_WEBSITE_SCAN_CANARY_BUSINESS_ID",
} as const;

type WebsiteScanEnvironment = Readonly<Record<string, string | undefined>>;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Keep the production release reversible without mixing rollout state into
 * owner data. Development and test builds use the richer scanner by default;
 * production admits only the explicit canary or the exact broad switch.
 */
export function isRicherWebsiteScanEnabledForBusiness(
  businessId: string,
  environment: WebsiteScanEnvironment = process.env,
): boolean {
  if (!CANONICAL_UUID_PATTERN.test(businessId)) return false;

  if (environment.NODE_ENV !== "production") return true;
  if (environment[RICHER_WEBSITE_SCAN_ENV.broad] === "1") return true;

  const canaryBusinessId =
    environment[RICHER_WEBSITE_SCAN_ENV.canaryBusinessId];
  return Boolean(
    canaryBusinessId &&
      CANONICAL_UUID_PATTERN.test(canaryBusinessId) &&
      canaryBusinessId.toLowerCase() === businessId.toLowerCase(),
  );
}
