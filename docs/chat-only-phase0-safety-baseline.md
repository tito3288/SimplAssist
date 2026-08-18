# Chat-Only Phase 0 Safety Baseline

Phase 0 establishes evidence and fail-closed rollout controls before
`chat_only` becomes a database value, purchasable Stripe plan, or partner-admin
selection. It must not make the new tier visible or change the behavior of any
existing plan or account.

## Scope

Phase 0 is limited to:

- preserving regression tests for SMS Only, Growth, Full, direct Stripe
  billing, partner-managed billing, onboarding, branding, Google OAuth, usage,
  account deletion, and Telnyx protection;
- adding two independent, server-only rollout switches that default off;
- taking a sanitized, read-only inventory of current Stripe and Supabase state;
- recording and resolving any unexplained billing or Telnyx lifecycle state
  before later migrations can admit `chat_only`;
- confirming that the existing Bryan-owned/protected records and all existing
  Alpha Dog Agency client assignments remain untouched.

Phase 0 does **not** add the plan type, database constraints, capabilities,
pricing, onboarding branch, widget quota, partner option, plan transitions,
Telnyx release worker, Stripe product or Price, customer-facing copy, or sales
availability. It does not remediate production data. Any required remediation
is a separately reviewed operation performed after this audit identifies the
exact problem.

## Default-off rollout controls

The two rollout switches are deliberately independent:

| Environment variable | Later authority |
| --- | --- |
| `CHAT_ONLY_DIRECT_SALES_ENABLED` | Starting a new direct chat-only sale or transition |
| `CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED` | Creating or transitioning a partner client into chat-only |

Both switches are server-only and fail closed. The exact string `1` is the
only enabled value. Unset, empty, `0`, `true`, `yes`, `01`, whitespace-padded,
and every other value mean disabled. They must remain unset or `0` throughout
Phase 0.

These are acquisition controls, not entitlement switches. Once chat-only is
implemented, turning a switch off must stop new entry into the tier without
revoking an existing customer's capabilities, interrupting a paid onboarding
retry, or preventing recovery of an already-created partner provisioning job.
Do not put either value in a `NEXT_PUBLIC_` variable and do not make a client
component authoritative for it.

## Read-only inventory workflow

The inventory command is:

```bash
npm run audit:chat-only-phase0 -- --stripe-mode <test|live> --supabase-project-ref <ref>
```

Replace both placeholders explicitly. Never infer the Stripe mode from a key
and never infer the Supabase target from whichever CLI project happens to be
linked. The command must confirm that the supplied Stripe key has the requested
mode and that the configured Supabase URL matches the supplied project
reference before making either read.

Run the command in the Stripe mode actually paired with the explicitly named
Supabase target. The current application can legitimately use Stripe test mode
with its deployed Supabase project; that does not make the billing state live.
Before any future live sale, repeat the inventory with the approved live key
and exact production project reference. Every audit remains read-only: it must
not create or update a customer, subscription, Checkout Session, Portal
configuration, invoice, Price, database row, Telnyx resource, or lifecycle
claim.

The audit may perform only these operations:

- Stripe list/retrieve requests needed to inventory the account,
  subscriptions, their customer linkage and base-plan Price IDs, and Billing
  Portal configuration;
- Supabase `SELECT` requests needed to inventory subscription authority,
  partner assignments, protected fixtures, Telnyx resource classifications,
  release configuration, and open or due release work;
- local validation and sanitized count/fingerprint output.

It must not call a Supabase RPC, issue SQL, use an HTTP method other than `GET`
against Stripe, or initialize the Telnyx client. Database Telnyx lifecycle rows
are evidence about SimplAssist's ledger; they do not prove live provider state.

Before each run:

1. Confirm both chat-only rollout switches are unset or `0` in the target
   Railway environment.
2. Confirm the intended Stripe mode and Supabase project reference with the
   project owner.
3. Supply credentials through the approved environment or secret manager.
   Never place secret values in shell history, repository files, screenshots,
   audit output, or support notes.
4. Run the command once and retain only its sanitized summary.
5. If the process exits nonzero, returns an incomplete section, or reports an
   unexpected target, stop. Do not rerun with broader credentials or attempt a
   repair from the audit process.

The audit must redact customer identity, contact data, full provider IDs,
phone numbers, and secrets. Counts, plan/status values, and stable one-way
fingerprints are sufficient for reconciliation.

## Protected accounts and resources

Phase 0 is observation-only for every account. In particular:

- Do not update, reactivate, cancel, delete, reassign, re-provision, or run a
  checkout for any Bryan-owned or protected business, including Bryan
  Develops.
- Do not change the Alpha Dog Agency partner or any of its existing clients,
  including the boss account, their billing mode or plan, branding, campaign
  history, phone assignment, or Telnyx submission controls.
- Do not use either account as a migration rehearsal, partner-flow test,
  Stripe test, downgrade test, Telnyx release canary, or fixture cleanup
  target.
- Do not weaken or replace the protected identifiers and `protected_hold` /
  `protected_retain` behavior established by migration 034.

Later destructive lifecycle verification must use a newly created disposable
business whose provider resources are proven to be exclusively owned by that
business.

## Required verification gates

Phase 0 is complete only when all of the following are true:

1. Both rollout flags are default-off, exact-`1` only, independent, and covered
   by unit tests. The existing `PLAN_SALES_STATUS` behavior remains unchanged.
2. The current three-plan regression suite passes and proves the existing
   direct/partner entitlement precedence, plan allowances, onboarding paths,
   checkout setup fee, SMS overages, branding, OAuth, and protected resource
   behavior.
3. `npm test`, `npm run build`, and the local database test suite pass. A local
   database harness prerequisite such as `pg_cron` may be recorded separately,
   but it is not permission to treat an unexecuted database suite as passing.
4. The inventory completes in the Stripe mode currently paired with the
   explicitly named project and produces no unexpected authority, duplicate,
   or lifecycle state.
5. Before either production rollout switch can open, the approved live
   read-only inventory completes against the explicitly named production
   project.
6. Stripe has no unexplained duplicate active subscriptions, multiple
   authoritative subscription relationships for one business, unknown
   base-plan Price IDs, mode mismatch, or unexpected Portal plan-switching
   configuration.
7. Supabase has no unexplained direct/partner split authority, malformed plan
   or billing mode, ambiguous managed-resource ownership, releaseable
   unverified resource, or open/due Telnyx release work.
8. The Bryan protections and every Alpha Dog Agency client assignment match
   the known baseline without mutation.
9. Every warning has an owner and written disposition. Counts from Stripe and
   Supabase reconcile or the difference is explained with evidence.

## Interpreting blockers

Treat a nonzero audit exit, failed read, incomplete inventory, target mismatch,
malformed response, or unexplained discrepancy as a blocker. Unknown is not a
pass. Stop Phase 1 until the condition is understood and, if necessary,
resolved through a separately approved change followed by a fresh read-only
inventory.

The following fail-closed states are expected safeguards, not blockers by
themselves:

- both chat-only rollout flags disabled;
- Telnyx remote release disabled;
- the database release configuration disabled or restricted to a reviewed
  single-business canary;
- Bryan resources classified as protected;
- legacy provider pointers held as `unverified_hold` until ownership is
  proven.

They become blockers if the audit finds that the safeguard is absent, a
protected target is releaseable, an unverified resource is queued for remote
mutation, a due action is unexplained, or code/configuration claims a release
capability that is not actually operational.

Warnings are not automatic passes. An expected historical row, parked
resource, canceled subscription, or due release reason must be tied to an
identified business and documented policy without exposing customer data. Do
not delete or rewrite it merely to make the report green.

## Later enforcement points

When `chat_only` is introduced in later phases, the same server-only controls
must be enforced at every acquisition boundary:

- direct plan-intent persistence and `/api/billing/checkout`, before loading a
  chat-only Price or performing any Stripe, setup-fee, onboarding-launch, or
  Telnyx work;
- new partner-client creation, after admin authorization and strict request
  validation but before `provisionPartnerClient`;
- partner plan assignment or transition, before
  `assign_business_partner_billing` or its versioned replacement;
- server-rendered direct and admin pages, which pass advisory availability to
  client components while the server mutation remains authoritative.

Partner assignment must not reuse the existing direct `PLAN_SALES_STATUS`:
Full is intentionally assignable by an admin while unavailable for new direct
sales. Combining those policies would silently change current behavior.

## Known rollout risks

- Disabling direct sales does not automatically expire a Stripe Checkout
  Session that was already created; a legitimate in-flight completion still
  needs deterministic webhook handling.
- A rolling Railway deployment can briefly contain instances with different
  environment values. Drain the old deployment and verify the effective gate
  before treating a change as complete.
- A service-role operator can bypass application environment gates by calling
  an assignment RPC directly. Service-role access remains an operational trust
  boundary and is never a launch shortcut.
- Static marketing output may require a rebuild before it reflects a changed
  server rollout value. UI visibility is advisory; the route gate is the
  authority.
- The current business-partner-billing mutation does not yet use the shared
  same-origin admin mutation guard. Harden that route before enabling
  chat-only partner assignment.
- An application inventory of Telnyx ledger rows cannot verify the current
  Telnyx provider account. Provider reconciliation and destructive canaries
  remain later, separately approved work.

Passing Phase 0 establishes a trustworthy baseline. It does not authorize
Phase 1 deployment, production data changes, or either rollout flag.

## Baseline execution record — 2026-08-18

This section is a dated record, not a substitute for rerunning the inventory
immediately before a later rollout.

Local remediation and regression verification are green:

- all 56 migrations replayed on a freshly reset, wrapper-verified local
  Supabase CLI 2.115/PostgreSQL 17 stack;
- all 37 pgTAP files and 1,783 assertions passed, followed by a clean durable
  fixture-state comparison;
- all 311 Vitest files and 5,166 tests passed;
- ESLint completed with no warnings or errors;
- the optimized Next.js production build and TypeScript validation passed.

The guarded local runner now rejects remote Docker targets, validates a
name-colliding stopped container before starting it, proves the exact
migration-009 bootstrap boundary, pins every child command to the verified
local Unix socket, checks the complete migration/cron/privilege catalog, and
detects committed fixture leaks after pgTAP. The migration-009 `pg_cron` and
legacy default-privilege setup is a pinned local compatibility lane only.
`api.auto_expose_new_tables` must be replaced with an explicit reviewed grant
baseline before its announced 2026-10-30 removal.

The remediation preserved production rules. Stale account-deletion and
Telnyx concurrency timestamps were repaired in tests, PostgreSQL 17 catalog
inspection was made planner-safe, and migration 056 adds the narrow missing
guard that requires a prior local status for phone release actions. No Telnyx
release rule was weakened.

Both approval-gated hosted repairs completed on 2026-08-18:

- SimplAssist is now explicitly classified under the existing internal
  `billing_pilot` authority. Exactly one dead local Growth subscription was
  deleted only after both its stored Stripe customer and subscription returned
  `resource_missing` in the explicitly configured Stripe test account. The
  existing 21-part usage period, active assigned phone, approved campaign, and
  all other billing flags were preserved. No Telnyx release reason, run, or
  action was created. SimplAssist now resolves through the documented legacy
  Full billing override until it is deliberately converted to a real paid
  subscription.
- One active Stripe-test Billing Portal configuration was created and pinned
  as `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` in the SimplAssist Railway
  production environment. It allows invoice history and payment-method
  updates only; customer edits, cancellation, subscription updates, and price
  switching remain disabled. Railway redeployed the existing application
  revision successfully, kept one replica online, and the public health route
  returned HTTP 200.

One previously reported subscription mismatch is expected deletion-grace
state: Stripe cancellation is durably recorded for the deleted business while
its local row remains until cleanup. Four Telnyx lifecycle runs remain open but
none has a due reason or due action: two belong to deleted Alpha Dog test
clients, one is the protected Bryan hold, and one is the deletion-grace hold.
These are documented warnings, not authorization to execute remote release.

The final sanitized read-only Stripe-test/Supabase inventory reports `pass`
with no blockers. Both chat-only acquisition switches and remote Telnyx
release are off, database release mode is disabled, every required
Bryan/SimplAssist protection is present, and all three Alpha Dog client
assignments have valid partner billing authority. The only hosted mutations
were the two explicitly approved repairs above. No live-mode Stripe object or
Telnyx provider resource was created, updated, or released.
