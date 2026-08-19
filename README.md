SimplAssist is a [Next.js](https://nextjs.org) application deployed on Railway.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Railway Environment

Phase 8 A2P screening uses these deployment variables:

- `FIRECRAWL_API_KEY` - optional website scanner key. If missing or unavailable, the app falls back to a safe direct website fetch.
- `A2P_REVIEW_EMAIL` - comma-separated support recipients for manual A2P review alerts. Falls back to `SUPPORT_EMAIL`, then `support@simplassist.com`.
- `A2P_REVIEW_ADMIN_TOKEN` - bearer token required for the manual A2P review override endpoint.

Phase 9 billing/admin and Phase 3 calendar/operations use these deployment variables:

- `NEXT_PUBLIC_APP_URL` - canonical public HTTP(S) origin for SimplAssist. Production Stripe redirects, Telnyx webhooks, Google OAuth, branding, and public URLs must all resolve to this exact origin.
- `STRIPE_SECRET_KEY` - Stripe test-mode secret key only (`sk_test_...`). Live-mode keys are intentionally rejected until SimplAssist explicitly switches billing live.
- `STRIPE_WEBHOOK_SECRET` - Stripe test-mode webhook signing secret for `/api/stripe/webhook`.
- `STRIPE_PRICE_SMS_ONLY` - Stripe test-mode recurring Price ID for Starter / SMS Only.
- `STRIPE_PRICE_SMS_AND_CHAT` - Stripe test-mode recurring Price ID for Growth / SMS + Web Chat.
- `STRIPE_PRICE_FULL` - Stripe test-mode recurring Price ID for Pro / Full Suite.
- `STRIPE_PRICE_CHAT_ONLY` - server-only Stripe recurring Price ID for Chat Only. Before enabling direct acquisition, verify in the same Stripe account and mode that it is an active, non-metered USD Price for exactly $10 every month. It must be distinct from every SMS base, setup-fee, and overage Price. Once a Chat Only subscription exists, keep this value configured even when direct acquisition is disabled so signed webhook events can continue to resolve the historical plan.
- `STRIPE_PRICE_SETUP_FEE` - Stripe test-mode one-time Price ID for the $25 setup and SMS activation fee.
- `STRIPE_PRICE_SMS_OVERAGE_PART` - Stripe test-mode Price ID for $0.03 per extra SMS part after opt-in.
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` - server-only ID of the reviewed Stripe Billing Portal configuration (`bpc_...`) for this Stripe account and mode. Portal session creation fails closed when this pin is missing or malformed; never expose it through a `NEXT_PUBLIC_` variable.
- `CHAT_ONLY_DIRECT_SALES_ENABLED` - server-only, exact-`1` rollout switch reserved for new direct chat-only sales. Leave unset or `0` until the chat-only implementation and launch gates are complete.
- `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED` - independent server-only, exact-`1` rollout switch reserved for new partner-admin chat-only assignments. Leave unset or `0` until partner acceptance testing is complete.
- `WIDGET_TOKEN_SECRET` - server-only secret used to sign short-lived public widget sessions and derive opaque traffic keys. Use at least 32 cryptographically random bytes, keep it identical across all application instances, and never expose it through a `NEXT_PUBLIC_` variable. Rotation immediately invalidates existing five-minute widget sessions and changes the traffic-key namespace, effectively starting new rate buckets; rotate deliberately across every instance at once.
- `GOOGLE_CLIENT_ID` - server-side Google OAuth client ID for Calendar access.
- `GOOGLE_CLIENT_SECRET` - server-only Google OAuth client secret. Never expose it through a `NEXT_PUBLIC_` variable.
- `GOOGLE_REDIRECT_URI` - exact canonical callback URL: the origin from `NEXT_PUBLIC_APP_URL` followed by `/api/google/callback`. A different origin, path, query, fragment, or embedded credential fails closed.
- `CRON_SECRET` - server-only bearer secret for `POST /api/account/cleanup`. It must exactly match the `Authorization: Bearer <CRON_SECRET>` header held by the single cron-job.org scheduler; do not reuse the metrics-report scheduler secret.
- `CALENDAR_BOOKING_MIN_LEAD_MINUTES` - optional integer lead time for AI-created calendar bookings. Unset or empty defaults to `60`; valid range is `0` through `43200`. An explicitly malformed or out-of-range value makes calendar availability and booking fail closed.
- `CALENDAR_BOOKING_MAX_HORIZON_DAYS` - optional integer maximum future booking horizon. Unset or empty defaults to `90`; valid range is `1` through `365`. An explicitly malformed or out-of-range value makes calendar availability and booking fail closed.
- `SIMPLASSIST_ADMIN_USER_IDS` - comma-separated Supabase auth user IDs allowed into `/admin`; unset or empty means nobody is admin. Entries must be dedicated admin-only auth users — never a login that owns a customer business, because permanent account cleanup deletes the owning auth user (and would take the admin login with it). Decoupled 2026-07-24.

Both chat-only switches fail closed for every value except the exact string `1`.
They remain separate because direct Stripe sales and externally invoiced partner
assignments have independent release schedules. See
[`docs/chat-only-phase0-safety-baseline.md`](docs/chat-only-phase0-safety-baseline.md)
for the pre-implementation inventory and regression gate.

The switches gate new acquisition and partner assignment only. They do not
turn off the metering, widget-security, or calendar-lifecycle code used by
existing plans, so migrations 060-063 and their existing-plan regression gates
must be treated as production changes even while both switches remain `0`.

Before setting either switch to `1`, configure managed edge/WAF rate limiting
for `/api/widget/config`, `/api/widget/chat`, `/api/widget/end`, and
`/api/widget/lead`. The application has business-independent shared ingress
limits, but distributed source-IP rotation still requires an edge control and
is a mandatory hosted launch gate.

The local Phase 2 direct purchase and no-SMS onboarding contract is documented
in [`docs/chat-only-phase2-direct-flow.md`](docs/chat-only-phase2-direct-flow.md).
Keep both acquisition switches off until the authoritative 200-reply meter,
widget abuse controls, and launch acceptance checks are complete.

The Phase 3 metering, widget security, calendar safety, offline-lead, and
deployment contract is documented in
[`docs/chat-only-phase3-metering-and-widget-security.md`](docs/chat-only-phase3-metering-and-widget-security.md).
The authenticated Railway account-cleanup heartbeat, including calendar
provider reconciliation and its exact cron-job.org configuration, is documented
in [`docs/account-cleanup-scheduler-operations.md`](docs/account-cleanup-scheduler-operations.md).

The Full Suite waitlist uses these server-only deployment variables:

- `RESEND_API_KEY` - Resend API key used for waitlist confirmation emails.
- `RESEND_FROM_EMAIL` - optional from-address override. Defaults to `SimplAssist <notifications@simplassist.com>`.
- `WAITLIST_UNSUBSCRIBE_SECRET` - secret used to sign waitlist unsubscribe links. Set this to at least 32 cryptographically random bytes and never expose it through a `NEXT_PUBLIC_` variable.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to optimize and load the Geist font locally.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Railway operations

Railway is the application host. Database migrations are applied separately to
Supabase and must precede any Railway application version that calls their new
RPCs or reads their new columns. Migration 063 is not safe as an ordinary
rolling change: block and drain old calendar create/update/delete, AI booking,
OAuth-completion, refresh, and disconnect traffic; run the documented
preflights; apply migrations through 063; deploy the compatible application and
reconciler; then reopen calendar traffic only after verification.

Railway does not schedule account cleanup. Keep exactly one external
cron-job.org job for `POST https://simplassist.com/api/account/cleanup`, with
the matching `CRON_SECRET`; do not add a Railway cron service or a duplicate
scheduler. Hosted migration, environment, WAF/CDN, scheduler, Stripe, Telnyx,
deployment, flag, and traffic-drain actions require a separately approved
release step.
