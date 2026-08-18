export const CHECKOUT_FINALIZE_ERROR =
  "Checkout succeeded, but we could not finish setup automatically. Retry finalization to continue.";

export type CheckoutFinalizeFailureAction =
  | { kind: "resume_onboarding" }
  | { kind: "retry_finalization"; message: string };

export function checkoutFinalizeErrorMessage(
  responseOk: boolean,
  payloadError?: string,
): string | null {
  if (responseOk && !payloadError) return null;

  const detail = payloadError?.trim();
  return detail
    ? `${CHECKOUT_FINALIZE_ERROR} ${detail}`
    : CHECKOUT_FINALIZE_ERROR;
}

export function checkoutFinalizeFailureAction(args: {
  responseOk: boolean;
  payloadError?: string;
  hasState: boolean;
}): CheckoutFinalizeFailureAction | null {
  const message = checkoutFinalizeErrorMessage(
    args.responseOk,
    args.payloadError,
  );
  if (!message) return null;

  return args.hasState
    ? { kind: "resume_onboarding" }
    : { kind: "retry_finalization", message };
}
