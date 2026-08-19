import "server-only";

export const CHAT_ONLY_ROLLOUT_ENV = {
  directSales: "CHAT_ONLY_DIRECT_SALES_ENABLED",
  directCanaryBusinessId: "CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID",
  partnerAssignment: "CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED",
} as const;

export interface ChatOnlyRolloutSnapshot {
  directSalesEnabled: boolean;
  partnerAssignmentEnabled: boolean;
}

type RolloutEnvironment = Readonly<Record<string, string | undefined>>;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Chat-only acquisition stays fail-closed. Only the exact value `1` enables a
 * channel; truthy-looking values such as `true`, `yes`, or `01` remain off.
 *
 * These switches are intentionally independent from PLAN_SALES_STATUS. Direct
 * Stripe sales and partner-admin assignment have different rollout schedules
 * and neither switch grants an entitlement by itself.
 */
export function getChatOnlyRolloutSnapshot(
  environment: RolloutEnvironment = process.env
): ChatOnlyRolloutSnapshot {
  return {
    directSalesEnabled:
      environment[CHAT_ONLY_ROLLOUT_ENV.directSales] === "1",
    partnerAssignmentEnabled:
      environment[CHAT_ONLY_ROLLOUT_ENV.partnerAssignment] === "1",
  };
}

export function isChatOnlyDirectSalesEnabled(
  environment: RolloutEnvironment = process.env
): boolean {
  return getChatOnlyRolloutSnapshot(environment).directSalesEnabled;
}

/**
 * Authorize direct Chat Only acquisition for one authenticated business.
 *
 * The established broad flag keeps its exact behavior: `1` enables every
 * otherwise-eligible direct business. While that flag is off, one canonical
 * UUID may be admitted for a disposable canary. The canary value is compared
 * only with the server-resolved business ID; malformed, padded, or
 * comma-separated values fail closed.
 */
export function isChatOnlyDirectAcquisitionEnabledForBusiness(
  businessId: string,
  environment: RolloutEnvironment = process.env,
): boolean {
  if (!CANONICAL_UUID_PATTERN.test(businessId)) return false;
  if (isChatOnlyDirectSalesEnabled(environment)) return true;

  const canaryBusinessId =
    environment[CHAT_ONLY_ROLLOUT_ENV.directCanaryBusinessId];
  if (
    !canaryBusinessId ||
    !CANONICAL_UUID_PATTERN.test(canaryBusinessId)
  ) {
    return false;
  }

  return canaryBusinessId.toLowerCase() === businessId.toLowerCase();
}

export function isChatOnlyPartnerAssignmentEnabled(
  environment: RolloutEnvironment = process.env
): boolean {
  return getChatOnlyRolloutSnapshot(environment).partnerAssignmentEnabled;
}
