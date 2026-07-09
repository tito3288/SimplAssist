# SimplAssist Chat Handoff — 2026-07-09

## Current Status

Phase 9 cost handling and Phase 8.5 admin v1 are merged to `main` and deployed to production.

Merge commit:
- `2b6223c` — `Merge phase9-cost-handling`

This release adds Stripe test-mode checkout, subscription sync, paid launch gating, usage metering/caps, paid-held onboarding states, and the minimal `/admin` shell for A2P approvals and billing/test flags.

Stripe remains in **TEST mode intentionally** in production. The live-key guard is still in place: `sk_live_...` keys are rejected and Checkout prices are asserted to be test-mode prices. Live billing requires the deliberate pre-launch switch documented in the roadmap.

## Commits Shipped

Primary branch commits merged through `2b6223c`:

- `d3d1604` — `Phase 9 billing and paid launch gate`
  - Added Stripe Checkout/finalize/webhook sync.
  - Added paid launch order: checkout success → `telnyx_submission_disabled` check → Phase 8 risk clearance → Phase 7 registration-attempt claim → brand/campaign registration → messaging profile → voice app → owned-number attach or pending-number purchase.
  - Added pending-number lifecycle and owned-number handling.
- `51fea1a` — `Phase 9 usage metering and SMS caps`
  - Added usage periods/events and SMS-part counting.
  - Added server-side send gates for manual sends, AI replies, MMS fallback SMS, and missed-call SMS.
- `1c7deb5` — `Add Phase 8.5 admin shell and billing flags`
  - Added `/admin`, admin auth allowlist, billing/test flags, A2P review UI, and shared approval function.
- `6eb886f` — `Handle paid launch retry edge cases`
  - Fixed paid/exempt retry paths and paid risk-reset recovery.
- `a83e292` — `Allow unpaid disabled accounts to reach checkout`
  - Allowed unpaid safety-disabled accounts to reach Stripe Checkout, while already-paid retries avoid a second Checkout.
- `a5fb263` — `Show paid onboarding launch holds`
  - Added paid plan display and held-state messaging.
- `dc98ec9` — `Refine paid launch hold CTAs`
  - Reason-specific hold CTAs: no retry for impossible states, choose-number CTA for number loss, wait state for pending review, retry only for transient/unknown failures.
- `ee50706` — `Add pre-launch checklist to A2P roadmap`
  - Added the locked Pre-Launch Checklist after Phase 11.

## Database / Migration State

- Migration `019_phase9_billing_launch.sql` was dry-run checked before push.
- Dry-run output showed only migration `019`.
- Migration `019` was applied with `npx supabase db push`.
- Migration `020_phase9_usage_metering.sql` was dry-run checked before push.
- Dry-run output showed only migration `020`.
- Migration `020` was applied with `npx supabase db push`.
- Phase 8.5/admin v1 did not add a separate migration; it uses flags and usage tables from `019`/`020`.

## Smoke Test Results

Verified locally:

- Stripe test checkout succeeds.
- Stripe webhooks return `200`.
- `stripe_webhook_events` rows are recorded and marked processed.
- Subscription sync writes plan/status/customer/subscription/session/setup-fee fields.
- Browser return hits `/api/billing/finalize`.
- Launch gate order was verified through the paid path.
- `telnyx_submission_disabled` stops launch immediately after payment.
- Disabled launch produces zero Telnyx calls: no brand, campaign, messaging profile, voice app, campaign assignment, or number purchase.
- Paid-held onboarding display shows the subscribed plan instead of fresh unpaid checkout.
- Reason-specific paid hold CTAs render correctly.
- `/admin` verified locally.
- `/admin` verified in production: loads for allowlisted admin, returns 404 for customers/non-admins.

Not runtime-tested yet; code-verified and needs production/pilot validation:

- Webhook replay/dedupe under event-id collision.
- Usage metering and 80%/100% gates on live SMS sends.
- Pilot conversion.
- `past_due` handling from a failed Stripe payment.

## Bugs Found And Fixed During Smoke Testing

- Paid-but-disabled accounts could reach Stripe but returned to a fresh-looking unpaid Review & Pay screen.
  - Fixed by adding subscription snapshot data to onboarding state and rendering a paid-held setup state.
- Review & Pay defaulted to Growth even after paying for Starter.
  - Fixed by defaulting plan selection/display from the synced subscription plan.
- Already-paid retry could create a second Checkout session in some recovery paths.
  - Fixed by attempting launch first only when billing is already satisfied.
- `telnyx_submission_disabled` on an unpaid account initially blocked Checkout entirely.
  - Fixed so unpaid disabled accounts can still pay, then stop safely before Telnyx.
- Generic "Retry SMS setup" CTA appeared for states where retry could never succeed.
  - Fixed with reason-specific hold classification and CTAs.

## Railway Environment

Added/confirmed for this release:

- `STRIPE_SECRET_KEY` — test-mode `sk_test_...` only.
- `STRIPE_WEBHOOK_SECRET` — production Stripe Dashboard webhook signing secret for the test-mode production endpoint.
- `STRIPE_PRICE_SMS_ONLY`
- `STRIPE_PRICE_SMS_AND_CHAT`
- `STRIPE_PRICE_FULL`
- `STRIPE_PRICE_SETUP_FEE`
- `STRIPE_PRICE_SMS_OVERAGE_PART`
- `SIMPLASSIST_ADMIN_USER_IDS`

Existing A2P/admin reminders:

- `A2P_REVIEW_ADMIN_TOKEN` should be regenerated before relying on token fallback long-term because the previous value was exposed in screenshots.
- `A2P_REVIEW_EMAIL` / `SUPPORT_EMAIL` continue to drive manual A2P review notifications.

## Test Fixtures

Engivations:
- Parked as the paid-but-disabled billing fixture.
- Has a Stripe test subscription.
- `telnyx_submission_disabled = true`.
- Used to validate payment, webhook, subscription sync, paid-held UI, and zero-Telnyx safety stop.

Bryan Develops:
- Never-submit fixture.
- Fake EIN / internal test account.
- Keep `telnyx_submission_disabled = true`.

Alpha Dog:
- Pilot/billing-exempt fixture.
- Awaiting replacement campaign under the existing approved brand.
- Locked strategy: create replacement campaign, repoint `telnyx_campaign_id`, keep rejected campaign as history.

## Roadmap State

`docs/a2p-10dlc-roadmap.md` now contains the **Pre-Launch Checklist 🔒** after Phase 11.

Checklist items 1-9 include:

- Stripe live-mode product/price setup.
- Live production Stripe webhook endpoint.
- Deliberate live-mode code switch.
- `A2P_REVIEW_ADMIN_TOKEN` regeneration.
- Alpha Dog replacement campaign recovery.
- `5b` call-forwarding feature build: plan → review → implement.
- Real EIN clean-account Telnyx validation.
- `6b` post-approval product validation on the real EIN account.
- Pricing re-verification.
- Production smoke pass.
- First-customer caution: do not onboard many customers before validating billing behavior on the first ones.

## Operational Notes

- Production currently uses Stripe test mode by design.
- Do not remove the live-key guard until the roadmap Pre-Launch Checklist reaches the deliberate live-mode switch.
- Any real Telnyx submission is still real money and permanent carrier/TCR history.
- Keep `telnyx_submission_disabled` enabled on fixtures that should never submit.
- Usage metering is implemented but still needs live SMS validation against real send/receive paths.

## Next Architect-Review Focus

Phase 11 planning is next.

Open decision:
- Build the full Sole Proprietor path now, including OTP, last-4 SSN, registrant mobile, and one-number constraints; or
- Launch EIN-only first, defer Sole Proprietor, and keep the product narrowly scoped for the first real customer.
