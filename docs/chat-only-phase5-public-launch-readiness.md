# Chat Only Phase 5 public-launch readiness

Local implementation and acceptance contract for preparing the direct $10
Chat Only tier for a later controlled public launch.

Date: 2026-08-19

## Phase boundary

Phase 5 prepares customer-facing direct-sales presentation. It does not launch
Chat Only, enable an acquisition switch, create a Checkout Session, charge a
card, deploy, or change any hosted system.

Throughout Phase 5:

- `CHAT_ONLY_DIRECT_SALES_ENABLED` remains unset or `0`;
- `CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID` remains unset;
- `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED` remains unset or `0`; and
- the live Chat Only Price stays configured for historical resolution and the
  later owner-led acceptance test.

The broad direct flag and valid Chat Only Price configuration must both be
ready before public Chat Only sales presentation appears. The exact-business
canary is private acquisition authority only and must never reveal a public
card, FAQ answer, metadata description, structured-data Offer, or CTA.

## Customer-facing contract

When broad public launch is not ready, every public surface keeps its existing
three-plan output and makes no Chat Only sales claim. When broad public launch
is ready, every canonical representation must agree on:

- **Chat Only — $10/month**;
- 200 completed web-chat AI replies per billing period;
- website chat, lead capture, the contact/conversation inbox, AI
  customization, Google Calendar, and AI appointment scheduling; and
- no phone number, A2P registration, SMS, MMS, Telnyx activation, or setup
  fee.

Growth remains the recommended “Most Popular” plan. Starter, Growth, and Full
retain their current prices, features, setup-fee rules, sales status, and CTA
behavior. The Chat Only CTA enters the existing `/signup` and direct onboarding
flow; public presentation never grants an entitlement and never bypasses the
server-side business, Price, family-lock, or Checkout checks.

The canonical homepage, noncanonical `/home-v2` preview, FAQ copy, metadata,
and structured data must derive visibility from the same server-only public
launch decision. Missing, malformed, truthy-looking, or canary-only
configuration fails closed.

## Phase 5 non-goals

Phase 5 does not include:

- a Railway deployment or environment-variable change;
- a Stripe, Supabase, Cloudflare, scheduler, Google, Anthropic, or Telnyx
  mutation;
- a live or test Checkout, payment, subscription, refund, or customer account;
- partner-admin Chat Only exposure, partner-client Chat Only creation, external
  invoice activation, or `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED=1`;
- Chat Only-to-SMS or SMS-to-Chat Only upgrades or downgrades, family-lock
  rewriting, Telnyx provisioning, or Telnyx release;
- changes to the reply meter, widget security, Google Calendar lifecycle, SMS
  allowances, existing plan entitlements, Full Suite roadmap features, or SMS
  overage collection; or
- treating a successful local build as permission to launch.

Partner-managed Chat Only and cross-family transitions remain independent,
default-off future projects. Existing partner-managed Starter, Growth, and Full
accounts continue through their established paths unchanged.

## Acceptance gates

Phase 5 is complete only when:

1. Broad-off, canary-only, missing-Price, malformed-Price, collision, and
   broad-on/valid-Price cases have explicit tests.
2. Broad-off and canary-only output contains no public Chat Only sales copy.
3. Broad-on/valid-Price output contains one consistent Chat Only offer and
   correct no-SMS/no-setup-fee language on every prepared public surface.
4. Existing plan cards retain their order, wording, pricing, availability, and
   Growth recommendation in the off state and alongside Chat Only in the on
   state.
5. Crafted onboarding and Checkout requests remain subject to the existing
   server gates, owner/business resolution, Price validation, subscription
   rules, and durable family lock.
6. Existing Starter, Growth, Full, partner billing, SMS, Telnyx fences,
   branding, widget, Google OAuth/Calendar, webhook, onboarding, Billing, and
   cleanup regression suites remain green.
7. Focused tests, full Vitest and local database suites, TypeScript, ESLint,
   the optimized production build, and `git diff --check` pass.
8. An independent review finds no public leak, acquisition bypass, or
   existing-plan regression.

## Phases 6 and 7

### Phase 6 — deploy and rehearse with acquisition off

Under a separately approved hosted window, deploy the Phase 5-compatible code
while both broad Chat Only switches remain off and the exact canary remains
unset. Rerun the sanitized readiness audit, verify health and public off-state
output, exercise only approved non-mutating probes, confirm monitoring and
rollback instructions, and prove existing billing, widget, SMS/Telnyx fences,
and Google Calendar service remain healthy.

Phase 6 creates no Chat Only Checkout and no charge. A green Phase 6 rehearsal
is not a launch.

#### Public widget edge-origin boundary

Every **public** widget API call must traverse the canonical
`https://simplassist.com` Cloudflare edge before Railway. Partner-branded embed
scripts remain available from their connected partner origin, but the script's
public config, chat, end, lead, and telemetry calls use the canonical API
origin. The
authenticated dashboard preview remains same-origin on its application host
and continues through the existing workspace authorization path.

The five public API paths are:

- `/api/widget/config`;
- `/api/widget/chat`;
- `/api/widget/end`;
- `/api/widget/lead`; and
- `/api/widget/telemetry`.

The original Phase 6 boundary covered the first four paths. For the migration
065–066 extension, stage the telemetry path in both Cloudflare rules before the
compatible application deploy, re-prove the existing four paths at that stage,
and prove telemetry canonical success plus direct-origin rejection only after
the new endpoint is deployed. Follow the exact sequence in
`docs/proactive-widget-rollout.md`.

Cloudflare must have one Request Header Transform Rule for those exact paths.
The rule must **set/overwrite**, not merely preserve, the private edge-origin
header `x-simplassist-widget-edge-origin` with a separately generated
high-entropy value. Railway stores the same value only as the server-side
`WIDGET_EDGE_ORIGIN_SECRET`; it must contain
43–128 base64url-safe characters derived from at least 32 random bytes (64
lowercase hexadecimal characters is valid), differ from `WIDGET_TOKEN_SECRET`,
have no `NEXT_PUBLIC_` copy, and never appear in source, screenshots, command
output, logs, or retained evidence. Cloudflare documents that a static request-header transform overrides
an incoming header of the same name:
<https://developers.cloudflare.com/rules/transform/request-header-modification/create-dashboard/>.

Roll out this boundary in two application deployments so a stale or already
loaded partner embed cannot be stranded when enforcement begins:

1. deploy only the compatible embed-routing change, which sends public API
   calls to the canonical origin while the API routes still accept the former
   partner-origin path;
2. verify the connected-partner CSP permits `https://simplassist.com`,
   purge/revalidate the canonical and partner `widget/embed.js` URLs, wait out
   the prior cache window, verify newly loaded partner embeds use the canonical
   API origin, and choose a maintenance window with no relied-upon old in-memory
   widget session;
3. stage the new Railway secret without deploying;
4. create and enable the exact Cloudflare header-transform rule while the
   compatibility deployment still ignores that header;
5. deploy the route-enforcement change with both Chat acquisition flags still
   exact `0` and the canary absent;
6. verify public widget config through the apex returns its normal successful
   response, including `Cache-Control: no-store` and `Vary: Origin`;
7. verify an unauthenticated public/live call through the Railway-generated
   hostname and a direct connection to a Railway custom-domain CNAME target is
   rejected before widget/database/provider work, even when ordinary browser
   headers are forged; authenticated preview remains the separate bounded
   ingress, workspace-authenticated path; and
8. verify a partner-branded public embed still loads while its API requests go
   to the canonical Cloudflare-protected origin, then verify authenticated
   dashboard preview still works on the partner host.

The existing coarse Cloudflare IP burst rule remains a separate layer and must
stay enabled for all five exact paths. The private edge proof does not replace
the persisted customer-site hostname allowlist, signed widget session token,
per-network/session/business limits, reply allowance, or concurrency controls.
It only proves that a public request passed through the reviewed edge rather
than calling Railway around it.

Customer sites that enforce Content Security Policy must allow the origin that
serves their branded embed script in `script-src` and must allow
`https://simplassist.com` in `connect-src`. Before deploying this routing
change, inspect the active connected-partner sites for a restrictive CSP or
perform an equivalent owner-approved embed rehearsal; a site that permits only
the previous partner API origin must be updated before the canonical API change
is deployed.

Do not attest `--waf-verified true` from a Cloudflare rule screenshot alone.
Retained evidence must cover the transform rule, the rate rule, a successful
canonical public request, both direct-origin rejection shapes, the canonical
API destination used by the partner embed, and the previously reviewed
privacy-safe two-network rate-key proof. If any legitimate public embed still
calls a non-Cloudflare API origin, or either direct-origin request succeeds,
the WAF evidence remains false.

Before attesting to homepage cache safety, retain separately reviewed HTTP and
body evidence for both `https://simplassist.com/` and
`https://www.simplassist.com/`. Each response must:

- return HTTP `200`;
- include `private`, `no-store`, and `max-age=0` in `Cache-Control`;
- return `CF-Cache-Status: DYNAMIC`;
- have no `Age` header or an `Age` value of exactly `0` (any positive value is
  a failure); and
- in this flags-off state, contain no `Chat Only` card or copy, no `Chat Only`
  reference in the title, description, Open Graph, or Twitter metadata, and no
  JSON-LD Offer named `Chat Only`.

If either hostname fails these checks, stop the rehearsal. Add a narrowly
scoped Cloudflare rule for the homepage only if the failed header evidence
proves one is needed and a separate hosted-change approval is granted; do not
add a speculative rule when the responses already satisfy this contract.

After the separately reviewed blocker inventories, managed widget edge/WAF
controls, cleanup scheduler, and homepage cache evidence have each been
verified, run the read-only flags-off gate against the explicitly named
production target:

```bash
npm run audit:chat-only-phase5 -- \
  --launch-state off \
  --stripe-mode live \
  --supabase-project-ref inmgpkurctttsofpywuz \
  --blocker-inventories-clear true \
  --waf-verified true \
  --scheduler-verified true \
  --homepage-cache-verified true
```

The four `true` values are operator attestations backed by separately retained
evidence; the script does not discover those external facts or authorize their
mutation. In particular, `--homepage-cache-verified true` attests to both
hostnames and every header, body, metadata, and JSON-LD check above.

### Phase 7 — owner-led live acceptance and controlled direct launch

Use a new direct, unpartnered account and business. The existing Growth account
is SMS-family authority and is not a Chat Only test target. With the broad flag
still off, authorize only the new business through the exact server-only canary
and run the Phase 4 required-canary gate while that canary is set:

```bash
npm run audit:chat-only-phase4 -- \
  --stripe-mode live \
  --supabase-project-ref inmgpkurctttsofpywuz \
  --chat-price-state required \
  --widget-secret-state required \
  --canary-state required
```

This Phase 4 command is the applicable canary gate while the exact canary is
configured. The Phase 5 `--launch-state ready` audit is invalid at that point
because it requires the canary to be absent. Only after the required-canary
audit passes does the owner open Checkout and enter payment details for the
real live $10 monthly subscription.

Phase 7 verifies signed webhook synchronization, atomic onboarding completion,
dashboard access, widget installation on an approved host, a small number of
metered AI replies, lead fallback and inbox behavior, Billing usage, Google
OAuth, and one reviewed Calendar booking lifecycle. It must also prove that no
SMS, phone-number, A2P, or Telnyx work occurred.

After a clean result, remove the exact canary. The paid account keeps its
entitlement even when acquisition authority is removed. The owner decides
whether the founding subscription remains active; no cancellation or refund is
implied. Only then may a separately approved monitored window set
`CHAT_ONLY_DIRECT_SALES_ENABLED=1` and publish the prepared direct-sales
presentation.

After removing the exact canary and before opening broad sales, repeat and
retain the exact apex-and-`www` flags-off homepage evidence required in Phase
6, then run:

```bash
npm run audit:chat-only-phase5 -- \
  --launch-state ready \
  --stripe-mode live \
  --supabase-project-ref inmgpkurctttsofpywuz \
  --blocker-inventories-clear true \
  --waf-verified true \
  --scheduler-verified true \
  --homepage-cache-verified true
```

The `ready` state is valid only after the canary has been removed. It requires
Stripe live mode, the partner flag at exact `0`, no canary, no unresolved Chat
Checkout or attempt, and all four external attestations.

During the separately approved monitored window, set the broad direct flag to
exact `1` and collect new evidence from both `https://simplassist.com/` and
`https://www.simplassist.com/`. Each `/` response must still be HTTP `200`,
include `private`, `no-store`, and `max-age=0` in `Cache-Control`, return
`CF-Cache-Status: DYNAMIC`, and have no `Age` header or an `Age` of exactly
`0`. The on-state body must now show the Chat Only card and approved copy,
publish the Chat Only title, description, Open Graph, and Twitter launch
metadata, and contain exactly one Chat Only JSON-LD Offer at `$10` per month
with no setup- or activation-fee specification. Rerun the full
`--launch-state ready` command above only after this evidence supports
`--homepage-cache-verified true`.

Any failed homepage check or blocked or incomplete audit closes the window:
return the broad direct flag to exact `0`, then immediately verify on both
hostnames that `/` returns HTTP `200`, has the same non-caching headers,
`CF-Cache-Status: DYNAMIC`, no positive `Age`, and the complete off state (no
`Chat Only` card or copy, no `Chat Only` title, description, Open Graph, or
Twitter metadata, and no JSON-LD Offer named `Chat Only`). As in Phase 6, add a
narrowly scoped Cloudflare homepage rule only when failed header evidence
proves it is needed and the change receives separate approval.

`CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED` remains off, and cross-family changes
remain blocked. Any defect found during the owner-led test keeps Phase 7 open
until it is fixed and reverified. Phase 7—not the code merge alone—is the
planned completion boundary for the initial direct Chat Only tier.
