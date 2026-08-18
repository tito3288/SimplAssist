# Chat Only Phase 2 direct flow

Execution and deployment contract for the SimplAssist-owned $10 Chat Only
purchase path and simplified no-SMS onboarding.

Date: 2026-08-18

## Phase boundary

Phase 2 builds the direct flow behind a default-off server gate. It does not
open public sales, create or change hosted Stripe objects, deploy migrations,
enable partner assignment, or make any Telnyx provider call for Chat Only.

The 200-reply value remains approved product metadata and customer-facing plan
copy in this phase. The acquisition switch must stay off until the next phase
adds the authoritative reply ledger, idempotency, rate limits, origin controls,
calendar abuse defenses, quota fallback, and operational alerts.

## Direct SimplAssist contract

- A new direct, unpartnered Stripe business may save a durable advisory plan
  selection only when the exact direct-sales switch is `1` and the Chat Only
  Price ID is configured without a collision.
- Plan selection occurs before the SMS-specific onboarding steps. Chat Only
  follows the business profile, service/FAQ, primary goal, AI customization,
  and review path; it skips EIN/legal identity, A2P use case, phone selection,
  carrier review, and every Telnyx readiness call.
- The saved selection controls onboarding navigation and checkout intent only.
  It is never an entitlement and cannot make a dashboard ready.
- Selection is saved through a service-only compare-and-swap under the same
  business lock used by Checkout. Direct owner writes remain possible for
  advisory state, but a database trigger rejects any non-null intent whose
  family contradicts a durable system lock.
- Chat Only checkout contains exactly one recurring line item and no $25 SMS
  setup fee. The server retrieves the selected Price before starting checkout
  and verifies active USD 1000 monthly licensed/non-metered terms.
- Stripe synchronization independently verifies the signed Checkout plan,
  subscription Price, one-item quantity, and immutable $10 monthly terms. It
  may accept an inactive historical Price for an existing subscription so
  archiving acquisition does not revoke webhook processing.
- A service-only atomic finalizer completes onboarding only after an exact
  active or trialing Chat Only subscription, matching Stripe customer and
  subscription IDs, direct/unpartnered billing authority, core setup facts,
  and the Chat Only family lock all agree under a business-row lock.
- Dashboard access requires that protected completion marker plus current
  authoritative Chat Only billing and core setup. An owner-writable intent or
  stale phone/Telnyx rows cannot satisfy readiness.
- A previously completed `past_due` Chat Only subscription retains the
  dashboard under the existing entitlement grace and is sent to the pinned
  Billing Portal for recovery. An incomplete `past_due` account cannot start a
  second subscription. Canceled same-family acquisition may restart only while
  acquisition is enabled.
- Disabling the acquisition flag stops new or canceled entry. It does not
  revoke existing entitlements or block an active/trialing paid onboarding
  retry.

When the Phase 2 gate is off, new Starter/Growth onboarding retains its legacy
step order and review picker. A stale advisory Chat Only selection does not
strand the existing SMS pre-checkout number flow.

## Durable plan-family boundary

Migration 059 adds one service-owned `sms` or `chat_only` family lock for a
business. It is backfilled from direct and partner plan authority, pending
plan history, linked partner provisioning history, usage-period history,
direct Stripe legacy billing overrides with no subscription, and actual
retained Telnyx/SMS provider resources. Partner Chat authority and Chat
subscriptions take precedence over stale override flags. Conflicting evidence
stops the migration for review.

The exact selected plan and its family are claimed atomically before Stripe
creates a customer or Checkout Session. New onboarding acquisition rechecks
the current advisory intent and absence of any subscription under the business
lock; legacy SMS checkout and canceled same-family reacquisition explicitly do
not depend on advisory intent. This intentionally means that beginning and
then canceling Checkout still leaves the selected family locked. A customer
may freely change the advisory choice until Checkout begins; after that point
an operator must not delete or rewrite the lock to force a change.

Stripe synchronization and partner assignment share the same business-first
lock. Clearing direct or partner authority does not erase family history, so a
two-step unassign/reassign operation cannot bypass the transition block. A
future reviewed lifecycle workflow is the only component allowed to change
family after it has safely provisioned or released the relevant Telnyx
resources.

A provisional direct Chat Checkout claim also blocks same-family partner
assignment until Stripe synchronization promotes the claim to paid authority.
If Checkout is abandoned, both family changes and partner reassignment remain
support-reviewed; this conservative fence prevents an open external payment
from being charged after billing authority moved elsewhere.

Phase 2 therefore rejects all Chat Only-to-SMS and SMS-to-Chat Only plan
changes. Same-family Starter/Growth/Full changes remain supported. The legacy
repair-window shape of a partner-linked business temporarily using direct
Stripe may still perform an SMS checkout; it may never use direct Chat Only.

## Partner and branding contract

The shared database, entitlement, onboarding-state, dashboard, host routing,
widget attribution, Google OAuth, and SimplAssist/Alpha Dog branding readers
recognize Chat Only. Partner billing remains external to Stripe.

Partner Chat Only acquisition stays hidden and default-off in Phase 2. A
partner-authoritative Chat Only record is displayed as waiting for external
activation because this phase deliberately does not add an atomic partner
completion workflow. Enabling the partner option and invoice workflow is a
later reviewed slice.

## Required configuration

`STRIPE_PRICE_CHAT_ONLY` is server-only. Before any rollout, verify in the
same Stripe account and mode used by the deployment that it is:

- an active Stripe Price whose ID starts with `price_`;
- USD 1000 per unit;
- recurring every one month;
- licensed/non-metered with quantity one;
- distinct from every Starter, Growth, Full, setup-fee, and SMS-overage Price.

Keep the Price ID configured after the first Chat Only subscription exists,
even if acquisition is later disabled. `CHAT_ONLY_DIRECT_SALES_ENABLED=1` is
the separate acquisition authority. `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED`
remains independent and off.

The Stripe Billing Portal configuration remains pinned and must not allow
customer plan switching. Cross-family changes made outside the application
are rejected again by guarded database synchronization.

## Deployment order

1. Keep both acquisition flags unset or `0` and do not advertise the tier.
2. Verify hosted migration state, then apply every pending migration through
   059 in numeric order (including 056 and 057 if they are still local-only)
   before deploying application code that recognizes Chat Only, writes
   onboarding intent, or calls the new service-only functions.
3. Create or select the reviewed Stripe Price separately, verify its immutable
   terms, and configure `STRIPE_PRICE_CHAT_ONLY` while the acquisition flag is
   still off.
4. Deploy the compatible application and confirm existing SMS, partner,
   branding, OAuth, checkout, webhook, onboarding, dashboard, and Telnyx
   regression suites.
5. Complete the AI metering and public-widget protection phase.
6. Run the Phase 0 target inventory again, verify the hosted migrations and
   environment, and perform an approved disposable test-mode direct canary.
7. Enable direct acquisition only after final acceptance. Enable partner
   assignment later and independently after its own canary.

## Explicitly deferred

- authoritative reservation/completion accounting for 200 web-chat replies;
- provider token/call cost telemetry and quota dashboard;
- public widget idempotency, origin authorization, signed session token,
  layered rate/concurrency limits, and offline lead fallback;
- polished emergency-rollback guidance for an abandoned Checkout whose
  durable family lock outlives the now-disabled acquisition flow (provider
  access already fails closed; resolve the onboarding presentation before
  enabling sales);
- stricter calendar-tool anti-spam and booking validation;
- partner-admin Chat Only exposure and atomic external activation;
- Chat Only/SMS upgrade and downgrade orchestration;
- Stripe event-watermark ordering for later plan-transition workflows;
- Telnyx provisioning on upgrade and remote release on downgrade.

No production or hosted-state change is authorized by this document.

## Local verification

Phase 2 completed its local acceptance pass on 2026-08-18 with both rollout
switches still off:

- fresh migration replay through 059 and all 41 pgTAP files: 1,949 assertions;
- full Vitest suite: 321 files and 5,462 tests;
- TypeScript, ESLint, production Next.js build, and `git diff --check`;
- an independent adversarial review of checkout, billing, onboarding, Telnyx
  fences, partner isolation, branding, and existing-plan behavior.

The verification created no hosted Stripe object, environment variable,
Supabase migration, deployment, Telnyx resource, or customer-facing release.
