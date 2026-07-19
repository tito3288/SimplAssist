# Per-Customer A2P 10DLC Roadmap (Telnyx)

**Status as of 2026-07-11:** Phase 11 Option B is shipped: EIN-only launch with No-EIN waitlist hold. Sole Proprietor/OTP support is deferred to a future Option A phase. **Stripe is live-mode ready:** the code guard that forced test mode was removed (commit `4bfb5db`) and the live products, prices, and price IDs are configured — test mode is no longer enforced in code. The remaining Pre-Launch Checklist items are validation and operational steps, not the Stripe switch.

This is the shared source of truth for the per-customer A2P (Application-to-Person) 10DLC compliance initiative. It is the canonical reference for any agent or human working on Phase 7+. Compare implementation against this document rather than reconstructing context from scattered code comments.

> **What does NOT belong in this file:** secrets, API keys, access tokens, real customer PII, EINs, SSNs, or private business data. Architecture, flow logic, phase specs, and locked decisions only.

## Product UX Principle for Phases 7–11

SimplAssist's advantage is that a beginner can set up business SMS, AI replies, compliance, and a phone number without understanding telecom infrastructure. Future phases must preserve that.

Implementation rule: make each phase simple and self-explanatory as it is built, not as a cleanup pass at the end. Technical accuracy is not enough if the customer cannot tell what is happening, what they are paying for, what is waiting on approval, or what action is needed next.

Carry this through every Phase 7–11 implementation:
- Use plain-English labels before telecom terms. Prefer "Business verification" / "SMS activation" / "Carrier review" over raw terms like TCR, 10DLC, MNO, campaign provisioning, or messaging profile.
- When a step costs money, blocks setup, or requires waiting, explain why in one calm sentence near the action.
- Show "what happens next" after every major submit: payment, business verification, campaign review, number purchase, OTP, rejection, approval, and activation.
- Never show a feature as active until it is truly usable. If SMS is waiting on approval or phone-number assignment, show a waiting/paused state instead.
- Locked or unavailable features should explain the reason and next step: upgrade, wait for approval, fix rejected info, verify OTP, or contact support.
- Keep advanced technical details available for support/admin context, but do not make regular customers decode them during onboarding.

---

## Background & Why

This is the next major initiative after the Twilio→Telnyx migration completed (2026-05-12). That migration swapped providers but kept the architecture using **one shared SimplAssist Messaging Profile** (SimplAssist's own TCR brand ID: `BL69PDP`).

For per-customer compliance — required by TCR (The Campaign Registry) rules to avoid carrier rejection at scale — **each customer needs their own brand + campaign + messaging profile**, registered programmatically via the Telnyx 10DLC API during onboarding.

**Why per-customer registration (not a Telnyx quirk — carrier compliance):**
- TCR rejects shared-campaign approaches at scale.
- Carriers (AT&T, T-Mobile, Verizon) flag identity mismatches between the registered brand name and the actual message sender.
- Per-customer registration is provider-agnostic carrier compliance.

**Telnyx vs Twilio structural difference:**
- Telnyx has NO equivalent to Twilio Trust Hub's Secondary Customer Profile, and NO separate ISV approval gate. Per Telnyx: "If your end-users are a separate business entity, you are in fact an ISV." No approval needed.
- Brand registration takes `isReseller: true` to mark SimplAssist as the registering ISV acting on behalf of the customer.
- ~2–3 API calls per customer vs Twilio's 4–5.
- Two approval stages: **brand approval**, then **campaign approval**. No "profile approval" stage like Twilio.

**Pre-requisites (all complete):**
- Twilio→Telnyx migration in production (inbound SMS + voice + missed-call auto-SMS validated).
- SimplAssist's own brand registered + verified on Telnyx (TCR ID `BL69PDP`).
- Telnyx 10DLC API access via existing API key.
- All build decisions locked in during migration prep (setup fee, hosted privacy/terms pages, prohibited categories, etc.).

---

## Current State Summary

| Phase | Title | Status |
|-------|-------|--------|
| 1 | Onboarding data collection expansion | ✅ Shipped |
| 2 | Database schema additions | ✅ Shipped |
| 3 | Telnyx 10DLC API integration + send-path refactor | ✅ Shipped |
| 4 | Async status webhook handler + email notifications | ✅ Shipped |
| 5 | Dashboard status UI + send-path gates | ✅ Shipped |
| 6 | Per-business privacy/terms pages + compliance modes | ✅ Shipped |
| 6.5 | 10DLC readiness safeguards | ✅ Shipped |
| 7 | Onboarding flow restructure | ✅ Shipped |
| 8 | Use case screening + AI guardrails | ✅ Shipped |
| 8.5 | Internal admin console | ✅ Shipped |
| 9 | Cost handling | ✅ Shipped |
| 10 | Number purchasing timing | 🔒 Decision locked, implementation pending |
| 11 | EIN vs Sole Proprietor branching + SMS OTP | ✅ Shipped (Option B: EIN-only launch; Sole Prop/OTP deferred) |

**Migrations applied:** `012`–`024`. `012`–`021` cover Phases 1–11 Option B; `022` call forwarding; `023` atomic services/FAQs replace; `024` rejected-campaign history. See `supabase/migrations/`.

### Post-Phase-11 Onboarding Hardening (2026-07-09 – 2026-07-11)

Reliability and UX fixes to the onboarding/registration flow after Phase 11, surfaced during pre-launch validation. Behavior-changing items only — pure polish and design changes (button/theme/step-progress styling) live in git history, not here.

- **Retry recovery + rejected-campaign history** (migration `024`): a failed or carrier-rejected registration can be retried. On retry, the A2P risk input is re-screened when it changed (hash mismatch), the rejected Telnyx campaign is deactivated/archived, and a carrier *campaign* rejection maps to a retryable `failed` state. **Brand rejections now also map to `failed`** so the routed fix path is reachable. Rejection history is preserved in `rejected_campaigns`. Claiming a retry uses a compare-and-swap so concurrent webhooks/attempts can't double-submit.
- **Atomic services/FAQs save** (migration `023`, `replace_services_and_faqs` RPC) and **business-hours natural-key upsert**: these saves are now single-transaction, so a mid-save failure can no longer wipe existing rows. Client save errors (including delete failures) are surfaced instead of silently swallowed.
- **Carrier-rejection routing + plain-English copy**: the carrier-review panel explains rejections in plain language (the raw carrier wording is always preserved beneath) and routes "Fix & resubmit" to the step that needs fixing. Classes we generate (opt-in / message-flow, code 708) and brand re-filing route to **contact support** rather than a form whose edits the carrier never sees.
- **Mid-review edit lock**: business and compliance edits are blocked (HTTP 409) once a registration is in carrier review, except the `failed` recovery state. Enforced server-side on the brand-verification and sms-use-case routes; the onboarding UI mirrors the same predicate (`registrationHasStartedForRisk` and status ≠ `failed`), so the "Fix & resubmit" button only appears where the save will actually be accepted.
- **Website-scan autofill**: fixed a dead Anthropic model ID in the scan extractor (`claude-haiku-4-20250404`, which the API 404'd — silently returning empty since the feature shipped) to `claude-haiku-4-5-20251001`; extraction errors now log instead of being swallowed. Wired the extracted services/FAQs through to pre-fill the (editable, review-before-save) Services & FAQs step, and capped FAQ answers at 2000 characters (input + zod).

**Known follow-ups (deferred):**
- **Brand-level recovery in the retry pipeline.** A retry reuses the existing Telnyx brand record (`registerBrand` early-returns on an existing brand ID), so corrected identity/website data is saved but **not re-filed with the carrier** — currently handled via support. This is the near-mandatory companion to the brand→`failed` mapping above.
- **Multi-page website scraping** (`/services`, `/faq`, `/pricing`) to surface content a single-page scan misses.

---

## Phase 1 — Onboarding Data Collection Expansion ✅

New fields collected during signup (added to `businesses` table):
- `legal_business_name` (separate from display name)
- `ein` / `tax_id` (nullable — Sole Prop path uses last 4 SSN instead, see Phase 11)
- `business_entity_type` (LLC, Corp, Sole Prop, Nonprofit, etc.)
- `business_registration_state`
- `authorized_rep_name`, `authorized_rep_title`, `authorized_rep_email`, `authorized_rep_phone`
- `website_url`
- `use_case_description`
- `sample_messages` (3–5 real examples — no placeholders, per TCR rules)
- `estimated_monthly_volume`
- `opt_in_description`

Implemented as a "Brand Verification" step in onboarding (migration `012`).

---

## Phase 2 — Database Schema Additions ✅

On the `businesses` table (migration `013`):
- `telnyx_brand_id` (TCR brand identifier)
- `telnyx_campaign_id` (TCR campaign identifier)
- `telnyx_messaging_profile_id` (per-customer profile, distinct from the shared SimplAssist profile)
- `telnyx_voice_application_id` (per-customer Voice API Application / Connection ID)
- `brand_status`, `campaign_status` (pending / under_review / approved / rejected)
- `*_status_updated_at` timestamps
- `*_rejection_reason` fields for support troubleshooting
- `telnyx_registration_events` audit table

No `profile_sid` column needed (Telnyx has no Secondary Customer Profile layer).

---

## Phase 3 — Telnyx 10DLC API Integration ✅

New module: `src/lib/messaging/registration/`.

- `registerBrand()` — Telnyx 10DLC brand API. EIN path → Standard Brand. No-EIN path → Sole Proprietor brand + OTP (Phase 11). Sets `isReseller: true` unconditionally (every customer brand is created on behalf of a separate end-business).
- `registerCampaign()` — registers under Customer Care use case under the customer's brand.
- `createMessagingProfile()` — per-customer messaging profile.
- `createVoiceApplication()` — per-customer Voice API Application for routing isolation symmetry with messaging. (Voice has no TCR compliance requirement; this is for architectural symmetry + future per-customer voice settings.)
- `assignNumberToCustomerProfile()` — newly-purchased numbers assigned to the customer's messaging profile + voice application at order time.

### Runtime send-path refactor (CRITICAL)

Without this, per-customer registration is defeated at runtime. Every `telnyx.messages.send({ messaging_profile_id, ... })` was refactored to look up the customer's `telnyx_messaging_profile_id` (via the `phone_numbers` row, queried by destination for inbound / source for outbound) and use that per-customer ID. Otherwise outbound SMS still appears to carriers as SimplAssist's shared brand — the exact identity-mismatch failure mode.

Refactored paths:
1. `src/lib/messaging/missed-call.ts`
2. `src/app/api/messaging/webhook/route.ts` (AI reply path `processAndReply` AND MMS fallback `sendFallbackReply`)
3. `src/app/api/messaging/send/route.ts` (dashboard "send SMS" UI)

After this, the shared `TELNYX_MESSAGING_PROFILE_ID` (and `TELNYX_CONNECTION_ID`) is legacy for SimplAssist's OWN outbound only (account notifications, billing). **Never** used for customer-to-end-consumer traffic.

### Phase 3 implementation notes & known gaps

- **`mock: true` SDK parameter** exists on `messaging10dlc.brand.create` and propagates through `campaignBuilder.submit`. Behavioral details (fee waiver, TCR-review skip) are implied by SDK comments but NOT in public Telnyx docs. **Verify with Telnyx support before relying on it.** Also exposed as a dashboard checkbox ("Create as a mock brand to test 10DLC"). Preserved as an emergency tool, not a primary workflow. Potential use: Phase 11 OTP testing (mock brands can use non-US/CA numbers).
- **Business-type → Telnyx vertical mapping gap closed in Phase 7.** `toTelnyxVertical(businessType)` in `brand.ts` maps our `business_type` enum to Telnyx's 23-value Vertical taxonomy. Current coverage: `plumber`/`hvac`→CONSTRUCTION, `dentist`→HEALTHCARE, `restaurant`→HOSPITALITY, `real_estate`→REAL_ESTATE, `legal`→LEGAL, `financial`→FINANCIAL, `insurance`→INSURANCE, `retail`→RETAIL, `car_wash`/`auto_shop`/`salon`/`general`/`other`→PROFESSIONAL.

---

## Phase 4 — Async Status Handling ✅

Shipped to Railway production (2026-05-14).

- Webhook endpoint `/api/messaging/registration/status` (configured as the Telnyx brand/campaign status callback).
- Updates `*_status` fields in Supabase on carrier approve/reject.
- Triggers email notifications on status changes.
- Approvals are async: brand verification = hours to 1–2 days; campaign approval = 1–5+ days (each carrier individually reviews use case + sample messages).

### Implementation notes

- **First email infrastructure in the codebase.** Provider: Resend. Env: `RESEND_API_KEY` (required), `RESEND_FROM_EMAIL` (optional). Domain `simplassist.com` must be verified in Resend before sends deliver (operational, not code). Templates: `src/lib/email/registrationStatus.ts`; client: `src/lib/email/client.ts`. Pattern: try/catch everywhere, never throws, never blocks the webhook 200. Future email work (welcome, billing) builds on `src/lib/email/`.
- **Race-safe status-transition pattern** (reusable): conditional UPDATE combining a no-op guard with race safety —
  ```ts
  .update({...}).eq("id", id).or("brand_status.is.null,brand_status.neq.<new>").select("id")
  ```
  Returns the updated row, or empty array if another request won the race. `.or(...)` is the PostgREST way to express `IS DISTINCT FROM` across NULL.
- **Audit-everything:** every code path with a known `business_id` writes to `telnyx_registration_events`. `BRAND_OTP_VERIFIED` events are audited with `status: "audit_only_phase_11_otp"`. **Phase 11 should grep for `audit_only_phase_11_otp` rows** — OTP events that arrived before Phase 11 was built are waiting in that table.
  - Irreducible gap: events without a resource ID can't be audited (`business_id` is NOT NULL) — console.warn only.
- **Campaign status enum is richer than planned:** Telnyx exposes 12 campaign statuses and 4 brand identity statuses. Mapping in `src/lib/messaging/registration/statusMapper.ts`. `MNO_ACCEPTED` and `MNO_PROVISIONED` both → `approved` (email at first approval). `TCR_EXPIRED` → `rejected` for now (a distinct `expired` enum would need a follow-up migration).
- **Email tone (locked via user feedback):** avoid "Action needed"/"not approved" panic words on rejections. Current subjects — rejected brand: "We need to update your SimplAssist business registration"; rejected campaign: "We need to update your SimplAssist SMS campaign"; approvals: short and direct. Reuse this tone for all customer-facing notifications.

---

## Phase 5 — Dashboard Status UI + Send Gates ✅

Shipped to Railway production (2026-05-15). Migration `014`.

- A2P status card in dashboard (Brand / Campaign / Messaging Profile — pending / under review / approved / rejected).
- Hard-block of all four customer-facing send paths when `campaign_status != 'approved'`.
- Dedupe-aware "paused" system messages.
- Conversation reply UI gate.
- Rejection flow: show reason, guide resubmission.

### Implementation notes

- **New `'system'` message role** (migration `014`): `messages.role` CHECK extended to add `'system'`. Used for in-conversation notices ("Auto-reply paused — your SMS campaign is awaiting carrier approval"). Rendered as a centered amber pill in `MessageThread.tsx`. Reusable for any future system notice.
- **Merged outbound helper:** `getOutboundSendContext(phoneNumber)` in `src/lib/messaging/lookup.ts` returns `{ businessId, messagingProfileId, campaignStatus }` from a single `phone_numbers JOIN businesses` query. **Future outbound code should use this — do NOT add separate lookups** for `campaign_status`, `business_id`, or messaging profile. Exception: `/api/messaging/send` pulls from its own auth-bound businesses select.
- **Defensive default to blocked:** `getOutboundSendContext` THROWS on lookup failures; each caller wraps in an outer `.catch()`. No `telnyx.messages.send()` runs when lookup fails. Don't refactor to null-return — the throw cannot be ignored, which is the safety property.
- **Dedupe marker fragility:** `src/lib/messaging/pausedNotice.ts` uses `PAUSED_MARKER = "SMS campaign is awaiting carrier approval"` as a substring filter. If copy changes and drops this substring, dedupe silently breaks. Keep the substring, OR refactor to a sentinel column.
- **Status card visibility gate:** `A2pStatusCard.tsx` returns `null` when both statuses are null (pre-onboarding). **Phase 7 should keep this gate** — onboarding has its own step-by-step status UX.

---

## Phase 6 — Per-Business Legal/Consent Pages ✅

Shipped to Railway production (2026-05-15). Migration `015`.

A2P verification often checks the customer's OWN website for an SMS-related Privacy Policy / Terms / opt-in disclosure. Without it, campaigns get rejected.

- Hosted pages at `/c/[slug]/privacy` and `/c/[slug]/terms` (default), plus landing `/c/[slug]`.
- Three-mode compliance hybrid in dashboard Settings.
- Slug migration with frozen-after-first-submit rule.
- Brand-verification pre-flight gate.

### Implementation notes

- **The buried Phase 3 bug:** `campaignBuilder.submit()` was omitting `privacyPolicyLink` and `termsAndConditionsLink` entirely (both optional in the SDK). Existing pending campaigns went to TCR with NO privacy/terms URLs. Fixed going forward via `resolveLegalUrls()`. Pre-Phase-6 campaigns are NOT auto-backfilled (manual via Mission Control if needed). **Lesson: check every new SDK field against the spec, not just absence-of-error.**
- **Three-mode compliance hybrid:**
  1. `hosted` (default) — SimplAssist serves the pages from Phase 1 data. Zero customer effort.
  2. `self_hosted` — customer wants pages on their own domain. Dashboard shows generated content as plain formatted text (`toPlainText()` in `perBusinessCopy.ts`); customer pastes into their CMS, returns URLs.
  3. `existing` — customer already has an SMS-compliant policy. Same override-URL form, plus a **forced-engagement four-checkbox self-check** before submit enables. The checklist is the critical defense against customers confidently pasting non-compliant URLs. Carry this "are you sure?" pattern forward.

  Both `self_hosted` and `existing` read `*_url_override` columns (same submission path); modes differ only in UX. See `src/lib/messaging/registration/legalUrls.ts`.
- **Slug freeze — structurally enforced:** slugs generated on FIRST brand-verification submit (`generateSlug`→`ensureUniqueSlug` in `src/lib/util/slug.ts`), then frozen. The write only happens inside `if (isPendingSlug(business.slug))` — there is no call site to regenerate, so a future maintainer can't accidentally do it. `handle_new_user` seeds `slug: 'pending-<short-id>'`. `isPendingSlug()` guards FIVE call sites. Right pattern for any "set once, then frozen" invariant.
- **HEAD/GET reachability fallback:** `src/app/api/settings/compliance/route.ts` does a HEAD request (5s timeout) before saving a `*_url_override`; on `405` it retries with GET (Squarespace/Cloudflare return 405 for HEAD where GET works). `checkReachable()` carries a `MUST NOT be simplified` warning. Never trust HEAD alone.
- **PII boundary on public pages:** `/c/[slug]/{privacy,terms}` and `/c/[slug]` are public, unauthenticated, use `supabaseAdmin` (RLS bypass). Each file has a `PUBLIC_PROJECTION` constant listing the exact safe columns. **NEVER project** `ein`, `last_4_ssn`, `registrant_mobile`, `authorized_rep_*`, `tax_id_type`, `owner_id`, the `telnyx_*` IDs, or `*_rejection_reason`. Same rule for any Phase 7+ public route.
- **`LegalDocLayout` branding props:** `src/components/legal/LegalDocLayout.tsx` extended with optional `backHref`, `backLabel`, `businessName`. When `businessName` set, business identity dominates and SimplAssist is small footer attribution. Single-component-with-props beat a parallel layout.
- **Audit `_submitted` key:** both `campaign.ts` and `brand.ts` nest a `_submitted` key in `rawPayload` for success and error rows. Lets you verify post-deploy exactly which URLs/fields reached Telnyx vs what the customer configured.

### Deferred from Phase 6 (intentional)

- **Widget SMS opt-in checkbox** — deferred. The current widget captures only name + email (no phone), so no SMS goes out from web chat. Becomes load-bearing with the future "Order Now" restaurant feature (phone number for order status). Revisit then.
- **Retry path for failed Phase 3 registrations** — the race-safe transition gates Phase 3 to first-submit only. If the initial Telnyx call failed, customer can't retry via the form. Needs an explicit "Retry registration" dashboard action.
- **Rejected brand/campaign correction + resubmission** — required before real customer launch. Current app stores rejection reasons and shows "Needs update," but does not yet provide a complete flow to edit rejected brand/campaign fields and send the correct Telnyx recovery action. This is distinct from initial technical retry:
  - brand rejection may require updating the existing Telnyx brand, revetting, or support/manual intervention depending on Telnyx/TCR response;
  - campaign rejection may require updating editable fields (notably samples/message flow), submitting a campaign appeal, or creating a replacement campaign because many campaign attributes are immutable after submit;
  - v1 product recommendation for future eligible customer rejections: if the rejection requires changing full compliance content (opt-in/opt-out messages, keywords, privacy/terms links, or other fields not cleanly exposed by the Telnyx update API), create a replacement campaign under the already-verified brand, update the business to point at the new `telnyx_campaign_id`, and leave the rejected campaign as audit history;
  - a later optimization can use edit/appeal for narrow rejections only if the affected fields are confirmed editable via Telnyx API and the behavior is reliable;
  - Alpha Dog is not a future launch-validation account. It is parked as a disabled fixture because its campaign was rejected for SEO content on the agency website (carrier code 708), the website cannot change, and no replacement campaign will be submitted.
- **Backfill of pre-Phase-6 campaigns** — manual via Mission Control if needed.
- **zod deprecation cleanup** — `z.string().email()` and `parsed.error.flatten()` are deprecated in zod 4.x types, used across many files. Codebase-wide tech debt, dedicated pass.
- **`appBaseUrl()` duplication** — 5 copies (brand.ts, campaign.ts, messagingProfile.ts, voiceApplication.ts, legalUrls.ts). Extract to a shared module when there's a natural reason to touch them.

---

## Phase 6.5 — 10DLC Readiness Safeguards ✅

Shipped 2026-06-18 (commit `Add Telnyx 10DLC readiness safeguards`). Migration `016`.

Not in the original 11-phase plan — added after Phase 6 to close runtime-readiness gaps before broader launch.

- **Phone-number → campaign assignment tracking** (migration `016`): new columns on `phone_numbers` (`telnyx_campaign_assignment_status` [unassigned/pending/assigned/failed], `*_task_id`, `*_campaign_id`, `*_failure_reason`, `*_updated_at`, `telnyx_campaign_assigned_at`). SMS sends require `assigned`. New module `src/lib/messaging/registration/phoneNumberAssignment.ts`. `telnyx_registration_events` resource-type CHECK extended to include `phone_number_assignment`.
- **SMS readiness gating** — readiness now requires campaign assignment, not just `campaign_status == approved`.
- **Onboarding preflight reordered** before the first-submit timestamp flip.
- **CUSTOMER_CARE use case qualified** before campaign submit.
- **Full authorized representative name required.**

---

## Phase 7 — Onboarding Flow Restructure ✅

Shipped 2026-07-05. Migration `017`.

- **Original pre-Phase-7 flow:** signup → business info → pick number → done.
- **Shipped Phase-7 flow:** signup → business info → hours → services/FAQs → AI settings → legal business verification → SMS use case → phone number → review/submit → carrier review → dashboard only after SMS readiness.
- Telnyx has no "profile approval" stage — two stages only (brand approval, then campaign approval).

### Partial onboarding + resume requirements

The previous onboarding saved data only when each step's Next/Submit button was clicked, and the resume flow was not robust. Phase 7 made partial setup safe for real users who close the tab, lose signal, or stop midway.

Pre-Phase-7 behavior fixed:
- Signup immediately creates a placeholder `businesses` row.
- Step 1 business info saves on Next.
- Step 2 business hours saves on Next.
- Step 3 services/FAQs saves on Next.
- Step 4 AI settings saves on Next.
- Step 5 brand/EIN verification saves and triggers Telnyx registration on submit.
- Typed data on the current step is lost if the user closes the page before clicking Next.
- On reload, the app does not reliably reconstruct every completed step from the database.
- The onboarding layout can redirect to `/dashboard` once `ai_settings` exists, even when brand verification / phone setup / launch status are not complete. This can make an incomplete user look "done" too early.

Phase 7 implementation requirements shipped:
- Add an explicit onboarding progress state, e.g. `onboarding_step`, `onboarding_completed_at`, or equivalent derived status that cannot confuse "started" with "finished."
- Resume users at the next incomplete step, not always Step 1 and not dashboard unless onboarding is truly complete.
- Load saved business hours, services, FAQs, AI settings, brand verification fields, and purchased phone number when rebuilding the onboarding state.
- Treat Step 5 as a special boundary: do not trigger Telnyx registration until the user intentionally submits exact legal/EIN data.
- Add a calm "Your progress is saved" / "Continue setup" UX so users understand they can safely pause between steps.
- If a user abandons during a step before clicking Next, either autosave drafts or make it clear that the current step is not saved yet.
- Dashboard should show a clear "Continue setup" or waiting/approval status for incomplete accounts rather than acting like the account is fully launched.

**Carry-forward constraints:**
- Keep the `A2pStatusCard` null-gate (Phase 5) — onboarding has its own step-by-step status UX.

### Implementation notes

- **Explicit onboarding progress state** (migration `017`): new `businesses` columns track `onboarding_step`, `onboarding_completed_at`, `onboarding_last_saved_at`, `onboarding_registration_status`, `onboarding_registration_started_at`, `onboarding_registration_submitted_at`, and `onboarding_registration_error`. Dashboard access now requires true SMS readiness, not merely `telnyx_campaign_id`.
- **Attempt-gate pattern:** final submit and retry share `claimRegistrationAttempt()`. `not_started`, `failed`, or stale `submitting` rows can claim the lock; duplicate clicks return the current state. `onboarding_registration_submitted_at` is a success marker only, set after `runFullRegistration()` completes. Failed attempts set `status='failed'`, keep Telnyx IDs already created, and remain retryable through helper early returns.
- **Resolver is authoritative:** `/api/onboarding/state` rebuilds the onboarding snapshot from live DB facts (business info, hours, services, FAQs, AI settings, legal/SMS fields, phone number, carrier statuses, assignment readiness). Stored `onboarding_step` is advisory/resumable metadata and can be corrected downward if required facts are missing.
- **Legal boundary preserved:** brand/legal representative fields and SMS use-case/sample-message fields are split into separate steps. Slug generation, legal URL reachability preflight, and the `compliance_info_completed_at` flip stay in the compliance-completion route (`/api/onboarding/sms-use-case`), before number purchase and final registration.
- **Number purchase timing:** number purchase remains before carrier approval per the Phase 10 locked decision. `/api/messaging/numbers/purchase` still creates the per-customer messaging profile and voice application before ordering the number, so the purchased number attaches to the correct profile/voice app at order time.
- **Backfill behavior:** migration `017` marks existing `telnyx_brand_id` accounts as `onboarding_registration_status='submitted'`, and only marks accounts `complete` when SMS is actually ready: approved campaign, per-customer messaging profile, active number, and assignment to the current campaign.
- **Known production state after rollout:** Alpha Dog Agency remains `carrier_review` / `submitted` by design because production currently has `campaign_status='rejected'` and the active number is not assigned to the current campaign. It should not be backfilled to `complete` until SMS readiness is true. Alpha Dog is retired as a launch-validation account; keep `telnyx_submission_disabled = true` and preserve the rejected campaign as history.

---

## Phase 8 — Use Case Screening + AI Guardrails ⏳

- Reject prohibited/high-risk use cases during onboarding before paid Telnyx/TCR submission. The original "single checkbox" idea is superseded by a stronger two-layer screen: automatic website/content scan plus a plain-English customer checklist.
- Tighten `src/lib/ai/prompt.ts` so the AI never drifts into promotional/marketing messaging — must stay within the registered Customer Care use case, or campaigns get pulled.

### Prohibited website/use-case screening before paid submit

The Alpha Dog EIN test exposed a real carrier-review rule: a campaign can be rejected even when SimplAssist submits the right Customer Care use case if the customer's public website advertises carrier-prohibited services. In that test, the campaign moved past the earlier CTA/autoresponder rejection, then failed because the website referenced lead generation and SEO services. Treat this as a Phase 8 product requirement, not a one-off support note.

Phase 8 must screen both the customer's declared use case **and** the public website before paid campaign submission. This should happen before charging/resubmitting Telnyx/TCR review fees whenever possible.

Screening sources to re-check during implementation:
- Telnyx carrier error explanations: `https://support.telnyx.com/en/articles/10547022-10dlc-carrier-error-codes-explanations`
- Telnyx message-flow guidance: `https://support.telnyx.com/en/articles/10562019-guide-to-10dlc-message-flow-field`
- Telnyx/TCR prohibited-use guidance available at implementation time. Carrier rules change, so do not rely only on this roadmap.

Initial website/use-case blocklist for Phase 8:
- lead generation, lead sales, buying/selling leads, third-party lead sourcing, prospect lists, cold outreach, affiliate lead offers;
- SEO services or marketing-agency pages that advertise lead-generation/SEO outcomes in a way carriers classify as prohibited or high-risk;
- affiliate marketing, referral/affiliate offers, "make money online," get-rich-quick, passive-income, MLM/network marketing;
- high-risk financial services: payday loans, short-term loans, debt relief, debt collection, credit repair, loan brokering, investment/crypto promises, trading signals;
- cannabis, CBD, marijuana, controlled substances, drug paraphernalia;
- prescription drugs, pharmacy, telemedicine prescriptions, health products requiring special approval;
- gambling, casinos, sports betting, sweepstakes/lottery-style promotions;
- adult content, escort services, sexual content, dating/hookup services;
- firearms, weapons, ammunition;
- political messaging, donations, polling, advocacy campaigns;
- alcohol, tobacco, vaping, age-gated products;
- hate, harassment, profanity-heavy content, illegal products/services, deceptive/phishing/scam-like content.

Direct Telnyx error-code categories to preserve in the checklist/scan rules:
- Code 701: cannabis/CBD/hemp and derivatives;
- Code 702: guns/ammunition sales without compliant controls;
- Code 703: explicit sexual content;
- Code 704: gambling/sports betting/lottery-style games of chance;
- Code 705: hate speech, inappropriate content, profanity;
- Code 706: alcohol without compliant age-gating;
- Code 707: tobacco/vape without compliant age-gating;
- Code 708: lead generation/affiliate marketing, including any website mention of lead generation or SEO;
- Code 709: high-risk financial services, including payday loans, non-direct lenders, debt collection, credit repair, debt forgiveness, crypto-related traffic, and stock-trading traffic.

Other Telnyx rejection categories are not business-service blocklist items, but Phase 8/7 should still validate them where possible: website/sample-message consistency, opt-in language on website/contact forms, accessible CTA/legal links, non-compliant privacy policy, repeated EIN use, misleading registrations, large companies using non-official email domains, and inauthentic/incomplete websites.

Implementation requirements:
- Add a pre-submit risk scan for `website_url`, `business_type`, `business_type_other`, services, FAQs, use-case text, sample messages, and opt-in copy.
- Add an onboarding question/checklist that plainly asks whether the business offers carrier-restricted services. Do not use one vague checkbox; show examples customers can recognize, including lead generation, SEO services, affiliate marketing, payday loans/debt relief, cannabis/CBD, gambling/sports betting, adult/dating, firearms/weapons, political messaging, MLM/get-rich-quick, crypto/investment promises, prescription/pharmacy, alcohol/tobacco/vape, and other regulated or deceptive services.
- Make the checklist a required gate before paid campaign submission. The user must either select "None of these apply to my business or website" or choose a restricted/uncertain option such as "I'm not sure / please review this." Do not let the user skip this step with no answer.
- Present automatic scan results in onboarding before final submit. Example: "We found SEO/lead-generation language on your website. Carriers may reject SMS registration for this business. Please update the website or contact support before submitting."
- Use the scan to block clearly prohibited categories before Telnyx submission. Do not spend the customer/setup fee on a campaign that the visible website makes ineligible.
- For ambiguous categories, show a plain-English warning and require admin/manual review before submission. Example: "Carriers may reject SMS registration because this website advertises lead generation or SEO services."
- If the user selects a restricted category, "I'm not sure," or the automatic scan finds an ambiguous risk, pause submission and create a support/admin review path instead of calling Telnyx. Notify the configured SimplAssist admin/support email, show the customer a calm "we need to review this before submitting" state, and keep the account out of paid carrier review until an admin clears it or the customer updates the website/details.
- Marketing agencies are not automatically blocked, but agencies advertising lead generation, SEO, affiliate marketing, bought leads, cold outreach, or mass marketing should be blocked or routed to admin review.
- Store risk findings in a support-visible/audit-friendly way when the schema exists. Do not store private EIN/SSN/rep data in public or customer-facing pages.
- Keep the customer-facing explanation beginner-friendly: "Carriers do not allow SMS registration for some business types and website content. We need to review this before submitting so you do not pay a fee for a likely rejection."
- Let an admin override only after explicitly acknowledging the Telnyx review fee/rejection risk. Never auto-submit blocked or high-risk categories.

### Customer Care campaign text generator

SimplAssist's initial 10DLC use case is **Customer Care / Conversational Messaging** only. Do not broaden this into marketing, promotional campaigns, lead-list outreach, coupons, blasts, or unrelated vertical use cases during Phase 8.

Current behavior to replace: the user manually writes `use_case_description`, 3–5 `sample_messages`, and `opt_in_description` during onboarding. Real customers will not know what carriers expect, and freeform entries can cause preventable Telnyx/TCR rejection.

Phase 8 should implement a **controlled template generator**, not open-ended AI copywriting:
- Hard-code the compliant structure and carrier-safe language.
- Dynamically insert the customer's real `business.name`, relevant service/category wording from onboarding (`services`, `business_type`, `business_type_other`, FAQs, website scan), and real opt-in channels.
- Let AI lightly choose service wording only inside strict rules; do not let it invent a different use case.
- Show generated text as editable but framed: "We drafted this for carrier review. Please confirm it matches your business."
- Run validation before submit: no placeholders like `[Business Name]`, no prohibited/risky categories, no marketing/blast/coupon/discount/cold-outreach language, and no claims about features the product does not actually perform yet.
- Keep at least one sample message with opt-out wording such as `Reply STOP to opt out.`

Recommended generated use-case template:

```text
{BusinessName} will use SMS for customer care conversations with people who contact the business. Messages may include replies to customer questions, missed-call follow-ups, service inquiry responses, and next-step coordination related to {ServiceCategory}. This campaign will not be used for mass marketing, promotional blasts, cold outreach, or affiliate marketing.
```

Recommended sample-message templates:

```text
Thanks for contacting {BusinessName}. We received your message and can help with your question about {ServiceCategory}. What can we help you with today?
```

```text
Hi, this is {BusinessName}. We saw your missed call and wanted to follow up. What service or question can we help with? Reply STOP to opt out.
```

```text
Thanks for your interest in {BusinessName}. We can help coordinate next steps for your inquiry. What day and time works best for a quick call?
```

Recommended opt-in description template:

```text
Customers opt in by contacting {BusinessName} through the business website, website chat, phone call, or SMS. {BusinessName} uses SMS to respond to customer questions, follow up on missed calls, and coordinate service inquiries. Customers can reply STOP to opt out.
```

Dynamic insertion rules:
- `{BusinessName}` should use the customer-facing business name unless legal review requires `legal_business_name`; never use a placeholder.
- `{ServiceCategory}` should be a short, truthful phrase such as `marketing services`, `plumbing services`, `dental appointment questions`, or `auto repair services`.
- If service/category data is weak, default to `the services offered by the business` rather than inventing specifics.
- Avoid "appointment reminders" until the product actually sends appointment reminders. Use "appointment coordination" or "consultation scheduling" only when the business setup supports that language.
- If Google Calendar booking is disabled, do not claim automatic booking; "coordinate next steps" is safer.

These templates must describe what SimplAssist actually does: inbound customer conversations, missed-call follow-ups, manual/AI SMS replies, service questions, and next-step coordination. They are not just Telnyx approval theater.

---

## Phase 8.5 — Internal Admin Console ✅

**Status:** Shipped on 2026-07-09 as the internal `/admin` shell with A2P review approvals and billing/test flags.

### Purpose

- One internal `/admin` area inside the existing SimplAssist app for SimplAssist staff (currently only Bryan). Not customer-facing.
- Designed to grow: v1 ships A2P review approvals; Phase 9 adds billing/usage pages into the same area; later phases add more rooms behind the same door.

### Access control (locked decisions)

- Reuse existing Supabase auth. No new login system. No hardcoded credentials or passwords anywhere in code or roadmap.
- Admin = authenticated user whose Supabase auth user ID appears in env var `SIMPLASSIST_ADMIN_USER_IDS` (comma-separated). Document the var name only, never values.
- Every admin route handler AND server component re-verifies admin status server-side. Client-side hiding, layout checks, or middleware alone are insufficient — a logged-in customer must never reach admin routes directly.
- Non-admins receive 404 (not 403) so the area's existence is not revealed.
- Fail closed: env var unset/empty = nobody is admin.
- Admin accounts are normal Supabase logins that may never complete onboarding. Admin routes must be reachable regardless of onboarding state — the admin check runs independently of the onboarding resolver/redirects. The placeholder business row auto-created at signup is expected and ignored.

### v1 scope — A2P risk review approvals

This replaces the curl workflow while keeping the token endpoint as a backup path.

- Queue view: businesses with `a2p_risk_review_status = pending_review` or `blocked`, plus recently approved/rejected for audit context.
- Detail view: customer-safe scan findings, checklist answer/selections, use-case/sample/opt-in text, website URL, current status, and whether stored clearance matches the current input hash.
- Approve action: requires a note (min 8 chars) + explicit fee-risk acknowledgement, applies to the current input hash only, writes to the existing audit trail.
- MUST reuse the same server-side approval logic as `POST /api/admin/a2p-risk-review` via a shared function — no duplicated approval code. The token endpoint remains as a backup path.

### Phase 9 additions

- Per-account usage and gross-margin visibility (Phase 9 implementation requirement) lives here.
- Marking accounts pilot / comped / billing_exempt (Phase 9 pilot-migration requirement) lives here.
- High-usage account visibility before launch lives here.

### PII rules

- Never render `ein`, `last_4_ssn`, `registrant_mobile`, `authorized_rep_*`, or `tax_id_type` in the admin UI. Customer-safe/sanitized fields only, same boundary as the Phase 6/8 projection rules.

### Build notes

- v1 expects no schema changes; any proposed migration must be flagged and justified at planning time.
- When implementation starts, follow the standard workflow: plan → review → implement.

---

## Phase 9 — Cost Handling ✅

Phase 9's internal/admin visibility work builds on Phase 8.5. Billing, usage, gross-margin, pilot/comped account controls, and high-usage visibility should live inside the same `/admin` area rather than creating a separate staff surface.

Before switching billing live or onboarding a real customer, complete the **Pre-Launch Checklist** after Phase 11.

Brand registration costs by tier:
- Sole Proprietor brand: free or ~$2 one-time
- Low Volume Standard brand: ~$4 one-time (**confirmed actual cost** — earlier $15 estimates were wrong; most SimplAssist customers land here)
- Standard brand: ~$44 one-time (only for higher throughput)

Campaign registration: ~$10/month per campaign (any brand tier).

**Locked decision:** a **$25 one-time setup fee** at signup absorbs brand cost + first month of campaign ($4 + ~$10 = ~$14, comfortably under $25). Recurring $10/month campaign fee absorbed into existing $25/$45/$65 tier pricing. **No separate "compliance line item"** on customer invoices.

Pre-approval rate limits: providers throttle heavily (often 1 msg/sec) until campaign approved — handle gracefully.

**First checkout math:**

| Selected plan | First checkout | Future monthly billing |
|---------------|----------------|------------------------|
| Starter / SMS Only | $25 plan + $25 setup = **$50 today** | **$25/month** |
| Growth / SMS + Web Chat | $45 plan + $25 setup = **$70 today** | **$45/month** |
| Pro / Full Suite | $65 plan + $25 setup = **$90 today** | **$65/month** |

### Checkout UX and setup-fee explanation

SimplAssist's product promise is beginner-friendly setup. Phase 9 must explain the one-time setup fee in plain English before payment, not bury it in a Stripe line item or telecom jargon.

Recommended customer-facing copy:

> One-time setup and SMS compliance activation fee. We use this to verify your business, register your SMS sending with carriers, activate your phone number, and set up your compliance pages so your messages can be delivered reliably.

Implementation notes:
- Show the one-time setup fee as its own line item in the plan/checkout review before redirecting to Stripe.
- Include a small "What's this?" tooltip, inline explainer, or modal near the setup fee.
- Avoid leading with "Telnyx," "TCR," "10DLC," or carrier acronyms in beginner-facing checkout copy. Those can appear in a secondary "technical details" accordion if needed.
- Make the total today vs monthly renewal obvious: e.g. "$70 today, then $45/month after setup."
- Explain that business verification can take time and that SMS activation is not instant, so users do not expect the number to send immediately.
- Keep the tone calm and helpful. This fee should feel like assisted setup, not a surprise telecom tax.
- Do not submit paid Telnyx/TCR registration until checkout succeeds.

### Pricing + usage model to implement

Phase 9 must turn the existing plan skeleton in `src/lib/stripe/config.ts` into a profitable ladder. The current public plan anchors are:
- `sms_only` / **SMS Only** — $25/month
- `sms_and_chat` / **SMS + Web Chat** — $45/month
- `full` / **Full Suite** — $65/month

Keep the entry plan affordable, but do **not** sell unlimited SMS/MMS/AI usage. Telnyx charges per SMS/MMS part in both directions, carrier fees are pass-through, each customer has recurring 10DLC campaign cost, each number has monthly cost, and AI replies add variable token cost. The product can say "unlimited conversations" only if pricing copy clearly limits included message parts.

**Provider-cost assumptions as of the 2026-06 pricing review — re-verify before implementation:**
- Telnyx local 10DLC SMS is charged per inbound/outbound message part plus U.S. carrier fees. Model planning cost around **$0.01 per SMS part** to leave room for carrier variation and long-message segmentation.
- Telnyx MMS is materially more expensive than SMS. Do not include unlimited MMS; meter it separately or make it Pro/add-on only.
- Telnyx local numbers are roughly low single-digit dollars per month including SMS/MMS capability; keep one included number in each tier and charge for extras.
- Stripe fees and AI model token costs should be included in margin math.
- Re-check Telnyx, Stripe, and AI-provider pricing during Phase 9 before locking final public numbers.

**Recommended ladder:**
- **Starter / SMS Only — $25/month**
  - Purpose: affordable entry point for small service businesses.
  - Include: one local phone number, A2P compliance handling, automatic missed-call text, manual SMS inbox, contacts/conversation history, hosted compliance pages.
  - Exclude or upsell: website chat widget, booking, analytics, custom branding, MMS, high-volume automations.
  - Included usage target: **300–500 SMS parts/month**. Default recommendation: start at **500 SMS parts/month** only if usage enforcement is live.
- **Growth / SMS + Web Chat — $45/month**
  - Purpose: main value tier and expected "Most Popular" plan.
  - Include: everything in Starter, AI SMS conversations, website chat widget, lead capture, widget/custom-brand settings, business FAQ/services/tone customization, Google Calendar connection, and AI direct appointment scheduling.
  - Included usage target: **1,500 SMS parts/month**.
- **Pro / Full Suite — $65/month initially, consider $79/month before broad launch**
  - Purpose: advanced customers who need automation and reporting.
  - Include: everything in Growth, advanced AI guardrails, advanced analytics, lead-to-appointment conversion reporting, weekly performance summary, real-time new-lead alerts, review requests, automated follow-up/no-show workflows, and priority support.
  - Included usage target at $65: **2,500 SMS parts/month**.
  - If priced at $79: can include roughly **3,000 SMS parts/month** with healthier margin.
  - MMS should be Pro-only or add-on, with separate metering/overage.

**Feature entitlement matrix:**

| Feature / capability | Starter / SMS Only | Growth / SMS + Web Chat | Pro / Full Suite |
|----------------------|--------------------|--------------------------|------------------|
| One local SimplAssist phone number | Included | Included | Included |
| A2P 10DLC registration + hosted legal pages | Included | Included | Included |
| Manual SMS inbox/replies | Included | Included | Included |
| Missed-call auto text | Included | Included | Included |
| Contacts + conversation history | Included | Included | Included |
| Automatic missed-call template | Included | Included | Included |
| Full AI SMS conversations | Locked; manual SMS remains available | Included | Included |
| Website chat widget | Locked; upgrade prompt | Included | Included |
| Web chat lead capture | Locked; upgrade prompt | Included | Included |
| Widget branding/customization | Locked; upgrade prompt | Included | Included, with advanced options |
| Business FAQ/services/tone customization | Locked; upgrade prompt | Included | Included, with advanced guardrails |
| MMS | Locked by default | Paid add-on only if margin supports it | Pro/add-on only; meter separately |
| Appointment booking / calendar integration | Locked | Included | Included |
| Review requests | Locked | Locked or upgrade prompt | Included |
| Analytics dashboard | Basic usage only | Basic usage only | Full analytics |
| Lead-to-appointment conversion reporting | Locked | Locked or upgrade prompt | Included |
| Weekly performance summary | Locked | Locked or upgrade prompt | Included |
| Real-time new-lead alerts | Locked | Locked or upgrade prompt | Included |
| Automated follow-up / no-show workflows | Locked | Locked or upgrade prompt | Included |
| Priority support | Locked | Locked | Included |
| Extra phone numbers | Paid add-on | Paid add-on | Paid add-on |
| Higher-volume SMS pool | Upgrade or custom plan | Upgrade or custom plan | Custom plan |

**Feature-gating implementation rules:**
- Do not rely on frontend hiding alone. Every gated feature needs backend/API enforcement so a lower-tier account cannot call a locked route directly.
- Prefer a shared entitlement helper such as `canUseFeature(plan, featureKey)` used by both UI components and route handlers.
- Lower-tier UI should usually show locked states with an upgrade CTA for high-value features (chat widget, booking, analytics) rather than making the product feel broken or empty.
- Hard-block cost-generating features when the plan does not include them: AI sends beyond allowed tier, MMS, extra numbers, high-volume automations, and any future outbound bulk/marketing-like workflow.
- Keep all customer-to-consumer messaging inside the registered Customer Care use case regardless of tier. Higher tiers add capability and volume, not a different TCR use case.

**Overages and add-ons:**
- Extra SMS parts: target **$0.03 per additional SMS part** after included usage.
- MMS: separate paid meter, e.g. **$0.06–$0.10 per MMS part/message event** after real Telnyx cost is confirmed.
- Extra phone numbers: **$5–$10/month per number**.
- Higher-volume custom plans: require manual approval and a larger included-usage pool.

**Rough margin targets using conservative assumptions:**
- Starter $25 with 500 SMS parts: variable/platform cost roughly $17–$19/month → ~$6–$8 gross profit.
- Growth $45 with 1,500 SMS parts: cost roughly $29–$32/month → ~$13–$16 gross profit.
- Pro $65 with 2,500 SMS parts: cost roughly $41–$45/month → ~$20–$24 gross profit.
- Pro $79 with 3,000 SMS parts: cost roughly $47–$52/month → ~$27–$32 gross profit.

These are planning estimates, not accounting truth. The implementation should store enough usage and cost data to compare real gross margin by account.

### Phase 9 implementation requirements

- Add a real payment gate before any paid Telnyx/TCR registration is submitted. If payment fails or the user abandons checkout, do not call `registerBrand()` / `registerCampaign()`.
- Charge the $25 setup fee at signup/onboarding before the paid submit. Keep this separate from the recurring plan in Stripe so refunds/support decisions are clean.
- Replace placeholder `STRIPE_PRICE_IDS` with real Stripe Price IDs via environment/config.
- Add Stripe Checkout for initial signup payment and the Stripe customer portal for plan changes/cancellations.
- Add Stripe webhook handling for subscription state. The app must know active / trialing / past_due / canceled before enabling paid features.
- Add usage tables or counters keyed by business + billing period. Track at minimum:
  - inbound SMS parts
  - outbound SMS parts
  - MMS events/parts
  - Telnyx phone-number monthly cost basis
  - campaign monthly cost basis
  - AI input/output token estimates or actual usage where available
  - overage opt-in and overage amount
- Count **billable message parts**, not just `messages` rows. Long SMS can split into multiple parts, and inbound SMS still costs money.
- Usage gates must apply to every customer-facing send path: manual dashboard sends, AI replies, MMS fallback text, and missed-call SMS.
- Add customer-visible usage UI: current billing period, included SMS parts, used SMS parts, warning at 80%, hard stop or upgrade/overage prompt at 100%.
- At 100% usage, default to pausing outbound sends until upgrade/overage opt-in. Do not silently continue unbounded usage.
- Add internal/admin visibility for gross margin and high-usage accounts before launch. This lives in the Phase 8.5 `/admin` area.
- Update plan copy so "unlimited conversations" cannot be interpreted as unlimited SMS/MMS/AI usage.
- Keep account notifications / billing emails separate from customer-to-consumer SMS usage.

### Pilot/test account billing migration

The first real-EIN account may start as a no-charge internal pilot while SimplAssist absorbs Telnyx/TCR/SMS/AI costs. Phase 9 must support converting that existing approved account into a normal paid account without rerunning compliance registration or disturbing the phone number.

Migration requirements:
- Do **not** rerun brand registration, campaign registration, number purchase, or campaign assignment for a pilot account that is already approved/assigned.
- Keep the existing `businesses.id`, auth `owner_id`, Telnyx IDs, phone number, conversations, contacts, legal-page slug, and status history intact.
- Create or attach a Stripe customer + subscription to the existing business when the pilot becomes paid.
- Decide manually whether to waive the $25 setup fee for pilot accounts. Default recommendation: waive it or comp it if SimplAssist already absorbed the setup during testing.
- Start included usage/message caps from the first paid billing period, not retroactively from the free pilot period.
- Add an internal/admin way to mark accounts as `pilot`, `comped`, or `billing_exempt` until billing starts, so free tests do not look like broken subscriptions. This lives in the Phase 8.5 `/admin` area.
- Once converted to paid, enforce the same tier entitlements, SMS/MMS caps, overage rules, and past-due behavior as every other account.
- Avoid surprising the pilot customer with back charges. Any first invoice should be clearly agreed to before Stripe billing is attached.

---

## Phase 10 — Number Purchasing Timing 🔒 (decision superseded by Phase 9)

**Updated decision:** number purchase now happens at paid launch, after checkout succeeds and after brand/campaign submission, but still before carrier approval. This supersedes the earlier "immediately during onboarding" timing while preserving onboarding momentum and avoiding any paid Telnyx number purchase before payment.

---

## Phase 11 — EIN vs Sole Proprietor Branching + SMS OTP ✅

**Status:** Shipped as **Option B: EIN-only launch** on 2026-07-09.

Migration `021_phase11_ein_branching.sql` has been applied to production. It adds:
- `has_ein` — fail-closed branch answer; launch requires `has_ein IS TRUE`.
- `a2p_brand_tier` — TCR/A2P brand classification, currently `low_volume_standard` for EIN brands; not a SimplAssist subscription tier.
- `no_ein_hold_status` and `no_ein_waitlist_requested_at` — DB-only No-EIN waitlist/hold state.

Option B asks the branch question in the **Brand Verification onboarding step**. EIN customers continue through the existing Standard Brand path. No-EIN customers can create accounts and join a DB-only waitlist, but cannot checkout or launch SMS registration until they add an EIN.

Customers may not have an EIN. TCR supports a Sole Proprietor brand tier. Onboarding must handle both.

**Branching question in Brand Verification:** "Do you have an EIN (federal Tax ID)?"

### EIN path → Standard Brand
- Most customers (est. 80–85%): med spas, dental offices, car washes, established roofers — almost all LLC/Corp with EIN.
- Collect: legal entity name, EIN, business type, business address, authorized rep.
- Tier: Low Volume Standard (~$4) default.
- No OTP step — TCR validates EIN against IRS data.

### No-EIN path → Sole Proprietor Brand

**Deferred to future Option A.** Phase 11 Option B does **not** ship Sole Proprietor registration code.

- Est. 15–20%: solo cleaners, photographers, trainers, side-hustle freelancers.
- Collect: personal legal name (no LLC/Corp), home/business address, mobile phone, last 4 SSN.
- TCR sends OTP via SMS to registrant's mobile (24-hour window).
- Tier: Sole Proprietor (free or ~$2).
- Product restrictions to enforce: 1 phone number per campaign, 1 campaign per brand, throughput 1 msg/sec (15/min AT&T, 1,000/day T-Mobile), owner must be the operator personally. For missed-call Customer Care, 1 msg/sec is plenty.

**Encourage EIN with UX copy on the No-EIN path:**
> "Don't have an EIN? You can get one free from the IRS in about 15 minutes — [Get an EIN]. This unlocks higher message limits and faster approval. Or continue without one (limited mode)."

Phase 11 Option B uses the IRS EIN link:
`https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number`

No-EIN waitlist behavior in Option B:
- On-screen confirmation only.
- Stored in `businesses.no_ein_hold_status = 'waitlisted'` and `no_ein_waitlist_requested_at`.
- No email notification.
- No admin UI.
- Paid launch hold reason: `held_no_ein`, non-retryable, with "Add your EIN" CTA.

Fail-closed server gates in Option B:
- `/api/billing/checkout` blocks Checkout unless `has_ein IS TRUE`.
- `attemptPaidLaunch()` blocks before `telnyx_submission_disabled`, billing readiness, risk clearance, registration-attempt claim, Telnyx calls, profile creation, voice app creation, number purchase/attach, or assignment unless `has_ein IS TRUE`.
- `null` and `false` are both blocked.

### Sole Prop OTP flow — VERIFIED programmatic via Telnyx API (no manual email)

**Future Option A scope. Nothing in this subsection shipped in Option B.**

Three Telnyx 10DLC API endpoints:
1. `POST /v2/10dlc/brand` — submits Sole Prop info, returns `brandId` with `identityStatus: PENDING`.
2. `POST /v2/10dlc/brand/{brand_id}/smsOtp` — Telnyx auto-sends SMS PIN to the customer's mobile.
3. `POST /v2/10dlc/brand/{brand_id}/smsOtp/verify` — customer's PIN verifies the brand.

The "email 10dlcquestions@telnyx.com" workflow in some docs is a **manual fallback for dashboard registration only** — NOT relevant to API-based registration. The API path is fully automated (~5 min from the customer's view).

**OTP UX requirements:**
- Inline onboarding step (not modal/redirect): "We texted a 6-digit code to (XXX) ***-XXXX. Enter it below."
- "Resend code" button (re-calls trigger) — customer-initiated, no auto-resend.
- Distinguish error types in verify response: incorrect PIN vs expired PIN vs network error.
- Limit retries (3–5) before forcing a re-trigger.
- Validate mobile at form-submit: warn/block VoIP numbers (Google Voice, etc.) — TCR's SMS OTP often fails on VoIP. Use Telnyx Lookup API or equivalent.
- Copy: "Use a personal mobile number you own — this is how we verify your identity." (TCR checks the same human owns the SSN and controls the phone.)

**TCR is stricter on Sole Prop** (historically abused by spammers) — higher rejection rates. Build copy around this expectation.

**Sole Prop is NOT tier-mapped:** Sole Prop customers can use any of the $25/$45/$65 tiers; they just can't have multiple phone numbers regardless of tier. The "1 number max" is an orthogonal constraint, not a tier limitation. Only re-introduce tier-mapping if a future tier explicitly requires multiple numbers (that tier would be Standard-Brand-only).

**Implementation cost:** supporting both paths is ~1.5x the work (not 2x). Shared: form skeleton, status UI, webhook handlers, schema. Diverging: brand registration call shape, OTP collection step, rejection handling, limit messaging.

**On startup, grep `telnyx_registration_events` for `audit_only_phase_11_otp` rows** — `BRAND_OTP_VERIFIED` events that arrived before Phase 11 was built are waiting there (Phase 4 note).

**Deferred Sole Proprietor / Option A scope:**
- Sole Prop brand registration payload and Telnyx `POST /v2/10dlc/brand` shape.
- Telnyx `smsOtp`, `smsOtp/verify`, and OTP status handling.
- Inline OTP onboarding step.
- Customer-initiated resend only; no auto-resend.
- Incorrect vs expired vs network error handling.
- 3–5 retry limit before forcing a re-trigger.
- Last-4 SSN and registrant mobile collection.
- VoIP mobile validation at form submit.
- Sole Prop rejection handling.
- 1-number / 1-campaign / throughput enforcement.
- Mock-brand OTP testing after Telnyx support confirms mock behavior.

After Phase 11 Option B is complete and tested, complete the **Pre-Launch Checklist** before the first real customer. Future Sole Prop/OTP support remains a separate Option A phase.

---

## Pre-Launch Checklist 🔒

Required steps between "Phase 11 complete and tested" and "first real customer":

1. [x] **Stripe LIVE mode setup:** recreate all 5 products/prices in live mode: 3 monthly plans at $25 / $45 / $65, the $25 one-time setup fee, and the $0.03 SMS overage part. Put the live price IDs plus the `sk_live_...` secret key in Railway. — Done: live products/prices/IDs configured.
2. [ ] **Live webhook endpoint:** create a Stripe Dashboard webhook endpoint in live mode for the production domain at `/api/stripe/webhook`. Subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, and `invoice.payment_failed`. Put its `whsec_...` signing secret in Railway.
3. [x] **Code change:** remove the test-mode-only guard (`sk_live` rejection plus test-price `livemode` assertion). This must be a deliberate commit via the standard plan → review → implement flow. — Done in commit `4bfb5db` (removed the `cs_test_` check, `assertTestModePrice`, and `validateStripeTestModeEnv`).
4. [ ] **Regenerate `A2P_REVIEW_ADMIN_TOKEN` in Railway.** The current value was exposed in screenshots.
5. [x] **Build call forwarding feature (plan → review → implement):** call forwarding is confirmed to require implementation, not configuration. Portal forwarding is unavailable for numbers attached to voice applications. Build it programmatically: answer inbound → bridge to the owner's number with a short ring timeout → on no-answer, existing missed-call flow takes over. Add a per-business dashboard setting (toggle + forward-to number), voicemail-steal mitigation via short timeout, and a margin note because both call legs are billed per minute. — Shipped: commit `1572f11`, migration `022`.
6. [ ] **Fresh clean-account EIN test on REAL Telnyx:** create a new account with a real EIN, real payment, and `telnyx_submission_disabled = false`; run the full pipeline through carrier review to SMS-ready. Expect roughly $14 in real fees. This is the locked end-to-end validation before any customer.
7. [ ] **Post-approval product validation on the real EIN account:** verify inbound SMS gets an AI reply using that business's real context; missed call triggers the auto-text and AI follow-up conversation; STOP opt-out is honored; conversations and usage are recorded in the dashboard/meter; and call forwarding from the Telnyx number to the owner's real phone is working.
8. [ ] **Re-verify pricing before launch:** re-check Telnyx SMS/MMS/number costs, Stripe fees, and margin math from the Phase 9 pricing note.
9. [ ] **Production smoke pass:** verify the admin console, checkout with a real card (refund after), and customer-visible usage display.
10. [ ] **Only after all above:** onboard the first real customer. Do not onboard many customers before validating billing behavior on the first ones.

---

## Post-MVP Add-ons

### SimpleAssist Mobile Inbox

Business owners cannot text from their Telnyx/SimpleAssist number through their native iPhone or Android Messages app because the number lives in Telnyx, not on their SIM/carrier account.

Long-term, SimpleAssist should provide a mobile-friendly inbox or native app where owners can:
- receive notifications for new SMS conversations;
- read full conversation history;
- reply manually from the SimpleAssist/Telnyx number;
- review or approve AI-drafted replies;
- manage missed-call follow-up conversations;
- keep all customer messaging inside SimpleAssist.

Product framing:
> "Use your SimpleAssist number as your public business number. Calls forward to you, missed calls get automatic follow-up, and texts are managed inside SimpleAssist."

This is not required before launch. Prioritize campaign approval, number assignment, SMS send/receive reliability, onboarding, billing, and usage caps first.

---

## Sequencing Recommendation

1. Phases 1 + 2 (data model + onboarding fields) — unblocks everything. ✅
2. Phases 3 + 4 (Telnyx API + status webhook). ✅
3. Phase 5 (status UI). ✅
4. Phases 6, 7, 8 can run in parallel.
5. Phases 9, 10 are decisions only — implementation hooks during 7/8.

---

## Production Cautions

- **Telnyx has no true sandbox.** Brand/campaign registration hits real TCR and goes on a permanent record. The only test affordance is `mock: true` (SDK + dashboard checkbox), whose fee/TCR-skip behavior is **not documented publicly** — confirm with Telnyx support (`10dlcquestions@telnyx.com`) before relying on it. The real validation that matters is an end-to-end run with a real EIN brand.
- **Brand/campaign fees are real money on real submissions** (~$4 brand + ~$10/mo campaign). Don't burn fees iterating on payload shape — use mock mode or code review first.
- **Approvals are async and slow:** brand hours–2 days; campaign 1–5+ days (per-carrier review). UX must handle the waiting period gracefully.
- **Pre-approval throttling** (~1 msg/sec) applies until campaign approval — handle in app.
- **Check every new SDK field against the spec.** The Phase 3 missing-privacy-URL bug shipped silently because optional fields produce no error when omitted.
- **Never log or project PII** (`ein`, `last_4_ssn`, `registrant_mobile`, `authorized_rep_*`, tax IDs) outside the strict registration path. Public routes use explicit column projections, not `select(*)`.

---

## Key Files & Modules

- `src/lib/messaging/registration/` — brand.ts, campaign.ts, messagingProfile.ts, voiceApplication.ts, phoneNumberAssignment.ts, legalUrls.ts, statusMapper.ts
- `src/lib/messaging/lookup.ts` — `getOutboundSendContext()` (use for all outbound paths)
- `src/lib/messaging/pausedNotice.ts` — paused-notice dedupe
- `src/lib/email/` — Resend client + registration status templates (first email infra)
- `src/lib/legal/perBusinessCopy.ts`, `src/lib/util/slug.ts`
- `src/app/api/messaging/registration/status/route.ts` — status webhook
- `src/app/api/onboarding/brand-verification/route.ts` — fires Phase 3 registration on first submit
- `src/app/api/settings/compliance/route.ts` — compliance modes + URL reachability check
- `src/app/(public)/c/[slug]/{privacy,terms}/page.tsx` + landing — public per-business pages
- `src/components/dashboard/A2pStatusCard.tsx`, `src/components/settings/CompliancePanel.tsx`, `src/components/onboarding/BrandVerificationForm.tsx`
- `supabase/migrations/012`–`024` — Phases 1–11 plus call forwarding (`022`), atomic saves (`023`), and rejected-campaign history (`024`); see **Migrations applied** near the top for the breakdown
