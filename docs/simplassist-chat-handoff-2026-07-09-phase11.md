# SimplAssist Chat Handoff - 2026-07-09 Phase 11

## Current Status

Phase 11 Option B is shipped on `main`:

- `08a5d7a` - `Add Phase 11 EIN-only onboarding hold`

This is the EIN-only launch path. Sole Proprietor registration and SMS OTP are intentionally deferred to a future Option A phase.

Migration `021_phase11_ein_branching.sql` was applied to production with `npx supabase db push`.

Stripe remains intentionally in test mode. The live-key guard was not touched.

## What Shipped

- Brand Verification now asks: "Do you have an EIN?"
- EIN path continues through Standard Brand onboarding and sets:
  - `has_ein = true`
  - `a2p_brand_tier = 'low_volume_standard'`
- No-EIN path shows the roadmap IRS encouragement copy and link:
  - `https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number`
- No-EIN users can create accounts and join the waitlist, but cannot pay or launch SMS registration.
- No Sole Proprietor/OTP code shipped.
- No last-4 SSN or registrant mobile collection shipped.

Migration `021` added:

- `businesses.has_ein`
- `businesses.a2p_brand_tier`
- `businesses.no_ein_hold_status`
- `businesses.no_ein_waitlist_requested_at`

Production dry-run before apply showed only:

```text
021_phase11_ein_branching.sql
```

Production apply output:

```text
Applying migration 021_phase11_ein_branching.sql...
NOTICE (00000): constraint "businesses_a2p_brand_tier_check" of relation "businesses" does not exist, skipping
NOTICE (00000): constraint "businesses_no_ein_hold_status_check" of relation "businesses" does not exist, skipping
Finished supabase db push.
```

## Fail-Closed Gates

Checkout is blocked in `src/app/api/billing/checkout/route.ts` unless `has_ein === true`.

This runs after the business ownership lookup and before:

- satisfied-billing retry logic,
- `attemptPaidLaunch`,
- Stripe Checkout session creation.

`attemptPaidLaunch()` is blocked in `src/lib/billing/launch.ts` unless `has_ein === true`.

This runs after `readLaunchBusiness()` and before:

- `telnyx_submission_disabled`,
- billing readiness,
- Phase 8 risk clearance,
- Phase 7 registration-attempt claim,
- `registerBrand()`,
- `registerCampaign()`,
- messaging profile creation,
- voice application creation,
- number purchase/attach,
- campaign assignment.

Important invariant: `has_ein = null` and `has_ein = false` are both blocked.

## Hold Reason

Dedicated hold reason:

- `held_no_ein`

Behavior:

- non-retryable,
- does not fall into transient registration failure handling,
- shows "Add your EIN" CTA,
- returns the customer to Brand Verification.

The carrier-review retry UI also suppresses retry when `holdReason === 'held_no_ein'`.

## Waitlist Behavior

No-EIN waitlist is intentionally DB-only in this phase.

- `no_ein_hold_status = 'waitlisted'`
- `no_ein_waitlist_requested_at` stores the customer action time.
- On-screen confirmation only.
- No customer email.
- No admin email.
- No admin UI.

Production verification query for `Test no EIN July`:

```json
{
  "rows": [
    {
      "has_ein": false,
      "name": "Test no EIN July",
      "no_ein_hold_status": "waitlisted",
      "no_ein_waitlist_requested_at": "2026-07-09 14:55:43.817+00"
    }
  ]
}
```

## Test Results

Local verification before commit:

- `npm run lint` passed.
- `npm run build` passed.
- `git diff --check` passed.

Production verification:

- Migration `021` applied successfully.
- `select name, has_ein, a2p_brand_tier from businesses;` returned:

```json
[
  {
    "a2p_brand_tier": null,
    "has_ein": true,
    "name": "Engivations"
  },
  {
    "a2p_brand_tier": null,
    "has_ein": true,
    "name": "Bryan Develops"
  },
  {
    "a2p_brand_tier": "low_volume_standard",
    "has_ein": true,
    "name": "Alpha Dog Agency"
  }
]
```

- No-EIN production fixture `Test no EIN July` reached `waitlisted` with `has_ein = false`.
- No real Telnyx submissions were run for Phase 11 dev.

## Current Fixture States

Engivations:

- Paid-but-disabled billing fixture.
- `has_ein = true`.
- `a2p_brand_tier = null`.
- `telnyx_submission_disabled = true`.
- Keep as zero-Telnyx safety fixture.

Bryan Develops:

- Never-submit fake-EIN/internal fixture.
- `has_ein = true`.
- `a2p_brand_tier = null`.
- `telnyx_submission_disabled = true`.
- Keep disabled.

Alpha Dog Agency:

- Existing pilot/billing-exempt account with Telnyx brand history.
- `has_ein = true`.
- `a2p_brand_tier = 'low_volume_standard'`.
- Still needs the separate replacement-campaign recovery documented in the roadmap.

Test no EIN July:

- Phase 11 No-EIN production fixture.
- `has_ein = false`.
- `no_ein_hold_status = 'waitlisted'`.
- `no_ein_waitlist_requested_at = '2026-07-09 14:55:43.817+00'`.
- Should remain blocked from checkout and paid launch until an EIN is added.

## Deferred Sole Proprietor Scope

Do not treat Phase 11 Option B as Sole Proprietor support. Deferred to future Option A:

- Sole Prop brand registration payload.
- Telnyx `smsOtp`, `smsOtp/verify`, and OTP status handling.
- Inline OTP onboarding step.
- Customer-initiated resend only.
- Incorrect vs expired vs network error handling.
- 3-5 retry limit before forcing a re-trigger.
- Last-4 SSN and registrant mobile collection.
- VoIP mobile validation at form submit.
- Sole Prop rejection handling.
- 1-number / 1-campaign / throughput enforcement.
- Mock-brand OTP testing after Telnyx support confirms mock behavior.

## Operational Notes

- Migration `021` is already applied to production.
- Do not rerun real Telnyx brand/campaign submissions for fixtures.
- Keep Stripe in test mode until the Pre-Launch Checklist live-mode switch is deliberately completed.
- Public/admin projections must continue to exclude `ein`, `last_4_ssn`, `registrant_mobile`, and `authorized_rep_*`.
