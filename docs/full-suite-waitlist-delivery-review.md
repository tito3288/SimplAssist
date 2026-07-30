# Full Suite waitlist delivery review

Use this runbook when `/admin/waitlist` shows **Delivery review needed**, a
non-test send returns a nonzero review-needed count, or an admin request is
interrupted after sending starts.

## Before any launch send

1. In Railway, verify the web service has exactly one active replica.
2. Do not scale or redeploy the service while an admin test, single send, or
   bulk send is running.
3. Keep the admin page open until it returns the aggregate result. The send
   flow is synchronous and spaces Resend request starts by at least 500 ms.
4. If the pending volume could make one request approach Railway's HTTP
   request-duration limit, do not start the bulk send. Add a reviewed,
   resumable background-job or batching design first.

The send queue is shared by all admin sends in one server process. The
single-replica requirement makes that process-wide queue the deployment-wide
two-requests-per-second control. Scaling to multiple replicas requires a
distributed limiter before launch sends may resume.

## Why claims are preserved

Each non-test send claims its signup before contacting Resend. The claim is
completed only after Resend returns a non-empty email ID. Definite failures
release the claim for retry. A timeout, unknown provider error, malformed
provider response, or database completion failure preserves the claim because
the email may have been accepted.

Never auto-expire, overwrite, or release an ambiguous claim based only on its
age. The stable Resend idempotency key is:

```text
full-suite-launch-v1/<signup-id>
```

Resend idempotency lasts 24 hours, but the database claim remains the durable
protection after that window.

## Ambiguous admin tests

Admin tests do not claim or update waitlist rows. If a test returns a
review-needed result, inspect the Resend logs using the signed-in admin
recipient and send time. Do not assume that the preview failed: every test
uses a new idempotency key, so immediately sending another test can produce a
duplicate. Re-test only after confirming a definite no-send outcome or
intentionally accepting a possible duplicate preview.

## Review procedure

1. Stop further waitlist sends and refresh `/admin/waitlist`.
2. In a controlled database session, list claimed, unnotified rows. Do not
   copy email addresses or claim tokens into chat, tickets, application logs,
   or screenshots.

   ```sql
   SELECT
     id,
     email,
     created_at,
     unsubscribed_at,
     launch_send_claim_token,
     launch_send_claimed_at
   FROM public.waitlist_signups
   WHERE notified_at IS NULL
     AND launch_send_claim_token IS NOT NULL
   ORDER BY launch_send_claimed_at ASC, id ASC;
   ```

3. For each row, inspect the Resend logs using the recipient and claim time.
   Confirm whether Resend accepted the message and record the provider email
   ID in the private launch record.
4. Resolve exactly one of these outcomes:
   - **Accepted:** complete the matching claim.
   - **Definite no-send:** release the matching claim, then retry only if the
     row is still pending and subscribed.
   - **Uncertain:** leave the claim unchanged and escalate for additional
     provider-log review. Do not retry.
5. Refresh `/admin/waitlist` and confirm the row's resulting status before
   reviewing the next claim.

## Complete a confirmed accepted send

Run the function with the exact row ID and its current claim token:

```sql
SELECT public.complete_waitlist_launch_send(
  '<signup-id>'::uuid,
  '<claim-token>'::uuid
);
```

The result must be `true`. A `false` result means the row or claim changed;
stop and re-read it instead of forcing an update. Completion records
`notified_at` and clears the claim. This is correct even if the recipient
unsubscribed after Resend accepted the launch email.

## Release a confirmed definite no-send

Run the function with the exact row ID and its current claim token:

```sql
SELECT public.release_waitlist_launch_send(
  '<signup-id>'::uuid,
  '<claim-token>'::uuid
);
```

The result must be `true`. A `false` result means the row or claim changed;
stop and re-read it. After release, confirm `notified_at IS NULL`,
`unsubscribed_at IS NULL`, and both claim fields are null before retrying.
Never retry or include an unsubscribed row.

## Interrupted admin requests

An interrupted browser or Railway request does not prove that a provider send
failed. Wait for in-flight work to settle, refresh the page, and review every
remaining claim using the procedure above. Do not submit another bulk send
until all ambiguous claims have been classified or intentionally left for
later review.
