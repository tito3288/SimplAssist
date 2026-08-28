# Richer Website Scan Rollout and Operations

This runbook covers the review-first website knowledge pipeline introduced by
migration 067. It documents deployment, canary testing, monitoring, and
rollback. It does not authorize a hosted migration, Railway service change,
environment-variable change, or production rollout by itself.

## Product and trust boundary

The scanner reads up to 12 useful public pages, drafts a short business
briefing, profile fields, services, FAQs, facts, policies, and up to five
targeted owner questions. A draft is never live assistant knowledge. The owner
must review and publish it first.

The live assistant reads only active services, answered FAQs, structured
business data, and approved rows in `business_knowledge_items`. It never reads
raw website Markdown or a website live while answering a customer. Structured
contact details, hours, services, FAQs, owner guardrails, and successful tool
results take precedence over the richer knowledge block.

Raw Markdown is service-role-only. It is deleted immediately after a draft is
successfully produced and after cancel, discard, publish, or terminal failure.
Only an automatic worker retry may retain it temporarily; every retained row
expires after 24 hours and the worker purges expired rows at startup and hourly.

## Server-only configuration

The web application uses these rollout variables:

- `RICHER_WEBSITE_SCAN_ENABLED`: only exact `1` enables the richer scanner for
  every production business. Unset, `0`, whitespace, and truthy-looking values
  fail closed.
- `RICHER_WEBSITE_SCAN_CANARY_BUSINESS_ID`: one exact canonical business UUID
  admitted while the broad switch remains off. It accepts no list, wildcard,
  or surrounding whitespace.

Never create `NEXT_PUBLIC_` copies of either rollout variable.

The dedicated Railway worker requires:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `FIRECRAWL_API_KEY`; and
- `ANTHROPIC_API_KEY`.

`WEBSITE_SCAN_MODEL` is optional and defaults to the same Haiku model used by
the existing extraction path. Railway supplies `PORT`; the worker also accepts
`WEBSITE_SCAN_HEALTH_PORT` for a non-Railway environment. Never print or store
the secret values in logs, screenshots, or this repository.

## Railway worker

Create a separate service from the same repository and select
`railway.scan-worker.toml` as its config file. The service runs
`npm run start:scan-worker`, exposes `/health`, and processes at most two scans
concurrently. Do not replace the web service's existing `railway.toml` with the
worker config.

The health response proves that the process is accepting work; it does not
prove Firecrawl, Anthropic, or Supabase can complete a scan. Confirm a canary
scan end to end before broad rollout.

## Deployment order

Migration 067 is additive for the old application, but the new application and
worker require it. Use this order:

1. Keep `RICHER_WEBSITE_SCAN_ENABLED` unset or `0` and remove the canary. Record
   the current application deployment, database migration tip, and worker
   state.
2. Run the local database suite against a disposable Supabase instance and
   require all assertions in
   `supabase/tests/database/067_richer_website_scan_foundation.test.sql` to
   pass. Review the content-free pre-deployment state separately before any
   hosted mutation.
3. Apply migration 067. Confirm its transaction committed completely and that
   no application traffic is reporting missing-table or missing-RPC errors.
4. Deploy the compatible web application with the richer-scan rollout still
   off. This order is mandatory because the live AI runtime now reads the new
   approved-knowledge table.
5. Deploy the separate scan worker with all four required secrets. Verify
   `/health` and confirm idle polling does not produce claim or permission
   errors.
6. Set one approved business UUID in
   `RICHER_WEBSITE_SCAN_CANARY_BUSINESS_ID`, leaving the broad switch off.
   Complete the canary checklist below. A post-onboarding canary must also have
   the normal Assistant Customization entitlement.
7. Remove the canary. Review provider cost, failure rate, draft quality, and
   owner acceptance evidence. Set `RICHER_WEBSITE_SCAN_ENABLED=1` only in a
   separately approved monitored window.

Do not deploy the new web application before migration 067. Do not combine the
migration, worker creation, canary, and broad opening into one unobservable
change.

## Canary acceptance

Use an account and public website that the owner is authorized to test.

1. Start an onboarding scan and verify the UI explains the 1–2 minute wait,
   survives a refresh, shows bounded progress, and can be cancelled without
   blocking manual onboarding.
2. Verify the draft contains source links and excerpts, no raw Markdown, and no
   unsupported invented claim. Confirm the business briefing and all new items
   remain inactive before approval.
3. Approve at least three distinct services and three answered FAQs. Edit one
   suggestion, answer one optional owner question, skip another, and publish.
4. Verify the approved overview, facts, and policies appear in Assistant
   Knowledge and improve a real web-chat and SMS answer without overriding
   structured hours, contact details, booking state, or owner guardrails.
5. Run a Settings rescan. Confirm changed and unchanged existing items default
   to **keep current**, newly found items default selected, and missing items
   are informational only. Change the same target in Settings from another tab
   and prove stale publish returns a refresh/conflict response rather than
   overwriting the newer edit.
6. Exercise partial crawl, provider failure/manual retry, cancellation, and
   daily-limit messaging. Confirm a manual retry resumes safely and receives a
   fresh six-minute budget.
7. Verify a non-canary business still uses the legacy onboarding scan and
   cannot start a richer Settings scan.

## Monitoring

Monitor content-free aggregates rather than website text, evidence excerpts,
or owner answers:

- scan counts and age grouped by `status`, `coverage`, and `error_code`;
- queued age, expired leases, heartbeat age, and exhausted attempts;
- pages discovered/succeeded/failed and Firecrawl credits used;
- time from `started_at` to `draft_completed_at` and from draft to publish;
- partial/insufficient coverage, retry, cancellation, conflict, and publish
  rates; and
- expired rows remaining in `website_scan_page_payloads` after the hourly
  purge window.

Stop broad rollout for a material rise in provider errors, stuck/expired
claims, payload-retention failures, unsupported draft claims, owner-edit
overwrites, AI context failures, or provider cost outside the reviewed limit.
Never inspect or export raw Markdown as routine monitoring evidence.

## Rollback

Set `RICHER_WEBSITE_SCAN_ENABLED=0` (or remove it) and remove the canary first.
This prevents new richer-scan mutations in the web UI while preserving approved
knowledge and manual onboarding. Owners can still cancel an existing run.

If provider work itself must stop, cancel open runs before pausing the worker.
A paused worker leaves durable leases to expire and does not erase work; resume
only after the incident is understood. Leave migration 067 and already
approved knowledge in place. The old application ignores the additive schema,
and dropping tables or deleting approved knowledge is not an emergency
rollback procedure.

After rollback, verify legacy `/api/scrape`, manual services/FAQs, chat, SMS,
booking, and Knowledge Gaps remain healthy. Re-enable with one exact canary
before attempting another broad rollout.

## Local verification

Run these from the repository root:

```sh
npx tsc --noEmit
npm test
npm run build
npm run test:db:local
```

The database command requires a working local Docker-compatible Supabase
runtime. A missing Docker socket is an environment limitation, not a passing
database result; migration 067 must not be promoted without executing its
pgTAP assertions in a real PostgreSQL/Supabase environment.
