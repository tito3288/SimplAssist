/**
 * Design-exploration tokens for /preview/home-v2 and /preview/auth-v2.
 * Self-contained: nothing here is shared with production pages.
 *
 * Direction:
 * - Buttons are flat + matte. No drop-glow, no internal gradient. Hover = darker
 *   orange, press = 1px nudge. Crisp edges in both themes.
 * - Light mode is its own theme: warm off-white page, true-white cards with soft
 *   realistic shadows, burnt orange for large accent text, near-black ink.
 * - Dark mode keeps the current near-black + glass feel with tighter borders
 *   and shadows for depth.
 */

/* ── Text ── */

export const ink = "text-stone-900 dark:text-[#f5f5f5]";
export const body = "text-stone-600 dark:text-[#bdbdbf]";
export const bodyFaint = "text-stone-500 dark:text-[#bdbdbf]";
/** Large accent text — burnt orange in light so it doesn't wash out. */
export const accentText = "text-[#c2410c] dark:text-[#ff914d]";

/* ── Buttons ── */

/* No px/py here — each variant sets its own geometry exactly once. */
const btnBase = `
  inline-flex items-center justify-center rounded-full text-sm font-bold
  whitespace-nowrap select-none transition-colors duration-150
  focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
  focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
`;

/** Flat solid orange, matte. Darker on hover, 1px press. No glow, no gradient. */
const btnPrimaryColors = `
  bg-[#ea580c] text-white
  hover:bg-[#c2410c] active:bg-[#9a3412] active:translate-y-px
  dark:bg-[#ff914d] dark:text-[#16100b]
  dark:hover:bg-[#f57f33] dark:active:bg-[#e8752c]
  focus-visible:ring-[#ea580c]/60 dark:focus-visible:ring-[#ff914d]/60
`;

/** Primary CTA pill. */
export const btnPrimary = `${btnBase} ${btnPrimaryColors} px-6 py-3.5`;

/** Secondary — quiet neutral pill. */
export const btnSecondary = `
  ${btnBase}
  px-6 py-3.5
  bg-white text-stone-700 border border-[#e7e0d4]
  hover:bg-[#faf6ef] hover:border-[#d9d0c1]
  active:translate-y-px
  dark:bg-white/[0.07] dark:text-white dark:border-white/[0.12]
  dark:hover:bg-white/[0.11] dark:hover:border-white/[0.16]
  focus-visible:ring-stone-400/60 dark:focus-visible:ring-white/40
`;

/** Full-width form CTA (auth). Same matte rules as btnPrimary. */
export const btnPrimaryWide = `
  ${btnBase} ${btnPrimaryColors}
  w-full gap-3 px-4 py-4
  disabled:opacity-50 disabled:cursor-not-allowed
  disabled:hover:bg-[#ea580c] dark:disabled:hover:bg-[#ff914d]
  disabled:active:translate-y-0
`;

/* ── Cards ── */

/**
 * v2 card. Light: true white on the warm page, soft two-layer shadow, warm
 * hairline border. Dark: current glass gradient with a tighter border, an inset
 * top highlight, and a shorter/deeper shadow.
 */
export const card = `
  rounded-[28px]
  bg-white border border-[#ece4d8]
  shadow-[0_1px_2px_rgba(28,25,23,0.04),0_12px_32px_-8px_rgba(28,25,23,0.08)]
  dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))]
  dark:border-white/[0.12]
  dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_16px_40px_-12px_rgba(0,0,0,0.65)]
  dark:backdrop-blur-[18px]
`;

/** Gentle hover lift for interactive cards. Nothing bouncy. */
export const cardHover = `
  transition-[transform,box-shadow,border-color] duration-300 ease-out
  hover:-translate-y-1
  hover:shadow-[0_2px_4px_rgba(28,25,23,0.05),0_24px_48px_-12px_rgba(28,25,23,0.13)]
  dark:hover:border-white/[0.18]
  dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_24px_56px_-14px_rgba(0,0,0,0.75)]
`;

/** Nested tile inside a card (chat window, dashboard strip, CTA list). */
export const tile = `
  rounded-[22px]
  bg-[#faf7f2] border border-[#ede5d9]
  dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))]
  dark:border-white/[0.10]
`;

/** Row inside a tile (lead rows, stat rows). */
export const tileRow = `
  rounded-[14px]
  bg-white border border-[#f0e9de]
  dark:bg-white/[0.04] dark:border-transparent
`;

/* ── Nav ── */

/**
 * Frosted floating nav. Transparency stays (it's a feature) but blur and tint
 * are strong enough that scrolled content reads as a soft color wash, never
 * legible text.
 */
export const navShell = `
  fixed top-6 left-1/2 z-50 -translate-x-1/2
  w-[min(1200px,calc(100%-2rem))] max-w-[calc(100vw-2rem)]
  rounded-full
  backdrop-blur-[28px] backdrop-saturate-[1.6]
  bg-[rgba(250,248,244,0.82)] dark:bg-[rgba(10,10,11,0.74)]
  border border-[rgba(28,25,23,0.08)] dark:border-white/[0.10]
  shadow-[0_8px_32px_-12px_rgba(28,25,23,0.14)] dark:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)]
`;

export const navLink = `
  text-sm text-stone-500 hover:text-stone-900
  dark:text-[#bdbdbf] dark:hover:text-white
  transition-colors
`;

/* ── Eyebrow ── */

export const eyebrow = `
  inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-full text-sm tracking-wide mb-5
  bg-[#fdf1e7] text-[#c2410c] border border-[#f5dcc4]
  dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.05))]
  dark:text-[#ffd7bf] dark:border-white/[0.14]
`;

/* ── Forms (auth) ── */

export const inputField = `
  w-full rounded-2xl px-4 py-3 text-sm
  bg-white text-stone-900 placeholder:text-stone-400
  border border-[#e3dacc]
  dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12]
  focus:outline-none
  focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25
  dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30
  transition-[border-color,box-shadow] duration-150
`;

export const fieldLabel =
  "mb-1.5 block text-sm font-medium text-stone-700 dark:text-[#d4d4d8]";

/** Inline text links (Terms, Privacy, Log in, Create one). */
export const inlineLink = `
  font-semibold text-[#c2410c] hover:text-[#9a3412]
  dark:text-[#ff914d] dark:hover:text-[#ffb07a]
  transition-colors
`;

/* ── Page backgrounds ── */

export const pageShell = `
  min-h-screen relative overflow-x-clip
  bg-[#faf8f4] dark:bg-[#050505]
  text-stone-900 dark:text-[#f5f5f5]
`;

/** Font stack: Geist is already loaded by the root layout via CSS variable. */
export const fontStack =
  "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif";

/** Dark-mode ambient radial gradient (kept from current design). */
export const darkAmbient =
  "radial-gradient(circle at top right, rgba(255,145,77,.18), transparent 22%), radial-gradient(circle at 12% 18%, rgba(255,145,77,.10), transparent 20%), linear-gradient(180deg, #080808 0%, #050505 42%, #0a0a0c 100%)";

/** Light-mode ambient: faint warm washes on the off-white page. */
export const lightAmbient =
  "radial-gradient(circle at 85% -5%, rgba(234,88,12,.06), transparent 32%), radial-gradient(circle at 5% 30%, rgba(234,88,12,.04), transparent 26%), linear-gradient(180deg, #fbf9f5 0%, #faf8f4 50%, #f7f4ee 100%)";
