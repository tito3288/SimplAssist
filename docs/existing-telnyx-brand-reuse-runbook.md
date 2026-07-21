# Existing Telnyx Brand Reuse Runbook

This is the narrow first version for a verified brand that already exists
inside SimplAssist's own Telnyx account. It does not transfer or share a brand
from a customer's separate Telnyx account.

## Release order

1. Review `supabase/migrations/033_existing_telnyx_brand_reuse.sql`.
2. Run the two redacted preflight queries at the top of the migration.
3. If either query returns rows, stop. Verify ownership and select the one
   canonical business record. Resolve the duplicate EIN or case-insensitive
   Telnyx brand attachment manually; never auto-merge customer accounts.
4. The project owner runs `npx supabase db push`.
5. Run the database tests, application tests, and TypeScript check.
6. Deploy the application only after migration 033 is present. Code that reads
   the private link tables must not be deployed first.

## First SimplAssist onboarding

1. In Telnyx, record the public TCR brand ID. For SimplAssist this is
   `BL69PDP`. Do not paste the internal Telnyx UUID into the admin form.
2. Open the SimplAssist business in the admin area and inspect the TCR ID.
   Inspection is read-only and works before the legal onboarding fields are
   complete. Use the redacted legal name, entity category, address state, and
   ZIP preview to enter matching onboarding information.
3. Complete the normal website scan, FAQs, services, hours, AI settings, legal
   verification, SMS use case, phone-number choice, and A2P risk review.
4. Before checkout, return to the admin business page. Inspect, stage, review,
   and explicitly approve the existing brand. Checkout is intentionally
   blocked while a staged link is pending or blocked.
5. Complete checkout. Launch rechecks the exact captured Telnyx brand and local
   legal identity, then atomically connects it before any Telnyx resource can
   be created, archived, deactivated, deleted, or replaced.
6. Launch leaves the old campaign, old number, old messaging profile, and old
   voice application untouched. It creates or recovers only the new campaign
   and dedicated resources for the new SimplAssist demo account.

Important: a read-only inspection does not reserve the brand. The admin must
stage and approve it before the customer starts checkout. Otherwise the normal
new-brand path remains active.

## Expected stop states

- Five campaigns: admin inspection says the brand is at Telnyx's five-campaign
  cap and cannot be staged.
- Identity edit after approval: the approval immediately returns to pending;
  checkout and launch stop until a fresh inspection, stage, and approval.
- Temporary Telnyx read failure: approval remains approved, registration is
  marked failed/retryable, and no provider mutation starts.
- Permanent pre-consumption mismatch: the exact approved request is blocked,
  registration is recoverable after admin review, and no provider resource is
  created.
- Failure after a successful consume: the link remains consumed and immutable.
  A retry revalidates it and recovers a campaign that Telnyx created before a
  local save failed. Deterministic drift becomes a support case.
- Brand found only in another Telnyx account: this version does not take or
  transfer it. Stop and handle it through SimplAssist Support and Telnyx.

## Payment recovery

If payment succeeds but launch stops before link consumption, the synchronized
active/trialing subscription and paid setup fee remain the source of truth.
The registration attempt is marked failed and can be retried after the admin
fix; retry does not open a second checkout or charge the setup fee again. No
automatic refund is performed.

## Functional protection test for the old resources

Run this before the new demo number or QR code is public, first as a baseline
and again after the new onboarding completes:

1. Call the old SimplAssist number and confirm the existing call flow still
   routes correctly.
2. Send an inbound text to the old number and confirm the old webhook and
   conversation flow receive it.
3. Send an outbound reply and confirm delivery through the old messaging
   profile.
4. In Telnyx, confirm the old number is still assigned to the old active
   campaign and old messaging profile. Check Telnyx debugging logs for the
   successful inbound and outbound events.
5. Repeat steps 1-4 after the new campaign and number exist. Compare behavior,
   not only resource IDs.
6. Test the new number end to end: missed call, automatic text, AI reply, FAQ
   answer, lead/booking behavior, and the intended website link.

Do not publish the card's QR code until both the old-resource regression test
and the new-number end-to-end test pass.

## Nonblocking platform follow-up

The existing registration-attempt recovery treats a `submitting` attempt as
stale after 15 minutes. That is not a fully fenced distributed lease: an old
process resuming after a rare stale takeover could theoretically overlap the
new attempt. Current request/provider timeouts make that overlap unlikely and
this feature adds exact link/campaign recovery guards, but the general launch
claim should be hardened before provisioning moves to long-running background
jobs or substantially higher concurrency.
