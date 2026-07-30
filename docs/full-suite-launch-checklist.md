# Full Suite launch checklist

Complete these actions in order on launch day. Do not skip ahead: the sales
unlock, Stripe portal change, and waitlist send are intentionally separate
controls.

1. Confirm every advertised Full Suite feature and the final launch-email copy
   are approved.
2. Send the launch email to the admin only. Review the subject, body, CTA,
   mobile and desktop rendering, and unsubscribe behavior. Do not continue
   until the test is approved.
3. In `src/lib/billing/planAvailability.ts`, change the central Full Suite
   sales status from `coming_soon` to `available`.
4. Verify the central status change removes the Full Suite guard in all three
   code consumers:
   - Onboarding restores the selectable Full Suite radio.
   - Dashboard Billing restores the Full Suite **Subscribe** action.
   - The checkout API stops returning `full_suite_coming_soon`.
5. Verify the homepage Full Suite **Coming Soon** badge and waitlist CTA are
   gone and the purchase CTA is restored.
6. Run the automated checks and deploy the code unlock.
7. In Stripe Dashboard, re-enable Full Suite in the customer-portal product
   configuration. Do not change the existing Full Suite product or price.
8. In Stripe test mode, smoke-test:
   - Homepage to signup to onboarding Full Suite selection.
   - Dashboard Billing Full Suite purchase.
   - Direct checkout protection.
   - Customer-portal plan switching.
9. Open `/admin/waitlist`, refresh the pending count, send one final admin
   test, and review it.
10. Choose **Send to all pending**, verify the displayed recipient count, type
    `SEND`, and submit.
11. Verify the sent, failed, and review-needed totals. Confirm that only
    successful recipients received `notified_at`, and inspect every ambiguous
    send before retrying.
12. Preserve unsubscribed rows and never include them in a retry.
