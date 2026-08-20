# Proactive Widget Rollout and Operations

This runbook covers the proactive website-chat invitation introduced by
migrations 065 and 066. It is the current operator contract for configuration,
deployment, rehearsal, broad rollout, monitoring, and rollback. It does not
authorize a hosted migration, Cloudflare edit, Railway variable change, or
deployment by itself; each hosted action still requires the normal explicit
release approval.

## Visitor behavior

The saved welcome message can reveal automatically when both the owner
preference and a server-only rollout authority are enabled.

- Desktop waits at least five seconds. It reveals after eight active seconds,
  or after the visitor reaches 30% scroll once the five-second minimum has
  elapsed.
- Mobile waits at least eight seconds. It reveals after twelve active seconds,
  or after the visitor reaches 40% scroll once the eight-second minimum has
  elapsed.
- Time spent while the page is hidden does not count. A visitor typing into
  another field or using another modal is not interrupted; the widget retries
  only after that obstruction clears.
- An automatic reveal never focuses the input or opens the mobile keyboard.
- The mobile layout applies at widths up to 600px and also on landscape-like
  coarse-pointer viewports no taller than 500px and no wider than 950px. It
  opens as a compact bottom sheet at roughly 48% of the usable visual viewport.
  Intentional interaction expands it to roughly 78%. Only a severely
  constrained visual viewport uses the full-screen fallback.
- The invitation finishes after one reveal attempt per visit. A successful
  reveal is suppressed for 24 hours in that browser. An explicit dismissal is
  suppressed for seven days. The launcher remains available for manual use.
- Reduced-motion preferences disable widget animation.

The dashboard Website Chat Widget page exposes **Automatically greet website
visitors**, which defaults on. Turning it off preserves the launcher and manual
chat. The Desktop and Mobile preview controls reveal the invitation
immediately; preview does not wait for production timers and does not write
public telemetry.

## Privacy and AI boundary

An automatic reveal renders the already-saved welcome message. It does not
submit a visitor message, call Anthropic, consume an included AI reply, create
a contact, or create a conversation. Those product and billing effects begin
only after a visitor deliberately sends a message or chooses a quick reply.

The public widget does make its normal configuration/token request. Migration
066 also permits content-free funnel telemetry: event type, trigger source,
mobile/desktop bucket, prompt version, business ID, timestamp, and a
server-keyed session HMAC. It accepts no message, contact, page URL, or network
address. Rows become purge-eligible after 90 days and the dedicated 03:20 UTC
database job removes them on its next daily run, so normal retention is less
than roughly 91 days rather than a real-time 90-day deletion guarantee.
Telemetry is best effort and must never block chat.

## Rollout authority

The owner preference alone does not authorize public automatic opening. The
public value is:

`saved owner preference AND (exact broad flag OR exact business canary)`

The two server-only Railway variables are:

- `WIDGET_PROACTIVE_INVITATIONS_ENABLED`: only exact `1` enables the feature
  broadly. Unset, `0`, and truthy-looking variants fail closed.
- `WIDGET_PROACTIVE_INVITATIONS_CANARY_BUSINESS_ID`: one canonical business
  UUID for a public rehearsal while the broad flag remains off. Whitespace,
  lists, wildcards, and malformed UUIDs fail closed.

Never create `NEXT_PUBLIC_` copies. Preview may reflect the saved owner
preference while public delivery remains off. SMS Only is unaffected because
it has no website widget entitlement.

## Five-path edge boundary

All public widget API traffic uses the canonical Cloudflare-proxied application
origin, including when a connected partner origin serves the embed script. The
five exact protected paths are:

- `/api/widget/config`;
- `/api/widget/chat`;
- `/api/widget/end`;
- `/api/widget/lead`; and
- `/api/widget/telemetry`.

Before the proactive application deploy, expand both the Cloudflare request
header transform and the managed widget WAF/rate rule from the former four
paths to all five. On every method used by those paths, including OPTIONS,
Cloudflare must set/overwrite `x-simplassist-widget-edge-origin` with the value
stored only in Railway as `WIDGET_EDGE_ORIGIN_SECRET`. A caller-supplied copy
must not survive. Keep the coarse edge rule generic; never trust a
caller-supplied business ID for an edge decision.

Retain evidence that canonical calls succeed and the same requests through
Railway's generated origin and any directly reachable Railway custom-domain
target fail before database or provider work when the private marker is
absent. The application still enforces the customer hostname allowlist,
short-lived signed widget token, operational/entitlement checks, and shared
traffic limits behind this edge proof.

## CSP and API origin

A customer site with Content Security Policy must allow the exact embed origin
in `script-src` and `https://simplassist.com` in `connect-src`. A connected
partner may serve its branded embed script, but the public configuration,
chat, end, lead, and telemetry calls still go to the canonical SimplAssist API
origin. Never add a Railway origin to customer CSP as a workaround.

The current embed injects its widget styles into the host page. Test a strict
CSP site in its actual browser policy before rollout and make only the
owner-approved, site-specific policy adjustment required for the widget; do
not weaken CSP with broad wildcards. Authenticated dashboard preview is a
separate same-origin, workspace-authorized path.

## Exact database reports

The Phase 4 pre-report is a historical pre-064 artifact and must not be used
for this rollout. First independently confirm that the linked Supabase project
is the reviewed production project `inmgpkurctttsofpywuz`. Then run this exact
secret-safe linked-CLI command from the repository root before migration 065:

```sh
npx supabase db query --linked --project-ref inmgpkurctttsofpywuz --file supabase/snippets/proactive-widget-065-066-pre-migration-report.sql
```

Every `proactive_pre_migration` row must be `PASS`. The report is a repeatable-
read, read-only snapshot and emits content-free aggregate counts only. It
requires the exact contiguous tip 064, the pre-065/pre-066 object state, the
four-path endpoint enums, and exactly the two pre-066 database jobs. Any later
migration fails closed; do not edit the result or substitute the historical
Phase 4 pre-report.

## Deployment order

The additive migrations are compatible with the currently deployed app, while
the new app expects their column, table, functions, traffic contracts, and cron
job. Use this order:

1. Keep `WIDGET_PROACTIVE_INVITATIONS_ENABLED` unset or `0` and the canary
   unset. Record the current deployment, variables, Cloudflare rules, migration
   tip, and exactly the two pre-066 database cron jobs. The third approved job
   does not exist until migration 066 commits.
2. Extend the Cloudflare marker transform and WAF/rate rule to
   `/api/widget/telemetry` while the old application remains live. Retain the
   updated rule configuration and re-prove the four already-supported paths:
   their canonical requests still succeed and their direct-origin equivalents
   still fail. The old application has no telemetry route, so this step cannot
   prove the fifth end-to-end case yet.
3. Run the exact preflight command above. Apply migration 065 and then 066 in
   numeric order. Confirm the exact migration tip is 066 and the production
   post-report at
   `supabase/snippets/chat-only-phase4-post-migration-report.sql` has no
   blocker.
4. Confirm the database has exactly these three active jobs:
   `cleanup_processed_webhook_events` at `0 3 * * *`,
   `cleanup_widget_engagement_events` at `20 3 * * *`, and
   `reap_expired_ai_reply_reservations` every minute.
5. Deploy the compatible application with the broad flag off and no canary.
   Verify manual desktop/mobile chat, preview, configuration responses, and the
   owner toggle. Now prove the fifth edge case: canonical
   `/api/widget/telemetry` requests must reach the compatible endpoint while
   equivalent direct Railway-origin requests remain rejected before database
   work. Reconfirm the other four paths remain green.
6. Configure one approved canonical business UUID as the canary. Leave the
   broad flag off. Verify both timer and scroll triggers, mobile compact-to-
   expanded behavior, dismissal suppression, manual chat, first-message AI,
   owner inbox visibility, and content-free telemetry. Verify a non-canary
   widget stays manual-only.
7. Remove the canary. After reviewing the retained evidence and KPIs, set the
   broad flag to exact `1` in a separately approved monitored window.

Never deploy the new application before migrations 065–066. Do not combine a
hosted migration, edge-rule edit, environment change, and broad opening into
one unobservable step.

## Monitoring and acceptance

Use aggregate counts only; do not export session hashes or business identities
as evidence. Segment the funnel by device bucket, trigger source, and prompt
version:

- invitation rate = `invitation_shown / widget_loaded`;
- dismissal rate = `invitation_dismissed / invitation_shown`;
- invitation engagement = proactive `widget_engaged / invitation_shown`;
- first-message conversion = proactive `first_message_submitted /
  invitation_shown`;
- engaged-to-message conversion = `first_message_submitted / widget_engaged`;
- manual-versus-proactive first-message mix; and
- mobile-versus-desktop conversion and dismissal.

Also monitor `/api/widget/config`, `/api/widget/chat`, and
`/api/widget/telemetry` 4xx/5xx/429 rates, Cloudflare direct-origin denials,
database RPC errors, the telemetry purge job, rows older than 90 days awaiting
the next daily purge (and any rows approaching 91 days),
AI reply usage, and actual new conversations visible to owners. A high
invitation count with no engagement, a sharp dismissal increase, telemetry
errors that affect chat, or any AI usage before first-message submission stops
the rollout.

## Rollback

Begin the global rollback immediately by setting
`WIDGET_PROACTIVE_INVITATIONS_ENABLED=0` (or removing it) and removing the
canary. New widget configuration reads then fail closed while the manual
launcher and owner preferences remain intact. A page that already received an
authorized configuration can still reveal from that in-memory decision until
its next configuration refresh, normally within 60 seconds; a suspended page
converges when it resumes and refreshes. Wait at least 60 seconds plus an
operator buffer, reload the retained test pages, and verify that automatic
opening has stopped before declaring rollback complete. For one business, turn
off the owner preference instead and use the same convergence check.

Leave migrations 065–066, their daily 90-day-eligibility purge job, and the
five-path
Cloudflare protection in place. They are additive and safe while the feature is
off. If an application rollback is also required, roll back only to a version
known to tolerate the additive schema; do not drop telemetry data or loosen the
edge rule as an emergency shortcut. Re-enable first with one exact-business
canary and repeat the acceptance checks.
