# Chat Only Phase 4 production-live direct canary readiness

Execution and release record for hardening one isolated direct Chat Only
canary path before any broad sale or partner assignment.

Date: 2026-08-19

## Phase boundary

Phase 4 prepared the direct $10 Chat Only acquisition path for one explicitly
named business. It was divided into separately authorized local and hosted
parts:

- **Phase 4A** is local implementation, testing, read-only release tooling, and
  documentation. It made no hosted change and never accessed live Stripe.
- **Phase 4B** defined a separately approved production release window. Its
  stages are approval boundaries, not actions authorized merely by this
  document.

The owner selected the production-live topology on 2026-08-19: keep the
production Railway service on the production Supabase project and its existing
Stripe **live mode**. Never replace the production live key, live Price IDs, or
live webhook secret with test-mode values, even temporarily. A Railway staging
or local application must never point at the production database for this
acceptance test.

## Execution status — 2026-08-19

Phase 4A and the approved hosted preparation/deployment work through Phase 4B
Stage C are complete. The compatible application and migrations are deployed,
the live $10 Price and required server configuration are present, the readiness
and post-migration reports pass, and both broad Chat Only acquisition switches
remain off.

No Phase 4 paid canary ran. No canary business was named, no Chat Only Checkout
Session or subscription was created, and no $10 card charge occurred. Before
Stage D, the owner intentionally moved the owner-led new-account live payment
and product acceptance to Phase 7. Phase 5 prepares public presentation locally
with flags off; Phase 6 deploys and rehearses it with flags off; Phase 7 owns
the real payment, product verification, and any later monitored broad-direct
activation. See
[`chat-only-phase5-public-launch-readiness.md`](chat-only-phase5-public-launch-readiness.md).

The original Stage D/E controls remain below as historical safety requirements,
but they were not executed in Phase 4 and do not override the Phase 5–7
contract.

`CHAT_ONLY_DIRECT_SALES_ENABLED` and
`CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED` remain unset or `0` throughout Phase 4A.
Both broad switches remained off through the completed Phase 4 hosted work,
and the server-only canary value remained unset. The later Phase 7 exact-account
window keeps the broad switch off while only its named business may enter the
new direct flow.

Phase 4A did not advertise Chat Only, open public sales, enable partner
assignment, apply a hosted migration, create a hosted Stripe object, change a
Railway variable, deploy, edit an edge or scheduler configuration, call a
provider, or mutate a customer account. The original Phase 4B plan permitted
only the exact production reads and mutations separately approved in Stages
A-E below; actual execution stopped after Stage C. It did not authorize a
public launch.

## Phase 4A local objectives

### Exact single-business canary authority

Add one server-only configuration value for the exact disposable business, for
example `CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID`. The implementation name may
differ, but its authority must satisfy this contract:

- It accepts exactly one canonical business UUID. Unset, empty, malformed,
  whitespace-padded, or multi-value input is disabled. There is no wildcard,
  list, partner, hostname, email, or caller-supplied override.
- It is read only on the server and is never included in a `NEXT_PUBLIC_`
  variable, browser payload, log, or public availability decision.
- A canary match is not an entitlement. The business must still be an active,
  direct, unpartnered Stripe workspace owned by the authenticated caller, and
  every content, operational, Price, Checkout, webhook, and paid-finalization
  check still applies.
- One canonical resolver owns the business-scoped decision. Onboarding state,
  direct plan-intent persistence, direct Checkout, and the SMS/Telnyx
  pre-checkout reducer must use that decision consistently. A client component
  is never authoritative.
- Public pricing, metadata, signup marketing, and partner-admin pages consult
  only their existing broad availability policies. They must not reveal the
  canary merely because one business is authorized.
- The broad direct flag may authorize eligible direct businesses in a later
  release. During any exact-account acceptance window it stays off, so a wrong
  business ID must observe the exact same unavailable state as when no canary
  exists.
- The partner flag stays independent and off. A partner-owned, invoiced,
  comped, or partner-linked business cannot use the direct canary path even if
  its UUID is configured by mistake.
- Removing the canary value immediately stops new Chat Only plan selection and
  new Checkout attempts for an unpaid business. It does not revoke a paid
  account, suppress a signed Stripe webhook, block exact in-flight completion,
  or prevent finalization and recovery of already-created durable work.

The preflight report may identify the configured canary only through a stable
sanitized reference. It must never print the raw business UUID or any owner or
customer identity.

### Durable family-lock rollback

The service-owned `business_plan_family_locks` row remains authoritative even
when the canary value, broad rollout flag, or Chat Only Price configuration is
removed. Onboarding must read and project that lock independently from current
acquisition availability.

A rollback must never make a Chat-locked business look like a fresh SMS
workspace. It must not expose number search, number purchase, carrier
registration, SMS launch, or Telnyx work. It must show an honest Chat Only
paused/recovery state with a support path when the same-family acquisition
cannot currently continue. Operators must not delete or rewrite the family
lock merely to make the wizard advance.

The same safety applies to a durable Chat Only plan intent written through the
authorized canary. While that intent remains selected, crafted SMS
pre-checkout requests fail closed even if the broad flag is off. An explicit,
reviewed change before any family claim may replace advisory intent; it must
not be confused with permission to rewrite an existing family lock.

The required rollback matrix is:

| Durable state | Canary/Price available | Canary or Price unavailable |
| --- | --- | --- |
| No Chat intent, no family lock, no subscription | Existing legacy SMS onboarding is unchanged | Existing legacy SMS onboarding is unchanged |
| Chat intent, no family lock, no subscription | The exact canary may continue toward Chat Checkout; SMS/Telnyx entry is denied | Show Chat acquisition paused or an explicit reviewed plan-change path; deny new Chat Checkout and crafted SMS/Telnyx entry |
| Chat family lock claimed, Stripe Customer or Session creation failed | An exact same-family retry may recover through the Checkout single-flight contract | Show Chat acquisition paused and support guidance; deny SMS/Telnyx and preserve the lock |
| Chat family lock with an open, expired, or canceled Checkout Session and no subscription | Reuse a valid live attempt or create one reviewed next generation after the prior attempt is terminal | Do not create a new Session; show paused/recovery guidance, deny SMS/Telnyx, and preserve the lock |
| Checkout completed but webhook synchronization or onboarding finalization is pending | Recover the exact paid work without another charge | Continue signed webhook processing and exact finalization despite acquisition rollback; never open a second Session |
| Active or trialing Chat Only subscription | Complete or resume onboarding and serve paid Chat entitlements | Preserve paid service and recovery; acquisition switches are not entitlement switches |
| Previously completed past-due Chat Only subscription | Preserve the existing frozen-period grace and Billing Portal recovery behavior | Preserve the same behavior; do not create a virtual allowance renewal or a second subscription |
| Canceled or normalized unpaid Chat Only subscription with a retained Chat family lock | Keep acquisition paused and require support; Phase 4 does not replace any prior subscription | Keep acquisition paused and SMS-family transition denied |

Removing or invalidating the Price before a family claim must create no Stripe
Customer, Checkout Session, subscription, family lock, or Telnyx work. A
failure after the family claim follows the locked rows in the matrix and is
support-reviewable rather than silently reversed.

### Checkout single-flight contract

Direct Chat Only Checkout must become retry-safe before a real canary. The
implementation may choose its durable schema and Stripe recovery mechanism,
but it must prove these outcomes:

- The first implementation is Chat Only-specific. It does not silently change
  existing SMS-plan Customer, setup-fee, or Checkout parameters while solving
  the canary problem.
- A private service-owned attempt ledger records the attempt UUID, canonical
  request fingerprint, creating/open/terminal state, exact Stripe Session
  identity, sensitive Session URL, and explicit expiry. A database constraint
  and business-locked service RPC allow no more than one creating or open Chat
  attempt per business.
- At most one live payable Chat Only Checkout attempt exists for one business,
  plan, and onboarding purpose.
- A stable server-owned attempt identity and immutable request fingerprint
  exist before the first Stripe mutation. Reusing the identity for different
  business, plan, Price, mode, or redirect semantics fails closed.
- Customer creation and Checkout Session creation use stable Stripe idempotency
  identities derived from the durable attempt. A timeout or lost HTTP response
  is recovered from exact durable/Stripe evidence and is never treated as proof
  that the mutation did not happen.
- Phase 4 acquisition is new-business-only: any current subscription row or
  completed/subscription-bound historical Chat attempt makes automatic
  reacquisition unavailable. The first Chat attempt never supplies a Customer
  parameter; subscription-mode Checkout creates the Customer as part of the
  exact Session outcome, avoiding an abandoned pre-Session Customer.
- The Stripe Session carries the attempt UUID in its immutable metadata and
  client reference, uses an explicit expiry, and is created with an idempotency
  key derived from that attempt UUID.
- Chat acquisition is card-only in this phase. A completed Session must carry
  paid or no-payment-required evidence and exact Customer/subscription binding;
  asynchronous payment-state expansion requires a later lifecycle design.
- Concurrent clicks, browser retries, route retries, and process restarts return
  the same recoverable live attempt instead of creating orphan Customers or
  multiple payable Sessions.
- The Customer identity and Session identity are durably associated with the
  exact business before they can be reused. No metadata search may adopt an
  ambiguous or differently bound Stripe object.
- A browser return through the cancel URL does not prove the Stripe Session
  canceled; the same still-open Session is reused. An expired or otherwise
  proven-terminal Session becomes terminal in the ledger before a new attempt
  generation is allowed. A new generation remains in the already-claimed Chat
  family and cannot authorize a cross-family change.
- A creating attempt may replay its exact Stripe idempotency key for at most 23
  hours from durable creation, inside Stripe's documented minimum retention.
  Beyond that horizon it remains nonterminal and support-only; the application
  must not call Stripe, expire it by time, or allocate a second generation.
- Completion, webhook synchronization, and onboarding finalization are
  idempotent and mark the exact attempt complete. A completed Session is
  recovered without another charge even after canary or broad acquisition
  authority is removed.
- Keep `STRIPE_PRICE_CHAT_ONLY` configured after the first Session exists; the
  normal rollback control is the scoped/broad acquisition gate, not removal of
  the Price mapping. Exact attempt metadata plus the private ledger still allow
  a signed completion to recover if the setting is accidentally missing or
  malformed, but operators must treat that condition as configuration damage.
- Chat Only contains exactly one licensed recurring Price at quantity one and
  no SMS setup-fee or overage line. The Price is revalidated as active USD
  $10/month before new acquisition.
- Bounded, content-free operational facts may identify attempt state and a
  sanitized Stripe reference. Logs and evidence never contain Checkout URLs,
  secrets, customer data, or payment details.

If the single-flight implementation changes shared Stripe helpers, Starter,
Growth, Full, webhook, Billing Portal, and existing subscription behavior must
retain their established regression guarantees.

### Read-only release evidence

Phase 4A adds a Phase 4-specific read-only audit mode or command. It must not
weaken or silently reinterpret the dated Phase 0 inventory. The new evidence
path must:

- prove the explicitly supplied Stripe mode and Supabase target before reading;
- recognize all four plans and require `STRIPE_PRICE_CHAT_ONLY` for the canary
  preflight;
- retrieve the Chat Only Price with GET-only Stripe operations and verify that
  it is active, distinct from every other configured Price, USD 1000, recurring
  every one month, licensed/non-metered, and quantity one at Checkout;
- verify the pinned Billing Portal permits invoice/payment-method access but no
  customer plan switching, subscription update, or cancellation;
- require both broad Chat Only flags and Telnyx remote release to be off, and
  report the optional exact canary as a sanitized reference;
- preserve the protected Bryan/SimplAssist and Alpha Dog billing, branding, and
  Telnyx lifecycle baseline; and
- emit a deterministic sanitized before/after report in which incomplete,
  malformed, target-mismatched, or unknown state is a blocker.

The command may expose an explicit pre-Price baseline mode and a canary-ready
mode. Baseline mode permits the Chat Only Price to be absent only when it also
proves there is no Chat Only Stripe subscription or configured Chat Price to
reconcile. Canary-ready mode requires and fully validates the Price. It is not
valid to omit the Price merely to make an unknown post-configuration state
pass.

Provide transaction-read-only, version-aware SQL reports for both sides of the
deployment boundary:

- The pre-migration report covers the migration ledger, migration 056 phone
  release prerequisites, migration 059 family/setup-fee conflicts, migration
  061 active-widget hostname derivability, migration 062 active booking
  overlaps, both migration 063 legacy provider-namespace preflights, cleanup
  eligibility, and current cron state.
- The post-migration report verifies every expected object, constraint, index,
  RLS policy, grant, and function boundary through the Phase 4 migration tip,
  including every 063 invariant and any private Checkout-attempt objects; exact
  active-widget allowlists; absence of active slot conflicts and invalid
  provider namespaces; exactly the two approved database cron jobs;
  reply-reservation health; and unresolved or overdue calendar
  provider-operation backlog.

Both reports are tested only against disposable local databases during Phase
4A. Never run pgTAP fixtures against hosted data. A separate non-mutating HTTP
probe may later verify health, embed caching, widget CORS, `Cache-Control`, and
`Vary` headers; it must not submit chat, lead, OAuth, Calendar, cleanup, or
provider work.

### Public pricing stays hidden

The scoped canary is not a marketing launch. Do not add Chat Only to the public
pricing cards, structured data, SEO description, FAQ pricing copy, or alternate
public homepage in Phase 4A. Keep the catalog-level Chat Only sales status
hidden and keep Growth's existing public positioning unchanged.

Before a later broad direct launch, every canonical public representation must
be updated together to describe $10/month, 200 completed AI replies, no SMS,
and no setup fee. Its purchase CTA must follow the broad server authority, not
the canary value. That later marketing change and
`CHAT_ONLY_DIRECT_SALES_ENABLED=1` require their own review and release
approval.

## Phase 4A non-goals

Phase 4A deliberately does not include:

- partner-admin Chat Only exposure, partner-client creation, invoice workflow,
  or atomic partner activation;
- any use of `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED=1`;
- Chat Only-to-SMS or SMS-to-Chat Only upgrades or downgrades;
- Stripe event-watermark ordering for later transition workflows;
- Telnyx provisioning on upgrade, remote release on downgrade, destructive
  provider reconciliation, or a Telnyx canary;
- Full Suite analytics, alerts, reviews, summaries, follow-up, or no-show
  capabilities;
- proactive usage email/SMS, customer overage opt-in, or Stripe SMS-overage
  collection;
- broad feature-interest analytics or a public pricing launch;
- live-mode Stripe billing; or
- hosted reads, migrations, configuration, deployment, traffic changes,
  provider calls, test accounts, or cleanup.

Those are historical Phase 4A boundaries: the completed local phase did none
of them. They do not imply that the later paid acceptance uses test mode. The
owner selected the production-live topology, then intentionally moved the
owner-led payment from Phase 4 to Phase 7 before any Checkout began.

Partner Chat Only remains a later independent phase. Before its flag can open,
the partner billing mutation must receive the shared same-origin admin mutation
guard and the partner flow must receive its own atomic activation and canary
contract.

## Phase 4A acceptance gates

Phase 4A is complete only when all of the following are true:

1. Exact-business canary tests cover absent, empty, malformed,
   whitespace-padded, multi-value, matching, nonmatching, unauthenticated,
   wrong-owner, partner-linked, invoiced, comped, deleted, and suspended
   businesses. No canary state reaches a browser or public availability check.
2. Onboarding state, plan-intent persistence, Checkout, number search/purchase,
   registration refresh, paid launch, and every other SMS/Telnyx entry point
   agree on the canary and family boundary. Crafted requests cannot route a
   saved or locked Chat canary into SMS work while the broad flag is off.
3. The full rollback matrix passes for accidental Price unavailability, canary removal, Stripe
   Customer failure, Session failure, canceled/expired Session, completed but
   unsynchronized payment, webhook retry, finalization retry, active/trialing,
   completed past-due, and canceled/unpaid authority. No test deletes a family
   lock to recover.
4. Checkout concurrency and failure tests prove one live attempt, stable Stripe
   idempotency, exact ambiguous-outcome recovery, no duplicate payable Session
   or orphan Customer, terminal-generation rules, and one final subscription.
5. A disposable local direct journey proves plan selection, one-line $10
   Checkout, webhook/finalization, dashboard readiness, exact-origin widget,
   one completed metered reply, offline lead behavior, Calendar access, Billing
   usage, and zero Telnyx calls. The existing local 199/200 concurrency tests
   remain authoritative; a hosted canary need not spend 200 provider replies.
6. The Phase 4 audit, pre/post SQL reports, sanitizer, pagination, target/mode
   proof, four-plan catalog, Price validation, Portal validation, protected
   baseline, and blocker behavior have local fixture coverage.
7. A fresh disposable local database replay applies every migration in numeric
   order through the Phase 4 tip; the new migration 064 suites pass exactly 139
   main assertions plus 32 concurrency assertions, and the complete pgTAP run
   passes without durable fixture leakage.
8. Full Vitest, TypeScript, ESLint, optimized production build, and
   `git diff --check` pass. Existing plans, partner billing, branding, OAuth,
   Calendar, cleanup, and all zero-Telnyx Chat assertions remain green.
9. An independent adversarial review finds no release blocker, and the release
   runbook records every hosted target, stop condition, rollback boundary, and
   sanitized evidence artifact.
10. Both broad Chat Only flags remain unset or `0`, no hosted state was read or
    changed, and the completed phase is committed and pushed only to the
    feature branch as a backup.

## Phase 4B separately approved hosted stages

This section defines ordering only. It grants no permission to perform a remote
read or mutation. Each stage requires explicit owner approval naming the target
and Stripe mode; an approval may bundle stages only when it clearly names every
included action. Every Phase 4B Stripe action uses the existing production live
account and production Supabase project. Never switch the production application
to test mode or mix test and live Stripe objects in the shared database.

### Stage A — remote read-only preflight

- Confirm both broad Chat Only flags, the canary value, and Telnyx remote release
  are off before the first read, and confirm `STRIPE_PRICE_CHAT_ONLY` remains
  unset or empty. `WIDGET_TOKEN_SECRET` must likewise remain unset or empty for
  this pre-configuration baseline.
- Run the Phase 4 pre-Price baseline audit against the explicitly named
  production Stripe-live account and production Supabase project. It must prove
  the expected absence of configured Chat Only Price/subscription evidence or
  reconcile any already-reviewed object; absence is not treated as canary
  readiness.

  ```bash
  npm run audit:chat-only-phase4 -- \
    --stripe-mode live \
    --supabase-project-ref inmgpkurctttsofpywuz \
    --chat-price-state absent \
    --widget-secret-state absent \
    --canary-state absent
  ```

- Run only the appropriate transaction-read-only pre-migration SQL report.
- Retain the sanitized report and disposition every warning. An incomplete
  read, target mismatch, unknown authority, active conflict, or unexplained
  delta stops the release.

Remote read-only access is itself approval-gated. Stage A does not authorize a
repair, migration, provider lookup, credential change, Stripe mode change, or
broader use of the production service-role credential.

### Stage B — hosted configuration preparation

Separately approve and verify:

- creation or selection of the production-live Chat Only Product and one active
  USD $10 monthly recurring licensed Price, distinct from every live SMS base,
  setup-fee, and overage Price;
- the production-live signed Stripe endpoint is subscribed to
  `checkout.session.expired` in addition to the existing completion,
  subscription, and invoice events;
- `STRIPE_PRICE_CHAT_ONLY`, the existing pinned Billing Portal configuration,
  one shared `WIDGET_TOKEN_SECRET`, Google credentials, and `CRON_SECRET` in
  Railway;
- managed edge/WAF limits for every public widget endpoint and Railway's trusted
  forwarded-address behavior; and
- the existing single cron-job.org account-cleanup scheduler configuration.

Both broad Chat Only flags remain `0`, and the exact canary remains unset. A
scheduler edit or test request, cache purge, secret rotation, WAF/CDN change,
Railway variable change, Stripe object mutation, or canary-business creation is
a hosted mutation and must be named in the approval.

This configuration prepares a real billing path. The later Phase 7 test will
create a live Customer, live invoice, live subscription, and real $10 card
charge with ordinary Stripe processing and accounting consequences. Hosted
preparation did not authorize anyone to enter payment details or create a
Checkout Session.

After the Price and configuration are present, rerun the canary-ready audit in
GET/read-only mode. It must validate the Price, Portal, configuration, and
sanitized before/after delta before Stage C begins. The single-business canary
value remained unset throughout Phase 4 and may be set only for the separately
approved Phase 7 business.

```bash
npm run audit:chat-only-phase4 -- \
  --stripe-mode live \
  --supabase-project-ref inmgpkurctttsofpywuz \
  --chat-price-state required \
  --widget-secret-state required \
  --canary-state absent
```

### Stage C — migrations 063–064 cutover and compatible deploy

Migration 063 does not support rolling old Calendar writers beside the new
schema. Before the release window, approve one exact drain strategy:

1. stop the full application, verify every old replica is terminated, perform
   the cutover, and restore service only on the compatible commit; or
2. separately build, test, and deploy an old-schema-compatible Calendar
   maintenance gate before the 063 window, then prove every old create, update,
   delete, AI booking, OAuth completion/refresh, and disconnect writer is
   drained.

There is no current global Calendar-maintenance switch, so the runbook must not
pretend that setting an undocumented value drains traffic.

Within the approved stopped/drained window:

1. take the approved backup and record the exact running and target commits;
2. run the 061 active-widget inventory, 062 overlap inventory, and both 063
   namespace preflights under the documented locks;
3. apply every pending migration through 064 in numeric order, crossing 063
   only after the old writers are proven drained;
4. deploy only the compatible application and reconciler commit while old
   writers remain stopped;
5. run the post-migration read-only report and verify OAuth, credential refresh,
   provider-operation recovery wiring, and cleanup route authentication without
   invoking an authenticated cleanup run;
6. purge `/widget/embed.js`, wait out the prior cache window, and verify the new
   headers; and
7. reopen Calendar traffic only after every check passes.

Keep `CHAT_ONLY_DIRECT_SALES_ENABLED=0`,
`CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED=0`, and the exact canary unset throughout
the cutover. Stage C performs no Checkout, payment, Google event, Anthropic
request, Telnyx request, or authenticated cleanup run.

Once 063 is applied, rollback is **roll-forward only**. Never restore an older
schema, restart an old application replica, or reopen an old Calendar writer.
If a later check fails, keep affected traffic closed, preserve durable
provider-operation evidence, and deploy a reviewed forward fix.

### Historical Stage D — exact paid canary (not executed)

This was the original post-deployment contract. The owner deferred it before
any canary business, Checkout, subscription, or charge existed. Phase 7 now
governs the owner-led live acceptance. The retained controls were:

- create or identify the exact disposable direct/unpartnered business and set
  only its server-side canary UUID through an approved Railway change;
- leave both broad acquisition flags at `0`;
- run the required-canary readiness audit **after** setting the UUID and
  **before** opening Checkout; any existing subscription or unsafe durable
  attempt makes the business ineligible;
- have the owner manually open the exact production Checkout and personally
  enter the approved card details. No agent, operator, log, screenshot, or
  evidence artifact may receive the card number, CVC, or payment link;
- acknowledge and complete exactly one real live-mode $10 subscription, then
  verify signed webhook synchronization, atomic finalization, dashboard entry,
  exact-host widget install, a small number of real AI replies, lead fallback,
  Billing usage, Google OAuth, and one reviewed Calendar booking lifecycle;
- verify that no Telnyx client or provider resource was touched;
- run an explicitly approved authenticated cleanup heartbeat only if its
  destructive account-cleanup potential and nested Calendar results have been
  reviewed; and
- retain a sanitized release artifact plus a restricted finance record of the
  exact live invoice/payment. Do not put raw customer, payment, invoice, or
  subscription identifiers in the sanitized engineering report.

The required-canary readiness invocation is:

```bash
npm run audit:chat-only-phase4 -- \
  --stripe-mode live \
  --supabase-project-ref inmgpkurctttsofpywuz \
  --chat-price-state required \
  --widget-secret-state required \
  --canary-state required
```

Anthropic calls, Stripe-live Customers/Sessions/subscriptions/invoices, the $10
charge, Google OAuth or event mutations, widget traffic, scheduler requests,
account deletion, and cleanup are real production actions even when the account
is disposable. None is authorized by a successful local Phase 4A pass or by an
earlier Phase 4B stage.

### Historical Stage E — disposable-canary closeout (not executed)

This closeout would have applied only to the original disposable Phase 4
canary. Because that canary did not run, none of these cancellation or refund
steps occurred. The historical order was:

1. Remove `CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID` from Railway. Keep
   `STRIPE_PRICE_CHAT_ONLY` configured so signed webhook recovery and historical
   plan resolution remain available.
2. Prove new unpaid Chat acquisition is unavailable without the canary while
   the paid business retains its expected entitlement and exact recovery path.
3. Keep `CHAT_ONLY_DIRECT_SALES_ENABLED=0` and
   `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED=0`. Do not change public pricing,
   metadata, structured data, FAQ, CTA, or catalog visibility.
4. Cancel the exact live Stripe subscription at the owner-approved time so it
   cannot renew. Cancellation and refund are separate operations: a refund does
   not cancel a subscription, and cancellation does not refund the $10 charge.
5. If the owner approved a refund, refund only the exact original $10 payment
   through Stripe, verify the refund reaches a terminal succeeded state, and
   preserve the Stripe receipt. Never delete the Customer or database linkage
   as a substitute for cancellation or refund.
6. Wait for the signed subscription cancellation webhook and verify the local
   subscription becomes canceled. If synchronization fails, preserve evidence
   and repair the webhook path; never hand-edit the subscription, Checkout
   attempt, or family lock.
7. Record the original invoice, gross $10 charge, Stripe processing fee, refund,
   any fee retained or returned, any tax/credit-note artifact, cancellation
   effective date, and final net amount in the restricted accounting record.
   The accounting owner decides the appropriate bookkeeping treatment.
8. Perform account teardown only under a separate approval. Respect the 60-day
   deletion grace and durable Stripe/Calendar cleanup rules rather than deleting
   linkage manually.

Phase 4 closed after hosted preparation and compatible deployment, with both
broad flags off, the exact canary unset, and Chat Only hidden from public sale.
The unexecuted paid acceptance moved to Phase 7; it must never be reported as
Phase 4 evidence. Public direct launch still requires the Phase 5 local
acceptance, Phase 6 flags-off deployment rehearsal, Phase 7 owner-led live test,
fresh approval, and a monitored launch window. Partner assignment remains an
independent future project requiring its own implementation, acceptance pass,
hosted preflight, and canary.
