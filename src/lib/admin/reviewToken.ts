import "server-only";

import { timingSafeEqual } from "crypto";

// Constant-time check of the A2P review override token. Fail-closed: an
// unset/empty configured token or a missing provided token never matches.
// Length is checked first because timingSafeEqual requires equal-length
// buffers; the length itself is the only thing a timing signal can reveal.
export function isAuthorizedReviewToken(
  providedToken: string | null | undefined,
  configuredToken: string | null | undefined
): boolean {
  if (!configuredToken || !providedToken) return false;

  const provided = Buffer.from(providedToken, "utf8");
  const configured = Buffer.from(configuredToken, "utf8");
  if (provided.length !== configured.length) return false;

  return timingSafeEqual(provided, configured);
}
