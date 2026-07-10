# Button Corner-Radius Audit — 2026-07-09

Audit only. This document reproduces the audit as generated on 2026-07-09, before any remediation. It catalogs the corner-radius of every button (and button-styled `Link`/`<a>`) across onboarding, dashboard, settings, widget, billing, admin, account, auth, and the public/homepage, tracing every button through the shared component and class tokens to its real radius.

> Note (added at time of writing this file): after this audit, `src/components/ui/Button.tsx:47` was changed from `rounded-lg` to `rounded-full` on `main`. The tables below reflect the pre-fix state as originally generated.

## The bottom line

The pill standard (`rounded-full`) is used in **exactly three places**: the v2 homepage/nav CTAs, the v2 auth submit buttons, and the onboarding **Phone Number** step's Next/Back. **Everywhere else in the app is non-pill.** There are two root causes:

1. **The shared `<Button>` component hardcodes `rounded-lg`** (`src/components/ui/Button.tsx:47`) and is never overridden — so every `<Button>` renders a slightly-rounded rectangle.
2. **Copy-pasted inline CTA strings** — nearly every onboarding step and settings/widget form hand-rolls its own Save/Next/Back button with `rounded-lg` or an arbitrary `rounded-[22px]`/`rounded-[18px]`/`rounded-[20px]`, none referencing the compliant `primaryCtaClass` token. There's no shared wizard footer, so the deviation is duplicated ~7× in onboarding alone.

Even the deviations aren't consistent: onboarding mixes `rounded-lg` (older steps) with `rounded-[22px]` (EIN-era steps); admin uses `rounded-md`; the copy/link chrome uses `rounded-md`; billing/settings use `rounded-lg`.

## Token / component reference

| Token / Component | Defined in | Radius | Pill? |
|---|---|---|---|
| `Button` (base) | `src/components/ui/Button.tsx:47` | `rounded-lg` | ❌ **deviation source** |
| `primaryCtaClass` | `src/lib/glass.ts:51` | `rounded-full` | ✅ (imported by **no** in-app screen) |
| `btnPrimary` / `btnSecondary` / `btnPrimaryWide` | `src/lib/theme-v2/theme.ts` | `rounded-full` | ✅ (homepage + auth only) |

## Deviations — Onboarding wizard

| File | Button | Radius | Deviates? |
|---|---|---|---|
| `(onboarding)/onboarding/page.tsx:139` | Try again | `rounded-lg` (Button default) | YES |
| `(onboarding)/onboarding/page.tsx:451` | Refresh status | `rounded-lg` (Button default) | YES |
| `(onboarding)/onboarding/page.tsx:456` | Go to dashboard | `rounded-lg` (Button default) | YES |
| `(onboarding)/onboarding/page.tsx:460` | Retry registration | `rounded-lg` (Button default) | YES |
| `components/onboarding/OnboardingSignOut.tsx:22` | Sign out | `rounded-[20px]` | YES |
| `components/onboarding/BusinessInfoForm.tsx:200` | Scan Website | `rounded-[22px]` | YES |
| `components/onboarding/BusinessInfoForm.tsx:290` | Next | `rounded-[22px]` | YES |
| `components/onboarding/BusinessHoursForm.tsx:120` | Back | `rounded-lg` | YES |
| `components/onboarding/BusinessHoursForm.tsx:127` | Next | `rounded-lg` | YES |
| `components/onboarding/ServicesAndFaqsForm.tsx:314` | Back | `rounded-lg` | YES |
| `components/onboarding/ServicesAndFaqsForm.tsx:321` | Next | `rounded-lg` | YES |
| `components/onboarding/AIPersonalityForm.tsx:285` | Back | `rounded-lg` | YES |
| `components/onboarding/AIPersonalityForm.tsx:292` | Next | `rounded-lg` | YES |
| `components/onboarding/SmsUseCaseForm.tsx:270` | Restore recommended draft | `rounded-[18px]` | YES |
| `components/onboarding/SmsUseCaseForm.tsx:446` | Back | `rounded-[22px]` | YES |
| `components/onboarding/SmsUseCaseForm.tsx:453` | Next | `rounded-[22px]` | YES |
| `components/onboarding/BrandVerificationForm.tsx:466` | Back | `rounded-[22px]` | YES |
| `components/onboarding/BrandVerificationForm.tsx:473` | Next / Join waitlist | `rounded-[22px]` | YES |
| `components/onboarding/ReviewAndLaunch.tsx:423` | Back | `rounded-lg` | YES |
| `components/onboarding/ReviewAndLaunch.tsx:431` | Launch / pay CTA | `rounded-lg` | YES |

## Deviations — Dashboard / Settings / Widget

| File | Button | Radius | Deviates? |
|---|---|---|---|
| `components/ui/Button.tsx:47` | **Shared `<Button>` base (systemic)** | `rounded-lg` | YES |
| `app/(dashboard)/dashboard/page.tsx:109` | Connect Now | `rounded-lg` | YES |
| `app/(dashboard)/_components/sidebar.tsx:75` | Nav item (active pill) | `rounded-[22px]` | YES |
| `app/(dashboard)/_components/sidebar.tsx:146` | Mobile menu icon | `rounded-lg` | YES |
| `components/settings/BusinessEmailForm.tsx:57` | Save | `rounded-lg` | YES |
| `components/settings/CallForwardingForm.tsx:142` | Save | `rounded-lg` | YES |
| `components/settings/AISettingsForm.tsx:342` | Save | `rounded-lg` | YES |
| `components/settings/BusinessHoursEditor.tsx:114` | Save | `rounded-lg` | YES |
| `components/settings/ServicesManager.tsx:223` | Save | `rounded-lg` | YES |
| `components/settings/ServicesManager.tsx:273` | Add Service | `rounded-lg` | YES |
| `components/settings/FAQManager.tsx:215` | Save | `rounded-lg` | YES |
| `components/settings/FAQManager.tsx:261` | Add FAQ | `rounded-lg` | YES |
| `components/settings/CompliancePanel.tsx:276` | Save | `rounded-lg` | YES |
| `components/settings/CompliancePanel.tsx:362` | Privacy/Terms preview | `rounded-md` | YES |
| `components/settings/CompliancePanel.tsx:390` | Copy | `rounded-md` | YES |
| `components/settings/GoogleCalendarConnect.tsx:53` | Disconnect | `rounded-lg` | YES |
| `components/settings/GoogleCalendarConnect.tsx:66` | Connect Google Calendar | `rounded-lg` | YES |
| `components/settings/DangerZone.tsx:21` | Delete Account | `rounded-lg` (Button default) | YES |
| `components/settings/DeleteAccountModal.tsx:80` | Cancel | `rounded-lg` (Button default) | YES |
| `components/settings/DeleteAccountModal.tsx:88` | Delete My Account | `rounded-lg` (Button default) | YES |
| `components/widget/WidgetConfigForm.tsx:520` | Save widget | `rounded-lg` | YES |
| `components/widget/WidgetConfigForm.tsx:111` | Change logo | `rounded-lg` | YES |
| `components/widget/WidgetConfigForm.tsx:120` | Remove logo | `rounded-lg` | YES |
| `components/widget/WidgetConfigForm.tsx:131` | Logo dropzone | `rounded-xl` | YES |
| `components/widget/WidgetConfigForm.tsx:288` | Position selector | `rounded-lg` | YES |
| `components/widget/WidgetConfigForm.tsx:407` | Delete quick-reply | `rounded-lg` | YES |
| `components/widget/WidgetConfigForm.tsx:415` | Add quick reply | `rounded-lg` | YES |
| `components/widget/EmbedCodeGenerator.tsx:31` | Copy embed code | `rounded-md` | YES |
| `components/widget/WidgetPreview.tsx:60` | Open in New Tab | `rounded-lg` | YES |
| `components/ui/ErrorBoundary.tsx:44` | Try Again | `rounded-lg` | YES |
| `components/ui/ErrorBoundary.tsx:48` | Go to Dashboard | `rounded-lg` | YES |

## Deviations — Billing / Admin / Account / Auth

| File | Button | Radius | Deviates? |
|---|---|---|---|
| `app/(dashboard)/billing/billing-actions.tsx:54` | Manage Subscription (Stripe portal) | `rounded-lg` | YES |
| `app/(dashboard)/billing/billing-actions.tsx:65` | Subscribe (Stripe checkout) | `rounded-lg` | YES |
| `app/admin/A2pApproveForm.tsx:62` | Approve current hash | `rounded-md` | YES |
| `app/admin/AdminFlagForm.tsx:88` | Save flags | `rounded-md` | YES |
| `app/admin/page.tsx:137` | Account row link (clipped by `rounded-lg` parent) | `rounded-lg` (edge case) | YES |
| `components/account/ReactivationCard.tsx:71` | Reactivate My Account | `rounded-lg` (Button default) | YES |
| `components/account/ReactivationCard.tsx:80` | Sign Out | `rounded-lg` (Button default) | YES |
| `lib/theme-v2/ui.tsx:165` | Password show/hide (icon, in auth inputs) | `rounded-xl` | YES (minor) |

## Compliant (`rounded-full`) — for reference

- **Homepage** CTAs (nav, hero, pricing ×3, bottom CTA) — via `btnPrimary`/`btnSecondary`/`btnPrimaryWide`.
- **Auth** submit buttons ("Sign in", "Create account") and both theme toggles.
- **Onboarding Phone Number step** Next/Back (`page.tsx:347/354`) — the lone pill pair in the whole wizard.
- Legitimately circular controls (not CTAs): all toggle switches, color swatches, theme-toggle icon — correctly `rounded-full`; **not** deviations.

## Notes on scope

- **Inputs/textareas:** every screen's fields are self-consistent internally (onboarding uses `rounded-lg` or `rounded-[22px]` uniformly per step; admin uses `rounded-md`), so none are flagged per the "only if inconsistent within the same screen" rule. Worth knowing they still differ *across* screens, but that wasn't in scope.
- **Excluded** as not button-styled: plain text links, "+ Add" text actions, trash/X icon-only buttons with no background, and radio-option `<label>` cards.

## Suggested remediation

The highest-leverage fix is a two-parter: change `Button.tsx:47` `rounded-lg → rounded-full` (clears the account/settings-modal cluster in one line), then sweep the copy-pasted inline CTAs — replacing them with the existing `primaryCtaClass` token so they can't drift again. Best done as one commit per area for reviewability.
