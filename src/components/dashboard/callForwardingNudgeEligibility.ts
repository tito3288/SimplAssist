export interface CallForwardingNudgeEligibility {
  hasActivePhoneNumber: boolean;
  canUseMissedCallSms: boolean;
  callForwardingEnabled: boolean;
  resolvedAt: string | null;
}

/**
 * The nudge is discovery-only: once the owner resolves it, it never returns,
 * even if call forwarding is disabled again later.
 */
export function shouldShowCallForwardingNudge({
  hasActivePhoneNumber,
  canUseMissedCallSms,
  callForwardingEnabled,
  resolvedAt,
}: CallForwardingNudgeEligibility): boolean {
  return (
    hasActivePhoneNumber &&
    canUseMissedCallSms &&
    !callForwardingEnabled &&
    resolvedAt === null
  );
}
