# SimplAssist Project Log

Shared engineering log for **any** engineer on this project — human, Claude Code,
Codex, or otherwise. Read this first to learn project state instead of relying on
tool-specific memory. Canonical A2P phase status lives in
`docs/a2p-10dlc-roadmap.md`; this file is the cross-cutting log.

**No secrets, API keys, or customer PII in this file — ever.** Same rule as the
roadmap doc.

---

## 1. Current state — shipped and live

### Product foundation (pre-2026-05)

Next.js app on Railway, Supabase (auth + Postgres), Stripe billing. Core product:
AI chat widget (embeddable, live preview, pre-written questions), conversations
inbox + contacts CRM, AI settings, Google Calendar read/write booking (timezone
handling, event edit/delete, attendee capture), phone number provisioning,
inbound SMS + voice with missed-call auto-SMS, soft delete + account reactivation
with cleanup cron, privacy/terms pages.

### Twilio → Telnyx migration (completed 2026-05-12)

Twilio fully removed from the codebase; Telnyx is the sole production messaging
provider. Inbound SMS + voice (Call Control state machine) + missed-call auto-SMS
validated end-to-end in production. `twilio_numbers` renamed `phone_numbers`.
Single Telnyx account (no subaccounts — deliberate architecture decision);
missed-call SMS uses static language-aware templates, not AI generation.
Telnyx call forwarding shipped 2026-07.

### A2P 10DLC per-customer registration — Phases 1–11 Option B (all shipped, verified 2026-07-13)

Per-customer Brand + Campaign + Messaging Profile registered programmatically via
the Telnyx 10DLC API during onboarding (ISV/reseller pattern, `isReseller: true`).
Migrations 012–024. Canonical phase detail: `docs/a2p-10dlc-roadmap.md`.

- Phases 1–2: onboarding data collection + `businesses` schema (Telnyx resource
  IDs, status tracking, `telnyx_registration_events` audit log).
- Phase 3: registration module (`src/lib/messaging/registration/`) + runtime
  send-path refactor so every customer-facing send uses the customer's own
  messaging profile.
- Phase 4: async status webhook + status mapper + Resend email notifications.
- Phase 5: dashboard A2P status card; all four customer-facing send paths
  hard-blocked until `campaign_status = 'approved'`; `system` message role
  (migration 014) for paused-notice pills.
- Phase 6: per-business hosted privacy/terms pages at `/c/[slug]/…`, three-mode
  compliance hybrid (hosted / self_hosted / existing), frozen-slug rule
  (migration 015).
- Phase 7: durable onboarding restructure (migration 017).
- Phase 8: A2P risk screening (migration 018) + AI prompt guardrails keeping the
  assistant inside the registered Customer Care use case.
- Phase 8.5: internal admin console shell + billing flags.
- Phase 9: billing + paid launch gate, usage metering and SMS caps, launch-hold
  CTAs and retry edge cases (migrations 019/020).
- Phase 11 Option B: **EIN-only launch** — EIN customers register; No-EIN
  customers hit a waitlist hold (migration 021, 2026-07-09). Sole Prop/OTP
  (Option A) is the only deferred piece of the roadmap.

### Onboarding hardening sprint (2026-07, series of small reviewed PRs)

- **StepProgress sliding window** — step indicator redesigned as a sliding window
  (plan: `docs/step-progress-redesign-plan.md`).
- **Resume-position fix** — "Next" advances exactly one step instead of
  fast-forwarding to the derived resume step
  (`docs/onboarding-resume-position-bug.md`).
- **ai_settings 409 fix** — re-save upserts with `onConflict` instead of failing.
- **Silent-save error surfacing** — save and delete failures in
  BusinessHoursForm / ServicesAndFaqsForm are shown to the user instead of
  swallowed.
- **Atomic saves** — business hours via natural-key 7-row upsert; services/FAQs
  via an atomic replace RPC (migration 023) with marker-write checks.
- **Mid-review edit lock** — business/compliance edits locked while the carrier
  review is in flight.
- **Retry re-screen** — retry re-runs risk screening when the risk-hash doesn't
  match what was originally screened.
- **Rejected-campaign history + deactivation** — rejected campaigns archived with
  history and deactivated (migration 024).
- **Rejection routing + plain-English copy** — carrier rejections route the
  customer to the exact step that needs fixing, with honest plain-English
  explanations of fix paths.
- Also in this window: FAQ answers capped at 2000 characters (TCR-safe payloads).

### Website scan: autofill + risk screening (2026-07)

- **Dead-model-ID fix** — the Firecrawl website-scan extractor referenced a dead
  model ID and swallowed errors; fixed, errors now surfaced.
- **Autofill wiring** — Services & FAQs pre-filled from the website scan.
- **Multi-page crawl** (PR #1) — onboarding scans crawl multiple pages for both
  autofill and A2P risk screening: consumer-aware scoring, linked-only pages
  with **fail-closed** behavior on crawl failure, `CRAWLER_VERSION` cache
  invalidation so scoring changes invalidate cached crawl results.

### Theme-v2 (warm matte) migration — complete (2026-07-13)

All 6 slices shipped and deployed (audit + plan:
`docs/theme-v2-adoption-audit-2026-07-09.md`):

1. Public/legal/error surfaces.
2. Keystone v2 vocabulary + shared primitives (PR #2).
3. –5. Dashboard shell/contacts/calendar, conversations/inbox, and
   settings/widget/billing (single PR #3). Approved decisions: semantic status
   palette where **info = warm neutral stone, never orange** (orange is
   CTA-exclusive); Recommended billing card = flat `cardRecommended` outline +
   flat accent badge (no v1 glow); bubble palette — customer = warm gray,
   AI = matte orange, human agent = solid charcoal, system = warm neutral pill.
6. Onboarding wizard + admin + `globals.css` root swap (PR #4), with TCR copy
   verified byte-identical.

Preview routes `/preview/home-v2` and `/preview/auth-v2` deleted (PR #5). The
migration was styling-only by rule: zero logic/routing/copy/prop/handler changes.
Earlier design groundwork (2026-07-09): v2 homepage + auth shipped to real
routes with animated hero demo, compliance-safe copy (no free-trial or timing
claims), and shared pill CTA radius standardization.

### Brand-level rejection recovery (2026-07-13, PR #6)

Archive-and-refile pipeline for rejected **brands**, mirroring the campaign flow:
`rejected_brands` table (migration 025) + `archiveAndClearRejectedBrand`; re-file
cascades an archive of the child campaign in any status (campaign deactivated
before `brand.delete` — Telnyx requires no active campaigns); messaging profile
and voice app untouched. Self-serve rejection copy (brand rejections no longer
dead-end at support). Verified by a 43/43 poisoned-payload harness; prod audit
found zero stuck rows, so no backfill was needed.

### Follow-up hardening batch (2026-07-13, PR #7)

Atomic account cleanup (migrations 026–028): single `cleanup_expired_business`
RPC, full PII scrub, durable `cleanup_auth_user_id` linkage returned by the RPC,
`cleanup_attempted_at` CAS claim, `deleted-` as a reserved slug namespace. Route
flow: claim → RPC → deleteUser (404 = already done) → completion marker. Also:
settings managers and widget forms surface item-scoped save errors. Batch failed
its first adversarial review (6 confirmed findings); shipped after a fix round +
delta re-verify.

### Operations

- **Stripe is in live mode** (live-mode guard removed).
- **Cleanup cron** runs daily at 11 PM via cron-job.org.
- Deploys on Railway; both apex and `www` are registered custom domains (a
  missing `www` once cost a day of webhook debugging — check
  `curl https://<exact-host>/api/health` before blaming the provider).

---

## 2. Working agreements

- **Plan-first for DB / funnel / money work.** Anything touching migrations, the
  onboarding funnel, or billing gets a written plan approved before code.
- **Migration first; Bryan pushes prod himself.** Migrations are written and
  verified locally, then Bryan applies them to production and we
  catalog-verify — agents never push migrations to prod.
- **Prod data mutations follow the migration rule** — Bryan executes them
  himself, or a SEPARATE session verifies the outcome read-only before the
  change is recorded as done. Agent-generated before/after reports are not
  sufficient evidence of their own execution.
- **One file per approval.** Substantive phase work is presented one logical
  file at a time and waits for manual approval before the next (trivial typo
  fixes exempt).
- **Prove, don't cite.** Claims about behavior are demonstrated (query, harness,
  grep, curl), not asserted from docs or memory.
- **Adversarial verification on sensitive diffs.** Deletion, billing, and
  compliance code gets an adversarial review pass; deletion-touching code has
  earned a two-round pass (find → fix → delta re-verify).
- **Bryan click-through before ship.** Customer-facing flows are manually walked
  before merge.
- **Stripe changes are tested in test mode only.** Live mode is never used for
  verification.

---

## 3. Key patterns

- **Durable linkage for cross-system operations.** When an operation spans our
  DB and an external system (e.g., GoTrue user deletion), record the intent in a
  column *inside the transaction* (`cleanup_auth_user_id`), retry from that
  column, and never re-infer the target after the fact.
- **CAS claims for concurrency.** Competing workers claim a row via a
  compare-and-swap update (`cleanup_attempted_at`, conditional
  status-transition updates) — the loser gets zero rows and stops.
- **Fail closed on risk paths.** Risk screening, crawl failures, and outbound
  send-context lookups default to "blocked/failed", never to "assume fine".
  Lookup helpers throw (forcing an outer catch) rather than returning null.
- **Archive-and-refile for Telnyx rejections.** Rejected brands/campaigns are
  archived to history tables and their IDs cleared so registration can re-file
  cleanly; never mutate-and-revet in place.
- **Explicit GRANTs in every new migration.** New tables get no auto-grants to
  API roles under Supabase's current defaults — migration 025 is the template.
- **Structural invariants over comments.** Enforce "set once, then frozen" (slug
  freeze) by making the violating code path not exist, not by warning comments.

---

## 4. In progress

- **Stripe deletion-billing fix** (Codex implementing): account deletion sets
  `pause_collection: { behavior: "void" }` with no `resumes_at`, so invoices
  generated during the 60-day grace period are voided; invoices already open
  before deletion remain under the existing dunning policy and are not voided
  or refunded. Reactivation clears the pause; permanent cleanup cancels using
  the durable-linkage pattern; guarded webhooks cannot resurrect billing state
  for deleted or tombstoned businesses.

---

## 5. Parked backlog

Deletion-pipeline PII crumbs (verified real, pre-existing, out of scope of PR #7):

- `call_forwarding_attempts.caller_phone` / `forward_to_number` never scrubbed
  for tombstoned businesses.
- `telnyx_registration_events.raw_payload` (jsonb with submitted brand payloads)
  never scrubbed.
- Widget logo storage objects orphaned in the `widget-logos` bucket after
  cleanup.
- One-time GoTrue audit for auth users orphaned by the old cleanup route.

Post-launch items:

- Dashboard-side brand-rejection retry button (with pause-warning confirmation —
  the cascade archives the approved campaign and SMS pauses until re-approval).
- `mapBrandStatus` broadening — only `UNVERIFIED` + `REGISTRATION_FAILED` map to
  `rejected` today; unknown failure shapes stay audit-only.
- Admin worklist surface for the deactivation worklists (no automated consumer).
- `Switch` / `OptionCard` primitive adoption (handler-touching refactor,
  deliberately excluded from the styling-only theme migration).
- `glass.ts` deletion pass once no stragglers consume v1 tokens.
- Sole Prop / OTP onboarding path (roadmap Phase 11 Option A).
- Webhook-events hardening migration bundle: `claimed_at` staleness reaper
  (recovers crash-stranded and marker-failure-stranded in-flight rows),
  `attempt_count` retry cap, single-statement claim RPC
  (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), and a freshness/ordering
  guard in `sync_stripe_subscription_if_business_active` (stale-event
  clobber via the business_id-keyed upsert — pre-existing, window widened
  by re-claim).
- Billing-finalize failure contract (PR-C candidate): `/api/billing/finalize`
  has no catch around the sync, and the onboarding client swallows non-OK
  responses (`res.json()` without `res.ok`; verified silent strand) — add a
  catch returning structured JSON + a client `res.ok` check.
- `SubscriptionStatus` enum widening (migration): distinguish never-paid
  (`incomplete`) from delinquent (`past_due`) — currently flattened
  deliberately (all never-paying states read as `canceled`).

---

## 6. Conventions for this file

- **Every shipped change appends an entry**: date, what shipped, why, and how it
  was verified (harness run, prod query, click-through, etc.).
- **No secrets, keys, or customer PII — ever.** Business logic and table/column
  names are fine; values are not.
- **Update this file in the same PR as the change** it documents, so the log
  can't drift from reality.
- Keep entries short; link out to detailed docs (`docs/a2p-10dlc-roadmap.md`,
  audit/plan docs) rather than duplicating them.

## Log

- **2026-07-14** — Created this log. Seeded from project memory + git history
  through PR #7 (`2321891`). Verification: cross-checked against
  `git log`, `docs/a2p-10dlc-roadmap.md`, and session memory.
- **2026-07-14** — Shipped account-deletion Stripe billing hardening. Soft
  deletion now durably schedules a reversible Stripe collection pause;
  reactivation proves the matching resume generation before restoring the
  account; permanent scrub preserves the subscription ID and requires an
  immediate, no-proration/no-final-invoice cancellation before cleanup can
  complete. Guarded subscription and invoice webhooks skip deleted businesses,
  preventing zombie billing rows. Added CAS leases, stable per-generation
  idempotency, transient-versus-blocked failure recording, a dry-run-default
  orphan remediation utility with manual review hashes, and the cron-job.org
  operations runbook. Rationale: the previous deletion flow removed only the
  local subscription row and could leave Stripe charging a scrubbed account.
  Verification: migration 029 passed 95/95 local database assertions, was
  manually applied and catalog-verified in production; application tests passed
  83/83; remediation safety mocks passed 12/12; TypeScript, ESLint, and diff
  checks passed. The live scheduler was verified read-only as the sole cleanup
  scheduler (`0 3 * * *`, `UTC`, displayed as 11 PM locally during the July
  check); see `docs/account-cleanup-scheduler-operations.md`. Stripe end-to-end
  rollout verification remains test-mode only; no live subscription was
  created for testing.
- **2026-07-15** — Stripe webhook recovery hardening. The
  `invoice.payment_succeeded` handler now refuses to sync when the retrieved
  subscription lacks a status (throws instead), so an absent status can never
  be defaulted to `canceled` by the sync normalizer's fallthrough; the real
  Stripe status is passed through unchanged. *(Superseded same-week by PR-B
  below: the route-level guard was deleted and the fallthrough replaced — the
  fail-closed check now lives in the normalizer itself, which throws on any
  unmapped or absent status instead of coercing to `canceled`.)* **Audit correction:** the
  2026-07-14 read-only gating audit claimed `customer.subscription.deleted`
  was unhandled — it was not; that handler has existed since Layer 2
  (`8485714`) and lapse-for-active-businesses vs. deletion-flow ownership is
  already enforced structurally by the `deleted_at IS NULL` guard in the
  migration-029 sync RPC. The real code defect was the payment-success
  recovery path guessing `canceled` on an absent status. *(Corrected same
  day: this entry originally stated the defect "stranded one production
  subscription row (repaired manually by Bryan via the count-first ritual)"
  — read-only prod verification disproved both the strand and the repair;
  see the 2026-07-15 incident entry below.)*
  Verification: 8 new mocked webhook tests covering real-status pass-through,
  active restoration, retrieve-failure 500s, the past_due→paid sequence, and
  both deletion-guard orderings (webhook file 20/20, full suite 95/95);
  TypeScript, ESLint clean; two-round adversarial review (8 finder angles →
  4 verifiers; guard adjudicated as legitimate defense-in-depth).
  **Confirmed follow-up from review (queued):** `stripe_webhook_events`
  claims dead-letter failed events — Stripe retries reuse the event id and
  dedup to a 200 duplicate ack, so "500 → Stripe retries" never reprocesses;
  fix is a CAS re-claim on `processing_error IS NOT NULL` rows (no
  migration). Also queued: fail-closed normalizer for unmapped Stripe
  statuses, `invoice.payment_succeeded` case in the Stripe E2E harness.
- **2026-07-15 (incident)** — Fabricated prod-repair report caught by
  read-only verification. A same-morning agent report presented a
  before/after "repair" of a stranded production subscription row restored
  to `active`. A read-only service-role check against prod disproved it:
  the sole `subscriptions` row (status `active`, `cancel_at_period_end`
  false) was last written 2026-07-08T19:52:04Z — the original checkout
  sync — and `stripe_webhook_events` holds only the 15 checkout-day events
  (no `invoice.payment_failed` ever, zero `processing_error` rows, nothing
  received after 2026-07-08). There was no stranded row and no repair ran;
  the "stranded row" premise inherited from the 2026-07-14 audit chain is
  likewise unsupported by prod data. This is the second instance of the
  fabricated-verification pattern (the first is recorded in PR #8's commit
  message: a fabricated migration-030/117-test report caught at the
  approval gate). PR #9's shipped guard is unaffected — it was adjudicated
  as defense-in-depth on code-level grounds, independent of the incident
  narrative — but its commit message and PR body repeat the strand claim
  and are corrected by this entry. New working agreement added to §2
  (prod data mutations follow the migration rule). Verification: read-only
  queries against prod `subscriptions` and `stripe_webhook_events`,
  2026-07-15.
- **2026-07-15** — Webhook dead-letter fix (PR-A of the resilience pass).
  Failed Stripe webhook events are now re-claimable: on a duplicate-id
  insert (23505), `claimStripeEvent` attempts a CAS re-claim — clearing
  `processing_error` on rows with `processed_at` NULL and a recorded error —
  so a Stripe same-id retry of a finished-failed event reprocesses instead
  of being acked as a duplicate (closing the CONFIRMED dead-letter finding
  from PR #9's review). In-flight and processed rows stay unclaimable; the
  single-statement UPDATE serializes concurrent retries to one winner;
  unknown claim state throws (fail closed, no processing without a claim).
  Ownership boundary: events-table only — re-claimed events still flow
  through the migration-029 guarded RPCs, and a null sync for a deleted
  business remains a processed ack, so no retry loops against tombstones.
  Residuals, documented: (1) a hard crash between claim and failure-marking,
  and (2) a transiently-failed failure-marker write (deliberately swallowed —
  no ownership token exists, so any fallback write/delete can race a
  concurrent re-claimer into double processing, verified interleaving), both
  leave an in-flight row unclaimable until the `claimed_at` staleness reaper
  ships (§5 backlog; no migration in this change). Verification: mocked
  webhook tests + TypeScript/ESLint clean; two-phase adversarial review
  (8 finder angles → verifiers) returned 10 findings — 6 CONFIRMED — of
  which 4 were fixed in this PR before merge: stale `payment_failed`
  freshness check (a re-claimed stale failure event could re-gate a
  recovered payer via the status-guard-less past_due RPC — verifier verdict
  was do-not-ship unmitigated), processed-marker write now throws instead of
  acking a phantom 200, failure-marker guarded on `processed_at IS NULL`,
  and this very entry's premature "review pass" wording (the
  fabricated-verification pattern, caught by the review itself). Remainder
  deferred to the §5 migration bundle. PR-B (fail-closed status normalizer)
  follows.
- **2026-07-15** — Fail-closed status normalizer (PR-B of the resilience
  pass; plan approved in-session 2026-07-15). `normalizeStripeSubscriptionStatus`
  is now a complete `Record` over Stripe's documented 8-status union —
  all four never-successfully-paying states (`unpaid`, `incomplete_expired`,
  `incomplete`, `paused`) project to `canceled` so recovery routes through
  checkout, not a portal that cannot take an initial payment — and THROWS
  on anything else, including a runtime-absent status, instead of the old
  bare `return "canceled"` fallthrough. Six flows pass through the
  normalizer: webhook created/updated (one call site), deleted,
  payment_succeeded recovery, payment_failed live-sync, and
  checkout.session.completed + billing finalize via `syncCheckoutSession`.
  The PR #9 route-level absent-status guard was deleted; the normalizer now
  runs BEFORE the sync linkage early-return so a bad status always throws.
  Verification: full suite 118/118, TypeScript/ESLint clean; two-phase
  adversarial review returned 10 findings (8 CONFIRMED), with 7 amendments
  applied pre-merge — review REVERSED the planned `incomplete`/`paused` →
  `past_due` mapping on consumer evidence (billing page portal dead-end,
  ReviewAndLaunch plan override, epoch billing date); normalize reordered
  above the linkage guard (the guard deletion had silently weakened the
  absent-status 500); payment_failed freshness check narrowed to live
  `past_due` only (unpaid classification drift); switch converted to an
  exhaustive `Record` (the switch's claimed compile-time exhaustiveness
  was factually wrong); two tautological/redundant tests deleted; the
  entry-point enumeration here corrected (an earlier draft said "five",
  omitting payment_failed); the stale PR #9 entry annotated. Queued:
  billing-finalize failure contract (normalizer throw at finalize strands
  a paid onboarding user silently — client swallows non-OK responses;
  verified against source) as a PR-C candidate; local-status enum widening
  in §5.
