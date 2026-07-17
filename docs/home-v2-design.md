# /home-v2 — Shelved ElevenLabs-Inspired Homepage (design record)

**Status: SHELVED, kept intentionally (2026-07-17).** Bryan liked the result but
chose to keep the current `/home` live. This page is preserved fully working so
a future redesign can start from it instead of from scratch.

## Where it lives & how to see it

| | |
|---|---|
| Route | `/home-v2` |
| Page | `src/app/(public)/home-v2/page.tsx` |
| Data | `src/app/(public)/home-v2/content.ts` (features/steps/plans/heroStats **copied** from `/home` — intentionally not shared; check for drift before reviving) |
| Showcase | `src/app/(public)/home-v2/showcase-tabs.tsx` (client island) |
| Grid system | `src/lib/theme-v2/grid.tsx` (reusable; nothing else imports it yet) |

**Visibility:** works on the local dev server (`npm run dev` → localhost:3000/home-v2).
In production builds a `notFound()` gate (in both `generateMetadata` and the page
component) renders the 404 page with a `noindex` robots meta unless
`ENABLE_HOME_V2_PREVIEW=1` is set at build time. Note: Next 14.2 serves this as a
soft 404 (404 UI + noindex, HTTP status 200) — a framework limitation for
`notFound()`-gated pages; no page content is ever served. Nothing on the live
site links to it. The `/demo/*` screenshot pages use the same pattern
(`ENABLE_DEMO_PAGES=1`).

**To revive:** remove the `notFound()` gate (and, if replacing the live homepage,
move the content into `/home` or repoint the `/` redirect target), reconcile any
copy/pricing drift with `/home`, and swap the placeholder art for real imagery
(swap points are documented in code comments — search `Replace` in the three files).

## The "engineering blueprint" grid system (the thing Bryan loved)

Decoded from elevenlabs.io's live DOM, adapted in `src/lib/theme-v2/grid.tsx`:

- **One `GridFrame` per page**: centered `w-[min(100%,1176px)]` with `sm:border-x`
  vertical rails — one pair of rails for the whole page, so all sections align by
  construction. Opening + closing caps (rule + dots). No `overflow-hidden` on the
  frame ever (dots/rules extend past it); the page shell provides `overflow-x-clip`.
- **`GridSection`**: each section draws its own top rule via an absolutely
  positioned **full-viewport-width** line (`w-screen`, not a border — Bryan
  specifically wanted rules running past the rails to the screen edge, like
  ElevenLabs). Sections never draw bottom rules, so adjacent sections share one line.
- **`CornerDot`**: 6px solid dot (`stone-900` / `#e8e8e8`) centered on each
  rule/rail intersection, wrapped in a **14px page-background halo**
  (`#faf8f4` / `#050505`) that masks the lines beneath — Bryan asked for the lines
  to stop short of the dot, not touch it. Watch dark mode: the halo is solid
  page-black; if the ambient orange glow makes halos visible, change technique.
- Hairline tone: `border-black/[0.06] dark:border-white/[0.08]` (tuned darker than
  ElevenLabs' 0.05 for the warm background). Mobile `<sm`: rails + dots hidden,
  rules stay, sections keep px-5 gutters.

## Page composition (final state when shelved)

1. **Hero** — side-by-side like `/home` (Bryan's explicit request after seeing a
   stacked variant): headline/CTAs left, `HeroDemo` right on a soft card. Calmer
   type than /home: `font-semibold tracking-[-0.035em]`, uppercase kickers, orange
   only on one hero word / step numbers / plan highlight / icons.
2. **Stat band** — heroStats as hairline cells running rail-to-rail (own GridSection, zero padding).
3. **Platform panel** — ElevenLabs "two platforms" pattern: headline + two labeled
   columns (from `splitColumns`), then a big `softCard` panel with **two
   overlapping product panes** (inbox skeleton left, dashboard skeleton right;
   right larger & in front by default). Pure-CSS hover: `group-hover` dims both to
   60%, `hover:!opacity-100 hover:-translate-y-1.5 hover:z-20` restores/raises the
   hovered pane. Pane bottoms run flush into the panel edge (rounded-t only).
   This REPLACED an industries logo-cloud strip + a text-only split intro
   (industries data still in content.ts, unused).
4. **Tabbed showcase** — exact ElevenLabs zigzag: 3 columns `1fr/1.5fr/1fr`; side
   groups are tile+card stacks stretched (`justify-between`) to the center card's
   height; captions overlay the art on a `from-black/60` bottom scrim in white.
   **Tabs mirror**: odd tabs get `flip` (flex-col-reverse / flex-row-reverse) so
   the gray tiles jump to opposite corners on switch — Bryan asked for this
   zigzag-swap effect. Crossfade: both panels always mounted, stacked in one grid
   cell, `transition-[opacity,transform,visibility]` 350ms + 75ms delay on the
   incoming panel; full ARIA tablist + arrow-key support; `motion-reduce` = instant.
   Mobile keeps the zigzag (tiles visible), alternating sides per tab.
5. **Features** — 6 rounded `softCard`s (24px) with icons in white circle `chip`s.
6. **How it works** — 3 `softCard`s, step numbers in accent-colored chips.
7. **Pricing** — deliberately kept SHARP (flat hairline columns; Bryan said the
   squared pricing "looks good"): highlighted plan = orange `border-t-2` + warm wash + badge.
8. **CTA** — one big rounded (28px) `softCard` panel, centered message.
9. **Footer** — inside the frame; frame's bottom cap closes the rails.

**Soft-card language** (`softCard` + `chip` consts in page.tsx): warm gray
`#f2eee5` / `dark:white/[0.05]`, hairline-faint border. The page's core rhythm =
sharp hairlines for structure, rounded soft-gray objects for content, pills for actions.

## Placeholder → real imagery swap points

- `showcase-tabs.tsx` → `CardArt` (one component: thread/chat/blank variants).
- `page.tsx` → `PaneInbox` / `PaneDashboard` (each becomes one
  `<Image fill className="object-cover object-left-top" />` of a real dashboard screenshot).
- Bryan planned to capture dashboard screenshots himself.

## Process notes

- Built via a 5-concept × 3-judge design workflow, then iterated live with Bryan
  (hero layout, full-width rules, dot gaps, rounded cards, showcase zigzag + flip,
  platform hover panel) — see PR/session history around 2026-07-16/17.
- Bryan verifies visuals himself in his browser; agents only run tsc/eslint
  (see memory: feedback_visual_verification).
