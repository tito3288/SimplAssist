import "server-only";

import { resend } from "./client";
import type { BusinessEmailBrand } from "./businessEmailBrand.server";

export type BusinessEmailMessage = Omit<
  Parameters<typeof resend.emails.send>[0],
  "from"
>;

export type SendBusinessEmailInput = {
  brand: BusinessEmailBrand;
  context: string;
  message: BusinessEmailMessage;
  /**
   * Suppress provider details and sender/message fields from failure logs.
   * Recovery links and other bearer secrets can be echoed by provider errors.
   */
  sensitive?: boolean;
};

export async function sendBusinessEmail({
  brand,
  context,
  message,
  sensitive = false,
}: SendBusinessEmailInput): Promise<
  Awaited<ReturnType<typeof resend.emails.send>>
> {
  try {
    const result = await resend.emails.send({
      ...message,
      from: brand.from,
    } as Parameters<typeof resend.emails.send>[0]);

    if (result.error) throw result.error;
    return result;
  } catch (error) {
    if (sensitive) {
      console.error(`[email:business] ${context}: sensitive send failed`, {
        partnerId: brand.partnerId,
      });
      throw error;
    }

    if (brand.partnerId !== null && !brand.usedFallbackSender) {
      console.error(
        `[email:business] ${context}: verified partner sender rejected`,
        { partnerId: brand.partnerId, from: brand.from },
        error,
      );
    } else {
      console.error(`[email:business] ${context}: send failed`, error);
    }
    throw error;
  }
}
