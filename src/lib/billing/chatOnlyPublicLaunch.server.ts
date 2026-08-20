import "server-only";

import { isChatOnlyDirectSalesEnabled } from "@/lib/billing/chatOnlyRollout.server";
import { hasValidChatOnlyStripePrice } from "@/lib/stripe/config";

type PublicLaunchEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Authoritative public presentation policy for direct Chat Only sales.
 *
 * The exact-business canary and partner-assignment switches are intentionally
 * irrelevant here: neither may advertise a direct plan publicly. A broad
 * launch also stays hidden until its selected Stripe Price is syntactically
 * ready and distinct from every configured non-Chat Price.
 */
export function isChatOnlyPublicLaunchEnabled(
  environment: PublicLaunchEnvironment = process.env,
): boolean {
  return (
    isChatOnlyDirectSalesEnabled(environment) &&
    hasValidChatOnlyStripePrice(environment)
  );
}
