# Account Cleanup Scheduler Operations

## Authority and ownership

The production account-cleanup scheduler is the cron-job.org job named
**SimplAssist Account Cleanup**. It is the only authoritative scheduler for
this route.

Railway hosts the application but does not schedule account cleanup. Do not add
a Railway cron service or a second scheduler: overlapping runs are guarded by
database claims, but duplicate schedulers would still add noise and operational
risk.

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

For each expired soft-deleted business, the route performs the durable sequence:

1. Claim the business with the `cleanup_attempted_at` compare-and-swap guard.
2. Run the atomic database scrub, preserving auth and Stripe cancellation
   linkage.
3. Reconcile the exact durable Stripe cancellation generation.
4. Delete the linked auth user; an already-missing user (404) counts as done.
5. Complete cleanup only after cancellation is proven applied, clearing the
   remaining external-work linkage.

Pending transient Stripe failures remain durable for a later run. A blocked
Stripe action is not bypassed: investigate its recorded error and use a
separately reviewed recovery procedure rather than deleting linkage manually.

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
  "failed_ids": ["<business-id>"]
}
```

cron-job.org sees this as an HTTP-level success, so its failure notification
does not fire. Inspect the saved response body and Railway logs whenever
validating a cleanup run. `failed_ids` contains internal business UUIDs only;
do not copy customer data into operational notes.

Common outcomes:

- HTTP 401: Railway and cron-job.org secrets are absent or do not match.
- HTTP 500: the route could not query expired accounts or failed before it
  could produce a batch result.
- HTTP 200 with `success: true`: every claimed business completed, or there was
  no eligible work.
- HTTP 200 with `success: false`: one or more businesses retained their durable
  linkage and must be investigated; the next daily run retries retryable work.
- Scheduler timeout: inspect Railway logs before manually rerunning. The route
  is designed for idempotent retries, but a timed-out HTTP client does not prove
  that server-side work stopped.

## Routine verification

After a cleanup-route or billing-deletion deployment:

1. Confirm there is still exactly one enabled cleanup scheduler and that it is
   the cron-job.org job named above.
2. Compare the URL, method, UTC schedule, timeout, and custom-header name with
   this document. Do not reveal the header value.
3. Confirm Railway has `CRON_SECRET` configured without printing it.
4. Review the latest cron-job.org execution history and saved response body.
5. Confirm Railway logs agree with the response counts and show no retained
   blocked action requiring intervention.

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
