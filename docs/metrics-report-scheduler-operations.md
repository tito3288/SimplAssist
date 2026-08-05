# Monthly Metrics Report Scheduler Operations

## Authority and ownership

The production scheduler for monthly metrics reports is one cron-job.org job
named **SimplAssist Monthly Metrics Reports**. Railway hosts the application but
does not schedule this route. Bryan provisions and owns the external job and
its Railway environment variable after the application deployment is ready.

Do not add a second scheduler. Database snapshot uniqueness, token-fenced
delivery claims, and stable provider idempotency keys make overlap safe, but a
duplicate scheduler still adds provider traffic and operational noise.

No secret value belongs in this repository, scheduler screenshots, logs, or
support notes.

## Required production configuration

| Setting                   | Required value                                              |
| ------------------------- | ----------------------------------------------------------- |
| Provider                  | cron-job.org                                                |
| Job title                 | `SimplAssist Monthly Metrics Reports`                       |
| URL                       | `https://simplassist.com/api/admin/metrics/reports/run-due` |
| Request method            | `POST`                                                      |
| Request body              | Empty                                                       |
| Authentication            | `Authorization: Bearer <METRICS_REPORTS_CRON_SECRET>`       |
| Basic HTTP authentication | Disabled                                                    |
| Schedule                  | Daily, crontab `0 4 * * *`                                  |
| Job time zone             | `UTC`                                                       |
| Client timeout            | 30 seconds                                                  |
| Save responses in history | Enabled                                                     |
| Treat HTTP 3xx as success | Disabled                                                    |
| Failure notification      | Enabled after the first HTTP-level failure                  |

Use the dedicated `METRICS_REPORTS_CRON_SECRET`. Do not reuse `CRON_SECRET`,
which protects account cleanup.

## Authentication and rollout

The route is fail-closed. It accepts a request only when Railway has a nonempty
`METRICS_REPORTS_CRON_SECRET` and the request header exactly matches `Bearer
<METRICS_REPORTS_CRON_SECRET>`. Missing configuration and mismatched requests
return HTTP 401 before any service-role query or email work.

Deploy in this order:

1. Apply migration 051 before deploying report application code.
2. Deploy the application with report configurations still disabled.
3. Add `METRICS_REPORTS_CRON_SECRET` to Railway without printing its value.
4. Create the single cron-job.org job and copy the same value into its custom
   `Authorization` header.
5. Save and review report configurations before enabling them.
6. Enable the scheduler only when production sending is approved.

## What each daily run does

The caller cannot choose a period, config, delivery, or batch size. The server
computes the previous completed UTC month and then:

1. Reconciles expired delivery leases. A claim that expired before provider
   start returns safely to pending; a send that expired after provider start
   becomes `needs_review` and is never retried automatically.
2. Builds at most 25 missing frozen snapshots for enabled, due configurations.
   The report and its frozen recipient deliveries are created atomically.
3. Resumes up to 20 oldest eligible pending deliveries across all frozen
   reports, including backlog belonging to a configuration later disabled.
4. Sends sequentially with at least 500 milliseconds between provider starts.
5. Stops claiming when the 20-second server budget, batch caps, or the
   16-second provider-start safety margin is reached. Remaining work stays
   durable for a later daily run.

The provider deadline is 15 seconds. The route's 20-second internal budget is
intentionally shorter than cron-job.org's 30-second client window, leaving time
to persist the final transition and return a response.

## Reading responses

Successful invocations return count-only JSON shaped like:

```json
{
  "period": "2026-07-01",
  "reports": {
    "created": 1,
    "existing": 2,
    "skipped": 0,
    "failed": 0,
    "remaining": 0
  },
  "deliveries": {
    "accepted": 2,
    "retryScheduled": 0,
    "failed": 0,
    "reviewNeeded": 0,
    "skipped": 0,
    "remaining": 0
  },
  "exhausted": {
    "reportBatch": false,
    "deliveryBatch": false,
    "timeBudget": false
  }
}
```

Interpret results as follows:

- `accepted` means Resend returned a provider message ID. It does not mean the
  mailbox received, opened, or read the message.
- A nonzero `remaining` count or any true `exhausted` flag is a normal partial,
  resumable run. The next sweep continues from durable state.
- `retryScheduled` means the provider proved it did not accept the request; the
  ledger schedules a later retry, up to the three-attempt limit.
- `reviewNeeded` means provider acceptance may have occurred. Do not resend the
  delivery until the provider account and ledger are reconciled.
- `failed` is terminal after three proven no-send attempts.
- HTTP 500 with `metrics_report_run_failed` means a fatal candidate query or
  lease-reconciliation step failed. Inspect sanitized Railway logs and rerun
  only after the failure is understood.
- HTTP 401 means the dedicated Railway and cron-job.org secrets are absent or
  do not match.

Responses and application logs intentionally contain no config IDs, report
IDs, delivery IDs, recipient addresses, subjects, bodies, snapshots, provider
objects, or secret values.

## Overlap, timeouts, and manual runs

Snapshot uniqueness makes concurrent builders converge on one frozen report.
Delivery claims use token-owned leases, and every durable provider attempt uses
the same `metrics-report-v1/<delivery-id>` idempotency key. These controls make
overlapping or repeated sweep requests safe without making them desirable.

A cron-job.org timeout does not prove server work stopped. Check the saved
response and sanitized Railway logs before running again. Pending work remains
durable; accepted and review-needed work is not automatically resent.

The cron-job.org **Test run** button is a real production send operation. It can
create the previous month's snapshots and email every due frozen recipient.
Use the settings-page test-send action for a one-address preview instead; that
action creates no report or delivery rows. Even there, an ambiguous result
requires checking Resend before sending another test.

## Routine verification

After deploying scheduler or sender changes:

1. Confirm migration 051 is applied and no app deployment relies on a newer
   report migration.
2. Confirm exactly one enabled metrics-report scheduler exists.
3. Compare URL, method, UTC schedule, timeout, and custom-header name with this
   document without revealing the value.
4. Confirm Railway has `METRICS_REPORTS_CRON_SECRET` configured.
5. Inspect the latest saved count-only response for partial work, failures, or
   review-needed outcomes.
6. Review `needs_review` deliveries against Resend before any manual recovery.

## Secret rotation

The route accepts one secret, so rotate between scheduled runs:

1. Generate a replacement through the approved secret-management process.
2. Update Railway's `METRICS_REPORTS_CRON_SECRET` and deploy or restart.
3. Immediately update only the cron-job.org `Authorization` header.
4. Verify the next deliberate invocation's status and count-only response.
5. Remove the old value from approved temporary transfer surfaces.

Requests during the narrow update window can return 401. Never weaken the
route's authentication to avoid that expected fail-closed behavior.
