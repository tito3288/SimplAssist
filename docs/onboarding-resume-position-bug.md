# Onboarding Resume-Position Bug — Mechanism and Fix

**Symptom:** on an account with data already saved for later steps, navigating Back to an earlier step and clicking Next fast-forwards to the furthest incomplete step instead of advancing one step.

## Mechanism

Two concerns share one code path:

1. Every step form's Next is wired as `onNext={() => refreshState()}` (`src/app/(onboarding)/onboarding/page.tsx`): the form saves, then the page refetches `/api/onboarding/state`.
2. `loadState()` without `keepStep: true` repositions the UI: `setStep(payload.state.currentStep)`.
3. The server's `currentStep` is `deriveOnboardingStep()` (`src/lib/onboarding/state.ts:642`), a waterfall returning the **first incomplete step** from saved Supabase data — i.e. the *resume position*.

On a fresh account, "first incomplete" always equals "the step after the one just saved", so the conflation is invisible. On a returning account with steps 1–5 saved, Back is a local `setStep`, but the next save re-snaps the UI to the derived resume position (step 5+). Resume-position logic — correct on page load — was also running on every save.

Nothing is wrong in the data: later steps' saved rows are never touched by this. It is purely a UI-positioning defect.

## Fix (UI step positioning only)

- Add `nextStepOf(step)` — the successor in the canonical `ONBOARDING_STEPS` order from `@/lib/onboarding/types` (clamped at the final step).
- Each plain Next becomes: advance locally, then refresh data **without repositioning** —
  `onNext={() => { setStep(nextStepOf(step)); refreshState({ keepStep: true }); }}`
  using the `keepStep` escape hatch that already exists and is already used by the carrier-review flow in the same file.
- **Resume-on-load is unchanged:** the initial `refreshState()` on mount still calls `loadState()` without `keepStep`, landing returning users on their first incomplete step.
- Fresh accounts behave identically (derived step == locally advanced step at every point of the funnel).

Out of scope, untouched by design: every step form, all validation and save handlers, the `has_ein` / `held_no_ein` waitlist branches, ReviewAndLaunch's launch-hold gating, and all server-side API gates.

## The three flagged details

1. **Stripe checkout/finalize snap — kept.** The `?checkout=success` effect explicitly calls `setStep(payload.state.currentStep …)` after `/api/billing/finalize`; returning from Stripe must land on the server-derived position (normally `carrier_review`). Not modified.
2. **Phone-number purchase snap — kept.** `onPurchased={() => refreshState()}` still snaps to the derived step after a number purchase, because purchase outcomes (e.g. registration auto-start, failure states) are server-determined. Only the step's plain `onNext` advances locally (`phone_number` → `review_submit`).
3. **Editing an early step that invalidates a later prerequisite.** With local stepping, the user may walk forward past a step the server now considers incomplete. This is acceptable and safe: (a) the server re-derives the resume position on every load, so a refresh lands them on the truly-first-incomplete step; (b) launch is gated server-side (ReviewAndLaunch hold logic and the submit-registration API validate prerequisites regardless of UI position); (c) no data is lost or skipped — the UI position is presentation only. The alternative (snap-forward on save) is the bug this fix removes.

## Verification cases

1. Fresh account 1→9: each Next advances exactly one step (derived == local at every point).
2. Returning account, mid-wizard: initial load resumes at first incomplete step (unchanged).
3. Back from resume position to an earlier step, then Next: advances exactly one step — no fast-forward.
4. Edit an early step that invalidates a later prerequisite: local Next still advances one step; a reload re-derives honestly; launch gates still enforce prerequisites.
5. Stripe return (`?checkout=success`): snaps to derived step (unchanged path).
6. Phone-number purchase: `onPurchased` snaps to derived step; the step's own Next advances locally.
