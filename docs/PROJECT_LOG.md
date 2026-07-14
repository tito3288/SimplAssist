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

- **Stripe deletion-billing fix** (Codex implementing): pause subscription +
  void open invoices on account delete; resume on reactivate; cancel at
  permanent cleanup using the durable-linkage pattern; webhook zombie guard so
  events for tombstoned businesses can't resurrect billing state.

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
