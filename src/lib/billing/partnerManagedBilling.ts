export const EXTERNAL_BILLING_MESSAGE = "Billing is managed externally.";

export function partnerManagedBillingMessage(
  partnerName: string | null,
): string {
  return partnerName
    ? `Billing is handled by ${partnerName}.`
    : EXTERNAL_BILLING_MESSAGE;
}
