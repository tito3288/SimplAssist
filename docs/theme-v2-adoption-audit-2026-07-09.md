# Theme-v2 Adoption Audit — 2026-07-09

Audit only — no code changes. 79 surfaces catalogued across onboarding, dashboard, settings, widget, billing, admin, auth, account, and public pages; every imported token resolved to what it actually renders.

**Current state:** only `/home`, the auth pages, and the previews are on `theme-v2`. Everything else runs on the v1 `glass.ts` system (right shapes, cool slate palette, glow/gradient CTAs), hand-rolled styling, or a mix. Dark mode is already close to v2 nearly everywhere (the dashboard layout's dark ambient is byte-identical to `darkAmbient`); **the real migration is light mode** — cool slate shells and white/70 glass vs. warm `#faf8f4` + true-white matte cards — plus killing the glow/gradient CTA family.

## Systemic findings

1. **v2 is missing vocabulary the app needs.** Before any mechanical migration: compact/inline matte pill sizes, a `Switch` toggle (hand-rolled 7×), a selectable option-card (radio-card pattern in 6 files), semantic status tokens (success/warning/danger/info banners and badges appear in ~15 files), a toast recipe, and a nav-rail treatment.
2. **Two sources of CTA truth.** Most buttons resolve to the four glass pill tokens (retarget = one move), but `ui/Button.tsx` *duplicates* the v1 palette inline rather than importing it, and three files inline the glow recipe verbatim (`WidgetConfigForm` save, onboarding `PhoneNumberStep`, `DashboardOverview` banner) — they silently survive any token retarget.
3. **Light-mode accent misuse is everywhere:** `#ff914d` (v2's dark-only accent) drives light-mode links, focus rings, progress bars, and selections app-wide; v2 wants `#ea580c`/`#c2410c` in light.
4. **`globals.css` is the root dependency** (Arial body font, pure-white `--background`, `.floating-nav` with an invisible light-mode border, fixed-color `.dot`). Changing it restyles every unmigrated page at once — sequence it last.
5. **v2 adoption fixes three real bugs for free:** `ErrorBoundary` has zero dark-mode styling (slate-900 text on black), `Toast` is theme-blind with an off-brand blue, and the calendar modals force `[color-scheme:dark]` on light-theme native time pickers.
6. **Ready-made v2 twins already exist** for `theme-toggle` (ThemeToggleV2), `auth-password-field` (AuthPasswordFieldV2), and `fade-in` (Reveal) — those are swaps, not redesigns.

## Deviation tables

### Onboarding (12 surfaces)

| File | Renders | Hardcodes | Dev. |
|---|---|---|---|
| `(onboarding)/layout.tsx` | page shell + card framing all 9 steps | cool slate page bg, orange orbs, glassCard, Arial, no motion | MED |
| `(onboarding)/onboarding/page.tsx` | step orchestrator, phone step | inline v1 glow CTA copies, white/70 banners, orange icon tiles, slate text | HIGH |
| `(onboarding)/onboarding/page.tsx` | carrier-review status panel | hand-copied glassCardSubtle, amber banners, orange-gradient tiles | HIGH |
| `onboarding/StepProgress.tsx` | 9-step progress bar | slate track, `#ff914d` fill/dots both themes, ring glow | HIGH |
| `onboarding/OnboardingSignOut.tsx` | sign-out pill | v1 compact secondary + bg override | MED |
| `onboarding/BusinessInfoForm.tsx` | step 1 form | authInputClass duplicated inline ~10×, glow CTA, orange-tint ghost | HIGH |
| `onboarding/BusinessHoursForm.tsx` | step 2 hours rows | rounded-lg rows, hand-rolled switch, slate inputs, glow CTAs | HIGH |
| `onboarding/ServicesAndFaqsForm.tsx` | step 3 editors | oldest rounded-lg inputs/tiles, orange-tint banner, glow CTAs | HIGH |
| `onboarding/AIPersonalityForm.tsx` | step 4 AI form | radio cards, slate selects, `#ff914d` slider, duplicate switch, glow CTAs | HIGH |
| `onboarding/BrandVerificationForm.tsx` | step 5 EIN form | local INPUT/LABEL consts (v1 copies), radio cards, amber/green banners | MED |
| `onboarding/SmsUseCaseForm.tsx` | step 6 use case | v1 input consts, sample tiles, 3 banner variants, orange chips | MED |
| `onboarding/ReviewAndLaunch.tsx` | step 8 review + checkout | 8 glassCardSubtle copies (local `Section`), plan tiles, 4 semantic banners, enlarged glow CTA | MED |

### Dashboard core (17 surfaces)

| File | Renders | Hardcodes | Dev. |
|---|---|---|---|
| `(dashboard)/layout.tsx` | app shell | cool slate light bg (dark already = v2), orbs, Arial | MED |
| `_components/sidebar.tsx` | sidebar + mobile drawer | white/90 glass panel, slate borders, `#ff914d` active pill, hand-rolled drawer motion | MED |
| `dashboard/page.tsx` | heading + calendar banner | inline slate text, glassCard + amber override, glowing amber dot | MED |
| `contacts/page.tsx`, `calendar/page.tsx` | page headings | inline/v1 slate text tokens only | LOW |
| `dashboard/DashboardOverview.tsx` | stat cards, lists, quick actions, modal | glassCard everywhere, inline glow CTA, hand-rolled pure-white empty state + quick-actions panel + modal, blue badges | HIGH |
| `dashboard/A2pStatusCard.tsx` | A2P status card | glassCard, orangeAccentIcon, red banner; gated on shared Badge | MED |
| `conversations/InboxLayout.tsx` | two-pane inbox shell | glassCard, slate borders, `#ff914d` back link | MED |
| `conversations/ConversationList.tsx` | list + filters + delete modal | all inline: rounded-lg search, `#ff914d` tab underline, purple/amber badges, red/slate modal pills | HIGH |
| `conversations/MessageThread.tsx` | thread + composer | blue-500 AI bubble (light), green agent bubble, v1 gradient dark bubbles, rounded-lg composer, purple/amber banners | HIGH |
| `contacts/ContactStats.tsx` | 4 stat cards | glassCard + orangeAccentIcon + v1 text (pure token swap) | MED |
| `contacts/ContactsTable.tsx` | toolbar + table | glassCard, glassInput, hand-rolled segmented control, slate header/hover, green/yellow/gray + violet badges | MED |
| `contacts/ContactDetail.tsx` | slide-over drawer | hand-rolled drawer chrome, glassInput at wrong radius, gray-400 labels, red/slate buttons | MED |
| `calendar/CalendarView.tsx` | month grid + panels | glassCard shell, glow-shadow gradient event cards, v1 glow CTA, rounded-xl cells, red/slate modal pills | MED |
| `calendar/CreateEventModal.tsx` / `EditEventModal.tsx` | event forms | authInputClass, primaryCtaClass (glow), `[color-scheme:dark]` forced in light | MED |

### Settings / widget / billing (21 surfaces)

| File | Renders | Hardcodes | Dev. |
|---|---|---|---|
| `settings/page.tsx` | 7 section shells | glassCard (single import), inline slate text | MED |
| `widget/page.tsx` | loader/error fallback | slate/red text only | LOW |
| `widget/WidgetPageClient.tsx` | header + card grid | glassCard ×3, slate header | MED |
| `billing/page.tsx` | plan cards + usage | glassCard, orange glow on recommended card + gradient badge, green/amber/red usage bar | MED |
| `billing/billing-actions.tsx` | Stripe CTAs | glass pill token (glow) — auto-converts on retarget | MED |
| `settings/AISettingsForm.tsx` | AI settings form | radio cards, gray selects, hand switch, `#ff914d` slider, calendar tile has no light-mode styling, glow CTA | HIGH |
| `settings/BusinessEmailForm.tsx` | email + save | one hand-rolled input, glow CTA | MED |
| `settings/BusinessHoursEditor.tsx` | hours rows | rounded-lg rows, hand switch, gray time inputs, glow CTA | HIGH |
| `settings/CallForwardingForm.tsx` | forwarding panel | inline glass-lite panel, native checkbox (inconsistent), glow CTA | HIGH |
| `settings/CompliancePanel.tsx` | mode picker + banners | all hand-rolled: amber banners, radio cards, pill links, mono textarea, glow CTA | HIGH |
| `settings/DangerZone.tsx` | delete card | inlined glassCard copy with red border (survives token retarget) | MED |
| `settings/DeleteAccountModal.tsx` | confirm modal | red tile, glassInput; gated on shared Modal/Button | MED |
| `settings/FAQManager.tsx` / `ServicesManager.tsx` | list editors (twins) | rounded-lg rows, hand switches, ~6 duplicated gray inputs each, purple/yellow badges, orange-tint add form, glow compact CTAs | HIGH |
| `settings/GoogleCalendarConnect.tsx` | connect row | hand-rolled pills, glowing green status dot | MED |
| `settings/PhoneNumberSection.tsx` | active-number banner | green banner/chip/badge, `#ff914d` link | MED |
| `settings/TimezoneSelector.tsx` | timezone select | glassInput (one-line swap) | MED |
| `widget/EmbedCodeGenerator.tsx` | code terminal | deliberate dark terminal (keep); copy pill + surrounding text need v2 | MED |
| `widget/WidgetConfigForm.tsx` | appearance form | position cards, hex tile, 3 hand switches, inline verbatim v1 glow save button, welcome textarea missing light styles | HIGH |
| `widget/WidgetPreview.tsx` | browser mockup | slate frame, traffic dots, v1 compact button | MED |
| `account/ReactivationCard.tsx` | reactivation panel | v1 slate text + glow Button inside the already-v2 auth shell — most visible v1-on-v2 clash | MED |

### Admin + shared UI (18 surfaces)

| File | Renders | Hardcodes | Dev. |
|---|---|---|---|
| `admin/layout.tsx` | admin shell | bg-slate-50, no ambient, Arial | HIGH |
| `admin/page.tsx` | metrics + accounts list | local Metric/Badge helpers, rounded-lg white cards, slate everything | HIGH |
| `admin/[businessId]/page.tsx` | business detail | local Card/Row, rounded-lg, `#ff914d` light link | HIGH |
| `admin/A2pApproveForm.tsx` / `AdminFlagForm.tsx` | forms | rounded-md textareas, `#ff914d` checkboxes, glow compact CTA | MED |
| `ui/Button.tsx` | shared Button (4 variants) | inline duplicate of v1 glow palette — highest-leverage retarget | MED |
| `ui/Modal.tsx` | all app modals | white card no border light / opaque dark, slate text, no reduced-motion guard | MED |
| `ui/Toast.tsx` | toast stack | solid green/red/blue blocks, zero dark styling | HIGH |
| `ui/Badge.tsx` | status pills | semantic tints OK; cool gray default, blue info variant | LOW |
| `ui/EmptyState.tsx` | empty states | slate circle + cool text | LOW |
| `ui/ErrorBoundary.tsx` | error fallback | no dark variants at all, glass glow/cool CTAs | HIGH |
| `ui/pulsing-dot.tsx` + `.dot` | loading dot | fixed `#ff8c42` both themes | LOW |
| `app/loading.tsx` | route-transition screen | cool v1 gradient — flashes before every warm v2 page | MED |
| `theme-toggle.tsx` | theme toggle | cool slate circle; ThemeToggleV2 exists | MED |
| `fade-in.tsx` | scroll reveal | functionally identical to v2 Reveal — merge | LOW |
| `auth/auth-password-field.tsx` | password field | v1 tokens; AuthPasswordFieldV2 exists | MED |
| `globals.css` | root font/bg/nav/dot | Arial body, pure-white `--background`, `.floating-nav` invisible light border | HIGH |

### Public / legal (7 surfaces + exclusions)

| File | Renders | Hardcodes | Dev. |
|---|---|---|---|
| `legal/LegalDocLayout.tsx` | shell for all 4 legal pages | cool bg, orbs (with broken `opacity-22` utilities), white/60 header, glassCard, `#ff914d` links, v1 toggle | MED |
| `(public)/c/[slug]/page.tsx` | carrier-facing business landing | inline duplicate of LegalDocLayout shell | MED |
| `(public)/privacy` + `terms` | prose pages | copy-pasted `#ff914d` linkClass only | LOW |
| `legal/legal-section.tsx` | prose blocks | v1 text tokens (2-token swap) | LOW |
| `c/[slug]/privacy` + `terms` | per-business legal | nothing local — inherit LegalDocLayout | LOW |
| `widget/preview/page.tsx` | preview host banner | cool blue inline-styled banner, light-only | MED |

**Explicitly excluded (correctly so):** `widget/embed.js` (tenant-branded via runtime `--sa-brand`, ships to third-party sites — must NOT adopt app theming), widget preview page body (deliberately mimics a bare customer site), `theme-provider`, `account-deleted/page.tsx` (pure logic; already inside the v2 auth shell), `conversations/page.tsx` (sizing wrapper only).

## Product decisions needed before/during migration

- **Conversation bubble palette** — light-mode blue AI bubble and green agent bubble have no v2 answer; the hero demo's matte orange/neutral bubbles are the natural template.
- **Semantic status palette** — one sanctioned set of success/warning/danger/info tints on the warm palette (banners, badges, usage bars) instead of today's ad-hoc green/amber/red/purple/blue/violet.
- **Do the decorative blur orbs survive** the matte direction on app shells? (v2 home kept them; audit flags them as the loudest v1 leftover.)
- **Billing "Recommended" card** — glow + gradient badge needs a flat highlight treatment (v2 pricing page already solved this: outline + tinted shadow).

## Slice plan (6 slices, lowest-risk first)

### Slice 1 — Public, legal & error surfaces *(no business logic, no auth)*
Files: `LegalDocLayout`, `legal-section`, `privacy`/`terms` linkClass, `c/[slug]/page.tsx` (dedupe its shell into LegalDocLayout), `widget/preview` banner, `app/loading.tsx`, `ui/EmptyState`, `ui/ErrorBoundary`.
Blast radius: 5 public pages (incl. carrier-reviewer-facing `c/[slug]` — visual only, keep business-first branding), the loading flash, error fallback. Zero logged-in flows.
Verify: open `/privacy`, `/terms`, `/c/<slug>` + its privacy/terms in both themes; navigate to see the loading screen (should no longer flash cool gray); trigger a dev error for the boundary (now legible in dark).

### Slice 2 — v2 vocabulary + shared primitives *(the keystone; everything later depends on it)*
Files: `theme-v2/theme.ts`+`ui.tsx` (add compact/inline matte pills, Switch, option-card, status banner/badge tokens, toast recipe), then retarget `ui/Button` variants to matte, `ui/Modal`, `ui/Toast`, `ui/Badge` default tone, promote `ThemeToggleV2` into `theme-toggle.tsx` consumers, merge `fade-in`→`Reveal`, theme `.dot`/`pulsing-dot`, retarget the four `glass.ts` pill exports to matte (converts ~30 CTAs app-wide in one move).
Blast radius: every modal, toast, badge, shared button, and glass-pill CTA in the app — wide but centralized in ~10 files.
Verify: delete-account modal, calendar create/edit modal, any settings save (toast), A2P status badges, account-deleted buttons — both themes; confirm no CTA anywhere still glows.

### Slice 3 — Dashboard shell + contacts + calendar
Files: `(dashboard)/layout.tsx`, `sidebar.tsx`, `dashboard/page.tsx`, `DashboardOverview`, `A2pStatusCard`, `ContactStats`/`ContactsTable`/`ContactDetail`, `CalendarView` + both event modals (fix `[color-scheme:dark]`), `contacts`/`calendar` page headings.
Blast radius: every logged-in screen's frame + the two data-heavy sections.
Verify: log in → dashboard (stat cards, quick actions, empty state, phone modal), contacts (search/filter/sort, drawer, delete), calendar (month grid, create/edit/delete event, Google connect state), mobile drawer, both themes.

### Slice 4 — Conversations/inbox *(isolated because it needs the bubble-palette decision)*
Files: `InboxLayout`, `ConversationList`, `MessageThread`.
Blast radius: the single most-used operational screen; visual only, but message send/AI-toggle flows must be exercised.
Verify: open a conversation, send a message, toggle AI/human handling, SMS-paused banner, search/filter, delete modal — both themes, mobile two-pane behavior.

### Slice 5 — Settings + widget + billing
Files: `settings/page.tsx` + all 12 settings components, `WidgetPageClient` + `WidgetConfigForm` (kill the inline glow save) + `WidgetPreview` + `EmbedCodeGenerator` chrome, `billing/page.tsx` (flat recommended-card) + `billing-actions`.
Blast radius: all account-configuration surfaces + the revenue path (Stripe buttons are visual-only changes, but the checkout/portal handlers must be click-verified).
Verify: save every settings section, toggle switches, compliance mode picker, widget save + live preview + copy embed, billing page in subscribed & unsubscribed states, click Subscribe/Manage far enough to see Stripe redirect start.

### Slice 6 — Onboarding wizard + admin + globals root swap *(last: business-critical funnel + root-level change)*
Files: onboarding layout/page/StepProgress + all 8 step forms (TCR-sensitive copy untouched), `admin/*` (greenfield, internal-only), then `globals.css` (Geist base font, warm `--background`, `.floating-nav` fix, `.dot` theming) once nothing v1 remains to be accidentally restyled.
Blast radius: the signup-to-launch funnel end-to-end + app-wide base font/background.
Verify: full wizard run on a test account (all 9 steps, Back/Next, scan website, EIN branch + waitlist, plan select, launch-hold states, carrier-review panel), admin dashboard + business detail + both forms, then an app-wide smoke pass since globals changed.

Each slice is independently shippable and reviewable; nothing in a later slice blocks an earlier one.
