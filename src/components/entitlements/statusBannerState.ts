export function pausedFeaturesStorageKey(args: {
  businessId: string;
  plan: string;
  status: string;
  pausedFeatures: string[];
}): string {
  const signature = [
    args.businessId,
    args.plan,
    args.status,
    ...[...args.pausedFeatures].sort(),
  ].join(":");
  return `simplassist:paused-features:${signature}`;
}

export function shouldShowPaymentWarning(status: string): boolean {
  return status === "past_due";
}
