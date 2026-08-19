# Chat Only Phase 3 metering and widget security

Execution and deployment contract for the 200-reply allowance, public widget
boundary, calendar mutation controls, and quota fallback.

Date: 2026-08-18

## Phase boundary

Phase 3 makes the Chat Only runtime safe to canary, but it does not enable
direct or partner acquisition, create hosted Stripe objects, apply hosted
database migrations, change Railway variables, deploy, or call Telnyx. Both
Chat Only rollout switches remain unset or `0` until the full phase acceptance
pass and a separately approved hosted preflight are complete.

Existing Starter, Growth, and Full behavior remains protected. The new reply
cap applies only to Chat Only; Growth and Full retain their established
uncapped web-chat behavior, Starter remains ineligible for web chat, and SMS
usage is never pooled with the Chat Only allowance.

## Authoritative reply contract

One allowance unit means one durable, customer-visible assistant message for
one live public web-chat inbound. It does not mean a conversation, visitor
session, Anthropic HTTP call, tool call, token, preview response, error, or
non-persisted fallback.

- A browser-generated UUID and request fingerprint identify one immutable
  inbound request. Retrying the same request returns the already persisted
  assistant message and never calls Anthropic again.
- The customer message is durably persisted once before a reply reservation.
  Reservation is atomic under the business lock, so concurrent requests at
  199 completed replies cannot create a 201st reply.
- Chat Only has exactly 200 replies in its authoritative period. Active and
  trialing direct accounts require the current synchronized Stripe period;
  partner and legacy override accounts use a UTC calendar month. A past-due
  direct account may use only the remaining balance in its last structurally
  valid Stripe period and receives no virtual renewal while delinquent.
  Missing or inverted Chat Only periods fail closed. Growth and Full remain
  uncapped and cannot lose web-chat service merely because period telemetry is
  stale.
- A reservation is finalized only after an assistant row is stored with the
  current opaque attempt proof. The runtime attempts finalization after that
  insert and release after a pre-commit failure. Those RPC waits are not a
  promise of immediate completion: an exact retry reconciles linked assistant
  proof, while the ten-minute reservation TTL and minutely database reaper
  reconcile crash-window assistants or expire work that has no assistant.
- Authenticated same-business preview is excluded from customer allowance but
  remains separately rate- and concurrency-limited. Preview provider calls are
  eligible for cost accounting.
- Each explicit Anthropic HTTP attempt launches one stable-key, content-free
  accounting write with business, model, provider request ID when available,
  token/cache counts, latency, stop reason, tool counts, success state, and a
  bounded error code. The engine waits at most two seconds, capped by the turn
  deadline, then drains late settlement. Accounting failure or timeout is
  logged without content and never changes the provider outcome or causes a
  retry, but it means a provider-call row is best effort rather than guaranteed
  during a database outage. No prompt, transcript, contact data, tool input,
  tool output, email, phone, provider request configuration, or response body
  is stored or logged.
- Hidden SDK retries are disabled. Each explicit attempt has at most a
  60-second timeout. The engine allows up to two bounded retries for HTTP
  `408`, `409`, `429`, provider `5xx`, and Anthropic connection errors, with a
  unique call index and accounting key for every attempt. Other `4xx` failures
  are not retried.
- Model and tool-loop waiting has a four-minute whole-turn deadline, keeping
  valid work inside the five-minute widget capacity lease and ten-minute reply
  reservation. A timed-out external tool mutation may still settle after the
  engine stops awaiting it; it cannot resume the turn, persist an assistant, or
  trigger another model call. Stable booking/provider identities and durable
  reconciliation, rather than assumed cancellation, protect that ambiguity.

The current-period read RPC is side-effect free. Direct Chat Only Billing shows
completed replies, the 200-reply allowance, remaining replies, and the reset
date without creating a usage row merely because the page was viewed.

## Public widget boundary

Each widget configuration carries up to ten exact canonical ASCII hostnames.
There are no wildcards. Schemes, paths, ports, credentials, trailing dots, and
duplicate or malformed hostnames are rejected. An active widget must have at
least one hostname; an empty allowlist always fails closed.

Public config, chat, end, and offline-lead requests require an exact normalized
HTTP(S) browser origin. Successful responses echo only that approved origin,
send `Vary: Origin`, and are not cached. Config mints a five-minute HMAC session
token bound to the business, full origin, session ID, random nonce, issue time,
and expiry. Chat, end, and lead endpoints verify the complete binding.

Authenticated preview remains a separate same-origin, same-business path. It
can preview an inactive widget, but it never bypasses authentication, traffic
controls, entitlement checks, or operational service controls.

Layered controls include:

- bounded JSON bodies and strict query/body schemas;
- message, session, contact, UUID, and control-character validation;
- a business-independent, bounded per-instance ingress prefilter followed by a
  shared service-only per-network and global ingress counter before token,
  workspace, widget-config, or business reads; its per-minute network/global
  limits are config 120/10,000, chat 60/3,000, end 30/3,000, and lead
  20/1,000;
- shared per-network, session, origin, and business minute buckets;
- Chat Only daily ceilings of 30 requests per session, 60 per network, and 120
  across the business; authenticated preview uses separate 15/30/200 daily
  session/network/business ceilings;
- Growth and Full do not inherit Chat Only's low session/network caps and keep
  only the 2,500-request daily business emergency ceiling in addition to the
  shared minute and concurrency controls;
- one live chat execution per session and eight per business;
- five-minute shared leases with idempotent release plus five-minute local
  lease expiry so an abandoned request cannot strand one app instance; and
- generic `429`, `403`, and `503` responses that reveal no plan, allowance,
  usage-period, or account details.

The network bucket deliberately hashes the trusted rightmost valid
`X-Forwarded-For` address (or `X-Real-IP` when no forwarded chain exists).
Before a hosted canary, verify Railway overwrites/appends that header as
expected. If all visitors collapse to one ingress address, keep acquisition
off and revise the trusted-proxy rule before launch.

Application limits cannot stop a distributed botnet rotating source IPs across
many edge regions. Managed edge/WAF rate limiting for `/api/widget/config`,
`/api/widget/chat`, `/api/widget/end`, and `/api/widget/lead` is therefore a
mandatory hosted launch gate before enabling either direct or partner Chat
Only acquisition flag. Keep limits generic and do not key edge decisions on a
caller-supplied business ID.

## Quota and offline-lead behavior

At the 200-reply boundary the public response does not tell a visitor that the
owner exhausted a quota. The widget preserves the visitor's typed message,
keeps the conversation visible, disables further AI generation for that
attempt, and offers a neutral name/email follow-up form.

The lead endpoint accepts only a valid signed session and an existing durable
customer message from that same business, session, and exact content proof.
It stores only a content-free submission proof and atomically fills missing
contact identity; it does not duplicate the message or store another copy of
its content. Lead IDs are retry-stable, conflicting reuse fails closed, and
rate limits are lower than chat limits. The database rechecks active widget,
current web-chat billing authority, account suspension, and manual AI pause
under locks immediately before the write. Quota exhaustion itself remains an
allowed reason to capture the lead.

## AI calendar booking policy

Calendar tools remain available only when the plan and existing operational
controls permit direct booking. Phase 3 additionally enforces:

- default 60-minute lead time and 90-day future horizon;
- duration from 30 through 240 minutes in 30-minute increments;
- slot alignment and same-day configured business hours;
- one uniquely resolved active catalog service, with its UUID stored in the
  Google event private properties;
- invitations only to the normalized email already linked to the persisted
  contact;
- final Google free/busy overlap validation immediately before event creation;
- an atomic local pending/confirmed slot reservation, serialized per business
  against dashboard provider operations, so two workers cannot both proceed
  toward the same Google calendar slot;
- business-first provider confirmation that rejects a Google-returned time
  shift into another active local slot while preserving confirmed retry
  idempotency;
- at most one availability query and one booking attempt per inbound turn;
- no more than six total tool executions per turn; and
- recovery of confirmed or pending provider evidence before mutable policy
  checks, preserving the existing booking idempotency contract.

`CALENDAR_BOOKING_MIN_LEAD_MINUTES` and
`CALENDAR_BOOKING_MAX_HORIZON_DAYS` are optional server-only overrides. Their
accepted ranges and fail-closed behavior are documented in the README.

## Durable calendar provider operations

Dashboard calendar create, update, and delete requests now use a durable
provider-operation ledger. Its live rows serialize under the same
business-first mutex and slot checks as AI `calendar_bookings`. The browser
supplies a stable UUID `operationId`; the server binds it to an immutable
request fingerprint. Create uses a deterministic Google event ID, while
create/update events carry the private `simplassistCalendarOperationId` marker.
Reusing an operation ID for a different target or request fails as an
idempotency conflict.

The service-owned lifecycle is:

- `holding`: the database owns the target and, for create/update, the desired
  slot. A worker has a five-minute claim. `provider_submission_started_at` is
  written immediately before the Google mutation; after that fence elapsed
  time can never prove the mutation absent.
- `provider_applied`: exact content-free Google evidence is durable, but the
  local booking/operation transition still needs finalization. This state keeps
  target and any desired-slot authority and can be finalized without another
  provider read.
- `finalized`: provider evidence and the local state change are complete.
- `failed`: definitive non-application, verified provider absence, or a worker
  that never crossed the submission fence released the authority. Provider
  evidence is retained when one existed.

Live `holding` and `provider_applied` operations serialize the same provider
target and, where time-bounded, overlapping slots under the business-first
mutex. They do not expire merely because a timestamp elapsed. Worker and
reconciliation claims are five-minute leases; the
`reconciliation_review_after_at` timestamp is a 48-hour
monitoring/review SLA only, not authority expiry. An overdue unresolved row
must remain fail closed until exact provider evidence makes it terminal.

The maintenance reconciler claims at most two operations per authenticated
cleanup heartbeat. It never originates a provider mutation or duplicate
notification. It can finalize already-applied evidence, retire an expired
never-submitted hold without a provider read, or perform one no-hidden-retry
Google event read to prove the exact post-submission outcome. Missing
credentials, timeouts, malformed evidence, or indeterminate reads remain
deferred for a later heartbeat.

Google credentials carry a database-owned `credential_version`. OAuth
replacement and explicit refresh persistence serialize on the business mutex
and rotate that generation; a late refresh is persisted only by compare and
swap against the exact version it loaded. Only a structured Google
`400 invalid_grant` may conditionally delete that unchanged generation.
Disconnect, invalid-credential deletion, account cleanup, and an OAuth switch
to a different Google account or calendar are blocked while a pending AI
booking or unresolved provider operation needs that namespace. Same-namespace
reauthorization remains available for recovery.

A soft-deleted account keeps its owner/auth linkage and Google namespace during
the established 60-day grace period. After the scheduled hard-cleanup date,
unresolved provider work still delays permanent scrub; it is not bypassed.
Terminal provider-operation rows are removed only as part of the guarded atomic
cleanup transition.

## Database and operations

Migration 060 creates the reply period, logical reservation, attempt history,
and Anthropic-call ledgers plus service-only reserve/finalize/release/read and
maintenance functions. A named `pg_cron` job reconciles persisted crash-window
assistants and expires abandoned reservations. Transcript/contact deletion
remains compatible while content-free usage history is retained.

Migration 061 adds hostname storage and validation, offline-lead proof, the
business-independent ingress buckets, business-scoped shared traffic buckets,
and concurrency leases. Each new ingress request opportunistically deletes
content-free ingress rows older than ten minutes; this is not a hard retention
timer when no traffic arrives. Rows store a hash of the server-derived network
HMAC, never a raw address or business identifier. Business-scoped bucket and
lease cleanup is likewise opportunistic. Before applying it to hosted data,
inventory every active widget. The migration derives one hostname only from a
canonical `businesses.website_url` and intentionally aborts with
`active_widget_hostname_allowlist_required` rather than silently deactivate or
widen an unidentifiable install.

Migration 062 adds the active-slot lookup index and upgrades the existing
service-only calendar reservation RPC to reject overlapping pending or
confirmed work while holding the business lock. Before applying it, inventory
overlapping active bookings by business and Google calendar. The migration
intentionally aborts with `calendar_booking_active_slot_conflict`; reconcile
those bookings against Google before changing local lifecycle state and
retrying the migration.

Migration 063 adds the private provider-operation ledger, five-minute worker
and reconciliation claims, permanent live target/slot holds, content-free
provider evidence, the 48-hour review SLA, credential-generation compare and
swap, token-delete/cleanup guards, and service-only lifecycle RPCs. The table
is RLS-protected: `service_role` may select it, while all mutations go through
the reviewed RPCs.

Before applying 063, block and drain old dashboard calendar mutations, AI
direct booking, OAuth completion/refresh, and disconnect traffic. Its locked
preflight intentionally aborts with the named error when either condition
exists:

- `calendar_provider_operations_preflight_pending_booking_without_token`: a
  legacy `pending` `calendar_bookings` row has no Google token; or
- `calendar_provider_operations_preflight_invalid_provider_namespace`: a
  Google token lacks a valid normalized `google_email` or nonblank selected
  `calendar_id` namespace.

Neither condition is auto-failed or guessed. Inventory the exact affected rows
with service-only SQL, restore/reconnect the verified same provider namespace,
reconcile the provider state manually, and rerun 063. Do not edit local
lifecycle state merely to make the preflight pass. Keep calendar traffic
closed while applying 063 and deploying the compatible application and
reconciler; reopen only after the new paths and heartbeat are verified. A
rolling old calendar writer is not supported across this boundary.

Operational monitoring must use content-free facts only. At minimum alert on:

- leaked or repeatedly expired reply reservations;
- reply denials and unusually rapid allowance consumption;
- Anthropic error rate, token volume, latency, and accounting failures;
- widget origin, rate, daily-ceiling, and concurrency denials;
- Google `403`/`429`, overlap rejection, booking failure, credential-CAS
  contention, nested cleanup-heartbeat deferred/failure counts, and provider
  reconciliation backlog; and
- every unresolved provider operation whose 48-hour review SLA has elapsed,
  without treating that timestamp as permission to release its target or slot.

Never log or export prompt text, transcript content, name, email, phone,
calendar tool arguments, or provider response bodies as observability data.

## Required hosted configuration

Before a canary, configure one server-only `WIDGET_TOKEN_SECRET` containing at
least 32 cryptographically random bytes and keep it identical on every app
instance. Rotation immediately invalidates sessions signed by the old value
(whose normal maximum life is five minutes) and changes the opaque traffic-key
namespace, effectively starting new buckets. Rotate every Railway instance
together and monitor the resulting traffic reset; never expose the secret to
the browser.

Also verify all of the following before launch:

- every active widget has one through ten exact canonical ASCII hostnames; no
  wildcard, scheme, path, port, credentials, trailing dot, or blank allowlist;
- managed edge/WAF limits cover `/api/widget/config`, `/api/widget/chat`,
  `/api/widget/end`, and `/api/widget/lead`, with Railway's trusted
  `X-Forwarded-For` behavior verified and no caller-supplied business key;
- actual widget responses remain `Cache-Control: no-store` and
  `Vary: Origin`; only OPTIONS preflight may advertise a 600-second CORS cache;
- `GOOGLE_CLIENT_ID`, server-only `GOOGLE_CLIENT_SECRET`, and the exact
  canonical `GOOGLE_REDIRECT_URI` are configured on Railway;
- Railway's server-only `CRON_SECRET` exactly matches the single external
  cron-job.org account-cleanup job; and
- the Chat Only Stripe Price and pinned Billing Portal configuration still
  satisfy the Phase 2 contract.

Both acquisition flags stay unset or `0` throughout configuration, migration,
calendar drain, smoke testing, and canary preparation. They gate only new
direct sales and partner assignment; they do not disable the 060-063 runtime
changes for existing plans.

For deployment, block and drain old calendar traffic first. Run the 061 active
widget inventory, the 062 active-booking overlap inventory, and both 063 legacy
provider-namespace preflights. Apply every pending migration through 063 in
numeric order, then deploy the compatible Railway application and calendar
reconciler while calendar traffic remains closed. Verify OAuth, credential
refresh, provider-operation recovery, and the authenticated cleanup heartbeat
before reopening calendar traffic. Never leave old calendar writers serving
alongside 063.

The database must have exactly these two `pg_cron` jobs:

- `cleanup_processed_webhook_events` at `0 3 * * *`, deleting webhook
  idempotency rows older than seven days; and
- `reap_expired_ai_reply_reservations` every minute, processing at most 500
  linked crash-window or expired reply reservations per invocation.

Migration 063 adds no database cron. Calendar provider reconciliation is the
prelude of the separately authenticated external account-cleanup heartbeat.
That route has a 30-second hosted timeout, an eight-second shared calendar
prelude, a five-second provider-operation sub-budget, and then gives the
remaining prelude time to legacy booking recovery. Its exact production
schedule and nested response fields are documented in
[the account-cleanup scheduler runbook](account-cleanup-scheduler-operations.md).

The previously served embed script may remain cached for five minutes and does
not send the newly required config `sessionId`. For the first Phase 3 deploy,
purge the hosted/CDN copy of `/widget/embed.js` and wait until any prior
five-minute cache window has elapsed before widget smoke testing. The new
script remains publicly loadable but uses `public, no-cache, must-revalidate`
so later security-contract changes are revalidated instead of silently held
for another five minutes. Do not widen the config request schema to accept the
old script.

This document records the release contract only. It does not authorize a
hosted database migration, traffic drain, Railway variable change, WAF/CDN
change, scheduler edit or test run, deployment, Stripe/Telnyx action, cache
purge, or rollout-flag change.

## Phase 3 acceptance gates

Phase 3 is complete only when all of the following are true:

1. Fresh local replay applies every migration through 063 and the full pgTAP
   suite passes, including real 199/200 reply, widget-traffic,
   overlapping-calendar-slot, provider-operation, credential-CAS, cleanup,
   OAuth-namespace, and target/slot serialization races. The 063 main pgTAP
   contract has 147 assertions and its disposable-local dblink concurrency
   contract has 87.
2. Full Vitest, TypeScript, ESLint, production build, and diff checks pass.
3. Exact retries produce one inbound, one assistant, and one reply unit; failed
   provider work consumes no unit; a persisted crash-window assistant is
   reconciled; and concurrent boundary requests never exceed 200.
4. Public origins, signed bindings, body limits, rate limits, concurrency,
   preview isolation, quota lead mode, and durable lead retries pass route and
   embed tests.
5. Calendar past/horizon/duration/alignment/service/email/hours/overlap,
   provider-idempotency, create/update/delete lifecycle, five-minute claim,
   48-hour SLA-not-expiry, reconciler, disconnect, refresh CAS, OAuth namespace,
   and account-cleanup tests pass.
6. Direct Chat Billing accurately displays 0/200, warning, exhausted, reset,
   frozen past-due renewal, and unavailable states without changing SMS or
   partner billing behavior.
7. SimplAssist and Alpha Dog branding, Google OAuth, conversations, existing
   plans, SMS checkout/onboarding, and every zero-Telnyx Chat assertion remain
   green.
8. An independent adversarial review finds no release blocker.

After local acceptance, commit and push this phase to the feature branch as a
backup. Do not merge, deploy, apply hosted migrations, create the Stripe Price,
or enable either rollout switch without a separate user-approved release step.
