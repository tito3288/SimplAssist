# Step Progress Redesign — Sliding Window Implementation Plan

Target: `src/components/onboarding/StepProgress.tsx` only. Presentational component; receives `currentStep`, changes nothing about how steps advance, validate, or route. The top strip — "Step N of 9", current step name, and the overall progress bar — stays exactly as it is today (markup, copy, and colors untouched). The current v1 palette (`#ff914d` fill, slate idle tones) is deliberately kept so this change is purely structural; palette migration belongs to theme-v2 slice 6.

## Concept

Render all 9 steps in a horizontal **track** inside an `overflow-hidden` viewport. The viewport shows a fixed **window** of slots (5 on `sm+`, 3 below `sm`); the track is translated so the window's first step aligns with the viewport's left edge. Sliding = one CSS transform transition; no mounting/unmounting, so nothing pops.

Within the visible window: the interior steps are fully legible; a window-edge step is rendered as a faded/scaled-down **peeker** *only when real steps exist beyond it* (fade = "there's more this way"). A soft CSS mask feathers the viewport edge on sides that have hidden steps.

## Clamp math

`N = 9`, window size `W` (5 desktop / 3 mobile):

```
start = clamp(current − floor(W/2), 1, N − W + 1)
window = [start … start + W − 1]
```

Desktop (W=5, floor(W/2)=2):

| current | window | left peek? | right peek? |
|---|---|---|---|
| 1 | 1–5 | no (start=1) | yes (slot 5 faded) |
| 2 | 1–5 | no | yes |
| 3 | 1–5 | no | yes |
| 4 | 2–6 | yes (slot 2) | yes (slot 6) |
| 5 | 3–7 | yes | yes |
| 6 | 4–8 | yes | yes |
| 7 | 5–9 | yes | no (end=9) |
| 8 | 5–9 | yes | no |
| 9 | 5–9 | yes | no |

Mobile (W=3, floor(W/2)=1): `start = clamp(current − 1, 1, 7)` — current is centered for steps 2–8, clamped at [1–3] and [7–9] on the ends. Peek rule identical: fade the first/last window slot only when `start > 1` / `end < 9`.

Peek styling: `opacity ≈ 0.45` + `scale ≈ 0.9` on the circle, label faded to match. When the same slot stops being a peeker (window clamps at an edge), it transitions back to full emphasis. Completed peekers keep their checkmark + fill (at peek opacity) — completed steps never revert to "upcoming" styling.

## Geometry (no-wobble guarantee)

- Every slot has a **fixed width**: `100% / W` of the viewport (`w-1/5` desktop track slots, `w-1/3` mobile). The track is `flex` with width `N/W × 100%` of the viewport (180% / 300%).
- Translate distance is in track-relative percent: `translateX(−(start − 1) × 100/N %)` — exactly one slot per step of `start`, independent of pixel widths, correct at any viewport size including 375px (slot ≈ 104px at 3-up, ≈ 68–120px at 5-up on desktop cards).
- **Labels** live in a fixed-height, full-slot-width box: `text-xs`, `truncate`, `text-center`, horizontal padding. Long labels ("Business Verification") ellipsize rather than resize the slot — nothing wobbles mid-slide.
- Mobile: only the current step's label is rendered visible; the other slots' labels use `invisible` (not `hidden`/conditional render) so the reserved line height never collapses and the row height is constant.

Two tracks are rendered — mobile (`sm:hidden`, W=3, current-label-only) and desktop (`hidden sm:block`, W=5, all labels) — because the transform differs per breakpoint and CSS can't branch an inline transform. Both are computed from the same clamp function; no resize listeners, no hydration hazards.

## Animation spec

- **Slide:** `transition-transform duration-300 ease-out` on the track. Advancing from a centered position slides the track one slot left; while clamped at either end (`start` unchanged), nothing slides — only the active ring and fills advance.
- **Emphasis:** circles/labels transition `opacity` + `transform (scale)` + colors over ~300ms, so a slot entering/leaving peek state fades smoothly, and the active ring hands off via the existing `transition-colors`.
- **Edge masks:** the viewport gets a CSS `mask-image` (`linear-gradient`) feathering ~20px, applied on the left only when `start > 1` and on the right only when `end < N`. Mask (not an overlay) so it works over the translucent onboarding card in both themes.
- **Reduced motion:** every transition gets Tailwind's `motion-reduce:transition-none` — window jumps instantly, ring swaps instantly. No IntersectionObserver/JS motion; nothing to disable beyond CSS.

## Edge cases

- **Step 1:** window [1–5]/[1–3], flush left. No left peek, no left mask; slot 5 (desktop) / slot 3 (mobile) is a faded peeker with a right mask. Nothing slides on 1→2→3 (desktop; 1→2 mobile) — only the ring advances.
- **Step 9:** mirror — window [5–9]/[7–9], flush right, no right fade; completed left-peeker shows a faded checkmark. Arriving 8→9 causes no slide (window already clamped since 7).
- **First slide** happens at 3→4 (desktop) / 2→3 (mobile); **last slide** at 6→7 (desktop) / 7→8… precisely: desktop `start` changes on 3→4, 4→5, 5→6, 6→7; mobile on 2→3 … 7→8. Backward navigation mirrors the same math (the component is a pure function of `currentStep`, so Back just re-derives the window).
- **`currentStep` out of range:** existing `safeStep` clamp (1..9) retained unchanged.

## Accessibility

- The dot row is a visual duplicate of the top strip's "Step N of 9 — {label}" text, so the entire windowed row is `aria-hidden="true"`; screen readers get the complete, un-windowed information from the existing text (unchanged copy).
- The top strip remains the canonical source: no information exists only in the dots.

## Verification

`npm run build`; render at 375px and desktop, light + dark; step through 1→9 and 9→1 confirming: window contents match the table, peek fades only where steps are hidden, no horizontal wobble during slides, labels ellipsize, reduced-motion shows instant swaps.
