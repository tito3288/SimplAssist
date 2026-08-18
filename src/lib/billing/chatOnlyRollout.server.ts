import "server-only";

export const CHAT_ONLY_ROLLOUT_ENV = {
  directSales: "CHAT_ONLY_DIRECT_SALES_ENABLED",
  partnerAssignment: "CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED",
} as const;

export interface ChatOnlyRolloutSnapshot {
  directSalesEnabled: boolean;
  partnerAssignmentEnabled: boolean;
}

type RolloutEnvironment = Readonly<Record<string, string | undefined>>;

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

export function isChatOnlyPartnerAssignmentEnabled(
  environment: RolloutEnvironment = process.env
): boolean {
  return getChatOnlyRolloutSnapshot(environment).partnerAssignmentEnabled;
}
