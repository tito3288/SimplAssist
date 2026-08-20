import "server-only";

export const WIDGET_PROACTIVE_INVITATIONS_ENV = {
  broad: "WIDGET_PROACTIVE_INVITATIONS_ENABLED",
  canaryBusinessId: "WIDGET_PROACTIVE_INVITATIONS_CANARY_BUSINESS_ID",
} as const;

type ProactiveInvitationEnvironment = Readonly<
  Record<string, string | undefined>
>;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Public proactive invitations fail closed. The owner preference is stored
 * separately so a runtime rollback never overwrites an owner's choice.
 */
export function arePublicWidgetProactiveInvitationsEnabledForBusiness(
  businessId: string,
  environment: ProactiveInvitationEnvironment = process.env,
): boolean {
  if (!CANONICAL_UUID_PATTERN.test(businessId)) return false;
  if (environment[WIDGET_PROACTIVE_INVITATIONS_ENV.broad] === "1") {
    return true;
  }

  const canaryBusinessId =
    environment[WIDGET_PROACTIVE_INVITATIONS_ENV.canaryBusinessId];
  return Boolean(
    canaryBusinessId &&
      CANONICAL_UUID_PATTERN.test(canaryBusinessId) &&
      canaryBusinessId.toLowerCase() === businessId.toLowerCase(),
  );
}
