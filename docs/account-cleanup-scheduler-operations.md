# Account Cleanup Scheduler Operations

## Authority and ownership

The production account-cleanup scheduler is the cron-job.org job named
**SimplAssist Account Cleanup**. It is the only authoritative scheduler for
this route.

Railway hosts the application but does not schedule account cleanup. Do not add
a Railway cron service or a second scheduler: overlapping runs are guarded by
database claims, but duplicate schedulers would still add noise and operational
risk.

This authenticated HTTP heartbeat is not a Supabase `pg_cron` job. The database
has exactly two independent jobs: `cleanup_processed_webhook_events` daily at
`0 3 * * *`, and `reap_expired_ai_reply_reservations` every minute. Migration
063 adds no database cron; its provider reconciler runs only as the prelude of
the external account-cleanup request described here.

This configuration was verified read-only against the live cron-job.org job on
2026-07-14. No secret value is recorded here.

## Current production configuration

| Setting | Configured value |
| --- | --- |
| Provider | cron-job.org |
| Job title | `SimplAssist Account Cleanup` |
| Enabled | Yes |
| URL | `https://simplassist.com/api/account/cleanup` |
| Request method | `POST` |
| Request body | Empty |
| Authentication | Custom `Authorization` header with value `Bearer <CRON_SECRET>` |
| Basic HTTP authentication | Disabled |
| Schedule | Daily, crontab `0 3 * * *` |
| Job time zone | `UTC` |
| Timeout | 30 seconds |
| Save responses in history | Enabled |
| Treat HTTP 3xx as success | Disabled |
| Failure notification | Enabled after the first HTTP-level failure |

The job is commonly described as running “daily at 11 PM.” The exact scheduler
configuration is **03:00 UTC**, not 23:00 in an America/* time zone. During the
July verification, cron-job.org's browser-local display rendered 03:00 UTC as
11:00 PM. That display shifts with daylight-saving time: a fixed 03:00 UTC run
is 10:00 PM in a UTC-5 local zone. Do not describe this as a fixed 11:00 PM
local-time guarantee unless the job itself is changed to an appropriate IANA
time zone and 23:00 schedule.

## Authentication contract

The route accepts a request only when both conditions hold:

- Railway has a non-empty `CRON_SECRET` environment variable.
- The cron-job.org custom header is exactly `Authorization: Bearer
  <CRON_SECRET>`, using the same value.

Never put the secret in this repository, command output, screenshots, tickets,
or the project log. The visible header value in cron-job.org is a production
secret.

An absent or mismatched value returns HTTP 401 and performs no cleanup.

## What a run does

Every authenticated run first performs bounded global maintenance, even when no
account has reached permanent-deletion eligibility:

1. Purge expired private Google OAuth attempts.
2. Reconcile calendar provider operations before any destructive cleanup. The
   worker claims at most two `holding` or `provider_applied` rows. Worker and
   reconciliation claims last five minutes. A provider-applied row finalizes
   from durable evidence; an expired never-submitted row can fail without a
   provider read; post-submission ambiguity gets at most one read-only Google
   event lookup with hidden retries disabled. The worker never originates a
   provider mutation or duplicate notification.
3. Reconcile up to ten legacy stale `pending` AI booking rows, ordered fairly by
   prior reconciliation and claim time. Only claims at least five minutes old
   are eligible.

The hosted request has a 30-second timeout. Calendar maintenance shares an
eight-second route-level prelude: provider operations receive at most the first
five seconds, and legacy booking reconciliation receives only what remains.
The provider worker uses five-second credential and Google-read deadlines, but
the route-level five-second sub-budget remains authoritative. Timed-out late
promises are drained and their database transitions still serialize safely;
the HTTP response continues into account cleanup rather than waiting for them.

The route then retries durable grace-period Stripe pause work. For each expired
soft-deleted business, it performs this sequence:

1. Claim the business with the `cleanup_attempted_at` compare-and-swap guard.
2. Run the atomic database scrub, preserving auth and Stripe cancellation
   linkage.
3. Reconcile the exact durable Stripe cancellation generation.
4. Delete the linked auth user; an already-missing user (404) counts as done.
5. Complete cleanup only after cancellation is proven applied, clearing the
   remaining external-work linkage.

Account deletion has an established 60-day soft-delete grace period. The route
only selects rows whose `deletion_scheduled_for` has elapsed. Even then, a
`pending` calendar booking or provider operation still in `holding` or
`provider_applied` blocks the atomic cleanup. The owner/auth linkage, Google
credentials, booking linkage, and provider namespace remain intact so a later
heartbeat can reconcile them. This delay is intentional; never bypass it by
deleting credentials or rewriting lifecycle state. Once provider operations
are `finalized` or `failed`, their terminal rows are scrubbed by the guarded
cleanup transaction before the business tombstone is completed.

Pending transient Stripe failures remain durable for a later run. A blocked
Stripe action is not bypassed: investigate its recorded error and use a
separately reviewed recovery procedure rather than deleting linkage manually.

Calendar provider authority also remains durable even though individual claims
are five-minute leases. The `reconciliation_review_after_at` timestamp is a
48-hour alert/review SLA, not authority expiry. An overdue unresolved row
continues to hold its provider target and any slot until exact evidence makes
it terminal.

Overlapping runs are expected to skip a business already holding a fresh claim.
That skip is not a cleanup failure.

## Reading run results

Do not rely only on cron-job.org's green HTTP status.

The route returns HTTP 200 for a completed batch even when one or more
businesses failed inside that batch. In that case the saved JSON response has:

```json
{
  "success": false,
  "deleted_count": 0,
  "failed_count": 1,
  "failed_ids": ["<business-id>"],
  "calendar_provider_reconciliation": {
    "attempted": 2,
    "finalized": 1,
    "failed": 0,
    "deferred": 1
  },
  "calendar_booking_reconciliation": {
    "confirmed": 1,
    "notFound": 0,
    "failed": 0
  }
}
```

cron-job.org sees this as an HTTP-level success, so its failure notification
does not fire. Inspect the saved response body and Railway logs whenever
validating a cleanup run. `failed_ids` contains internal business UUIDs only;
do not copy customer data into operational notes.

`success`, `failed_count`, and `failed_ids` describe the per-business Stripe,
auth, and atomic-cleanup loop. They do not certify that calendar maintenance is
clear. Read both nested objects on every validation:

- provider `attempted` counts claimed rows; `finalized` and `failed` are
  terminal outcomes; `deferred` means the claim, credential/read, evidence, or
  route-level bounded wait did not reach a terminal result;
- booking `confirmed` and `notFound` are recovered provider outcomes, while
  `failed` includes claim/reconciliation errors and a route-level prelude
  failure; and
- a small or all-zero nested result is not proof of an empty queue. The
  provider batch is two, the legacy booking batch is ten, and the shared
  eight-second budget may stop before either query drains its backlog.

Common outcomes:

- HTTP 401: Railway and cron-job.org secrets are absent or do not match.
- HTTP 500: the route could not query expired accounts or failed before it
  could produce a batch result.
- HTTP 200 with `success: true`: every claimed business completed, or there was
  no eligible per-business work; still inspect both calendar objects.
- HTTP 200 with `success: false`: one or more businesses retained their durable
  linkage and must be investigated; the next daily run retries retryable work.
- Scheduler timeout: inspect Railway logs before manually rerunning. The route
  is designed for idempotent retries, but a timed-out HTTP client does not prove
  that server-side work stopped.
- Nonzero provider `deferred` or booking `failed`: inspect the corresponding
  Railway content-free error category and durable queue. Do not infer provider
  absence, delete a token, or release a target/slot from elapsed time alone.

## Routine verification

After a cleanup-route or billing-deletion deployment:

1. Confirm there is still exactly one enabled cleanup scheduler and that it is
   the cron-job.org job named above.
2. Compare the URL, method, UTC schedule, timeout, and custom-header name with
   this document. Do not reveal the header value.
3. Confirm Railway has `CRON_SECRET` configured without printing it.
4. Review the latest cron-job.org execution history and saved response body.
5. Confirm Railway logs agree with the top-level and both nested calendar
   response counts.
6. Query content-free operational state for provider backlog, repeated
   deferrals, pending legacy bookings, and any unresolved provider row past its
   48-hour review SLA. The SLA is an alert, never an auto-release instruction.
7. Confirm Supabase still has exactly the two expected database jobs:
   `cleanup_processed_webhook_events` daily at 03:00 UTC and
   `reap_expired_ai_reply_reservations` every minute. Do not add a third job for
   calendar reconciliation.
8. Confirm no retained Stripe block, provider ambiguity, credential-namespace
   block, or account-cleanup failure requires separately reviewed intervention.

The cron-job.org **Test run** button invokes the real production cleanup route.
It may permanently scrub accounts whose grace period has expired. Use it only
as a deliberate production operation after reviewing eligible work; it is not
a harmless connectivity check.

## Secret rotation

The route accepts one secret, so rotation has no dual-secret overlap window.
Perform rotation between scheduled runs:

1. Generate the replacement secret through the approved secret-management
   process; do not save it in the repo.
2. Update Railway's `CRON_SECRET` and deploy/restart the application.
3. Immediately replace only the cron-job.org `Authorization` header value with
   `Bearer <new-secret>` and save the job.
4. Verify the next deliberate execution's HTTP status and saved JSON body.
5. Remove the old value from any approved temporary secret-transfer surface.

A request during steps 2–3 can return 401. Do not weaken the route to avoid
that narrow rotation window.

## Schedule changes

Any schedule or provider change is a production operations change and requires
review. Update this document and `docs/PROJECT_LOG.md` in the same PR.

If the intended requirement becomes “11:00 PM local time year-round,” change
the cron-job.org job's individual time zone and hour explicitly. Do not add an
offset-based seasonal workaround and do not add Railway as a second scheduler.
