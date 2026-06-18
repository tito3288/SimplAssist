# Per-Customer A2P 10DLC Roadmap (Telnyx)

**Status as of 2026-06-18:** Phases 1–6 shipped to production, plus a post-Phase-6 "readiness safeguards" layer (informally "6.5"). Phase 7 (onboarding flow restructure) is next.

This is the shared source of truth for the per-customer A2P (Application-to-Person) 10DLC compliance initiative. It is the canonical reference for any agent or human working on Phase 7+. Compare implementation against this document rather than reconstructing context from scattered code comments.

> **What does NOT belong in this file:** secrets, API keys, access tokens, real customer PII, EINs, SSNs, or private business data. Architecture, flow logic, phase specs, and locked decisions only.

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
| 7 | Onboarding flow restructure | ⏳ Next |
| 8 | Use case screening + AI guardrails | ⏳ Pending |
| 9 | Cost handling | 🔒 Decisions locked, implementation pending |
| 10 | Number purchasing timing | 🔒 Decision locked, implementation pending |
| 11 | EIN vs Sole Proprietor branching + SMS OTP | ⏳ Pending |

**Migrations applied:** `012`–`016` cover Phases 1–6.5. See `supabase/migrations/`.

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
- **Business-type → Telnyx vertical mapping gap** (Phase 7/8 follow-up). `toTelnyxVertical(businessType)` in `brand.ts` maps our `business_type` enum to Telnyx's 23-value Vertical taxonomy. Current coverage: `plumber`/`hvac`→CONSTRUCTION, `dentist`→HEALTHCARE, `restaurant`→HOSPITALITY, `car_wash`/`auto_shop`/`salon`/`general`/`other`→PROFESSIONAL. **Gap:** real estate, legal, financial, insurance, retail fall back to PROFESSIONAL, which can trigger MNO review friction (especially T-Mobile). Fix options: expand the Step 1 dropdown + mapping, OR add a vertical-override question in Step 5 shown only when `business_type='other'`.

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
  - Phase 7 should include the customer UX for rejected states, but the first controlled Alpha Dog EIN test can proceed without this so any real rejection teaches which recovery path matters first.
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

## Phase 7 — Onboarding Flow Restructure ⏳ (NEXT)

- **Current:** signup → business info → pick number → done.
- **New:** signup → basic info → detailed business info + rep → use case + sample messages → pay → status/waiting screen → pick number when brand approved → activation when campaign approved.
- Telnyx has no "profile approval" stage — two stages only (brand approval, then campaign approval).

**Carry-forward constraints:**
- Keep the `A2pStatusCard` null-gate (Phase 5) — onboarding has its own step-by-step status UX.
- Consider closing the business-type/vertical mapping gap here (Phase 3 note).

---

## Phase 8 — Use Case Screening + AI Guardrails ⏳

- Reject prohibited use cases at signup via a single checkbox. **Locked-in 9 prohibited categories:** cannabis/CBD, adult content/escort/dating, gambling/sports betting, payday loans/debt collection, crypto/get-rich-quick, political messaging, firearms, MLM, prescription drugs/pharmacy.
- Tighten `src/lib/ai/prompt.ts` so the AI never drifts into promotional/marketing messaging — must stay within the registered Customer Care use case, or campaigns get pulled.

---

## Phase 9 — Cost Handling 🔒 (decisions locked, implementation pending)

Brand registration costs by tier:
- Sole Proprietor brand: free or ~$2 one-time
- Low Volume Standard brand: ~$4 one-time (**confirmed actual cost** — earlier $15 estimates were wrong; most SimplAssist customers land here)
- Standard brand: ~$44 one-time (only for higher throughput)

Campaign registration: ~$10/month per campaign (any brand tier).

**Locked decision:** a **$25 one-time setup fee** at signup absorbs brand cost + first month of campaign ($4 + ~$10 = ~$14, comfortably under $25). Recurring $10/month campaign fee absorbed into existing $25/$45/$65 tier pricing. **No separate "compliance line item"** on customer invoices.

Pre-approval rate limits: providers throttle heavily (often 1 msg/sec) until campaign approved — handle gracefully.

---

## Phase 10 — Number Purchasing Timing 🔒 (decision locked, implementation pending)

**Locked decision:** number purchased immediately during onboarding (current flow). SimplAssist eats ~$1.20/customer in wasted phone cost during the 1–5 day approval window — acceptable tradeoff for onboarding momentum vs forcing a "pick number after approval" wait.

---

## Phase 11 — EIN vs Sole Proprietor Branching + SMS OTP ⏳

Customers may not have an EIN. TCR supports a Sole Proprietor brand tier. Onboarding must handle both.

**Branching question at signup:** "Do you have an EIN (federal Tax ID)?"

### EIN path → Standard Brand
- Most customers (est. 80–85%): med spas, dental offices, car washes, established roofers — almost all LLC/Corp with EIN.
- Collect: legal entity name, EIN, business type, business address, authorized rep.
- Tier: Low Volume Standard (~$4) default.
- No OTP step — TCR validates EIN against IRS data.

### No-EIN path → Sole Proprietor Brand
- Est. 15–20%: solo cleaners, photographers, trainers, side-hustle freelancers.
- Collect: personal legal name (no LLC/Corp), home/business address, mobile phone, last 4 SSN.
- TCR sends OTP via SMS to registrant's mobile (24-hour window).
- Tier: Sole Proprietor (free or ~$2).
- Product restrictions to enforce: 1 phone number per campaign, 1 campaign per brand, throughput 1 msg/sec (15/min AT&T, 1,000/day T-Mobile), owner must be the operator personally. For missed-call Customer Care, 1 msg/sec is plenty.

**Encourage EIN with UX copy on the No-EIN path:**
> "Don't have an EIN? You can get one free from the IRS in about 15 minutes — [Get an EIN]. This unlocks higher message limits and faster approval. Or continue without one (limited mode)."

### Sole Prop OTP flow — VERIFIED programmatic via Telnyx API (no manual email)

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
- `supabase/migrations/012`–`016` — Phases 1–6.5
