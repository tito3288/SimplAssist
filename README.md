This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

Phase 9 billing and admin use these deployment variables:

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
- `SIMPLASSIST_ADMIN_USER_IDS` - comma-separated Supabase auth user IDs allowed into `/admin`; unset or empty means nobody is admin. Entries must be dedicated admin-only auth users — never a login that owns a customer business, because permanent account cleanup deletes the owning auth user (and would take the admin login with it). Decoupled 2026-07-24.

Both chat-only switches fail closed for every value except the exact string `1`.
They remain separate because direct Stripe sales and externally invoiced partner
assignments have independent release schedules. See
[`docs/chat-only-phase0-safety-baseline.md`](docs/chat-only-phase0-safety-baseline.md)
for the pre-implementation inventory and regression gate.

The local Phase 2 direct purchase and no-SMS onboarding contract is documented
in [`docs/chat-only-phase2-direct-flow.md`](docs/chat-only-phase2-direct-flow.md).
Keep both acquisition switches off until the authoritative 200-reply meter,
widget abuse controls, and launch acceptance checks are complete.

The Full Suite waitlist uses these server-only deployment variables:

- `RESEND_API_KEY` - Resend API key used for waitlist confirmation emails.
- `RESEND_FROM_EMAIL` - optional from-address override. Defaults to `SimplAssist <notifications@simplassist.com>`.
- `WAITLIST_UNSUBSCRIBE_SECRET` - secret used to sign waitlist unsubscribe links. Set this to at least 32 cryptographically random bytes and never expose it through a `NEXT_PUBLIC_` variable.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
