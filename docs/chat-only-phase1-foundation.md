# Chat-only Phase 1 foundation

Execution record for the shared product-plan and entitlement foundation.

Date: 2026-08-18

## Completed scope

- Added the canonical `chat_only` plan identifier across TypeScript readers,
  database constraints, usage-period snapshots, partner provisioning records,
  Stripe subscription synchronization, and the current admin health filter.
- Added catalog metadata for the approved $10 price, zero included SMS parts,
  and 200 monthly AI replies. Existing plans retain their exact prices and SMS
  allowances.
- Replaced ranked entitlement inheritance with an explicit capability decision
  for every plan-feature pair.
- Granted Chat Only the contact/conversation inbox, web widget, widget branding,
  AI customization, Google Calendar, and direct-booking capabilities.
- Denied Chat Only missed-call SMS, manual SMS, and AI SMS conversations.
- Added capability-preserving upgrade recommendations and a shared
  `planRequiresSmsProvisioning` predicate.
- Added defense-in-depth SMS preflight checks so a zero-SMS allowance cannot be
  interpreted as unlimited SMS.
- Made direct and partner readers recognize Chat Only while keeping customer
  selectors and partner-admin plan choices hidden.
- Added server-side, exact-`1`, default-off direct and partner acquisition
  gates. Direct checkout also has no Chat Only Stripe-price mapping in Phase 1.
  The partner gate blocks creation of new Chat Only work; recovery of an
  already-created durable provisioning job remains allowed by design.
- Prevented direct or partner Chat Only authority—and malformed direct plan
  data—from entering the SMS/Telnyx launch path.
- Blocked recognized direct or partner Chat Only authority from number search,
  number selection, and carrier-status refresh before any provider call or
  onboarding mutation. The existing direct SMS pre-checkout number flow keeps
  one explicit, tested no-subscription exception.

## Existing-plan regression protection

Starter, Growth, and Full retain their prior capability vectors, prices,
included SMS parts, sales visibility, Stripe price mappings, setup fee, and
overage amount. Existing Stripe synchronization does not require a Chat Only
price environment variable.

## Verification

- Fresh local migrations `001–057` passed.
- Full pgTAP suite: 38 files and 1,812 assertions passed, including post-test
  durable-state cleanliness verification.
- Full Vitest suite: 312 files and 5,283 tests passed.
- TypeScript, ESLint, the optimized Next.js production build, and
  `git diff --check` passed.

## Deliberately unavailable after Phase 1

- No Chat Only Stripe Product/Price or checkout line item exists.
- No customer-facing or partner-admin Chat Only choice is visible.
- Existing onboarding and dashboard readiness are still SMS-shaped.
- The 200-reply allowance is product metadata only; no authoritative AI reply
  reservation/completion ledger exists yet.
- No public-widget rate limiting, origin authorization, or quota fallback UX
  was added in this phase.
- No cross-family plan upgrade/downgrade or Telnyx release workflow is enabled.
- Neither rollout flag was enabled, and no hosted database, Stripe, Telnyx, or
  Railway state was changed.

Phase 2 should implement the direct SimplAssist purchase and no-SMS onboarding
path behind the still-disabled direct rollout gate. AI reply metering and abuse
controls must be complete before public sales are enabled.
