/** Reusable glassmorphism class strings — radii match dashboard Quick Actions / empty state. */

/** Outer panels: stat cards, settings sections, inbox shell, modals */
export const radiusGlass = "rounded-[28px]";
/** Nested tiles inside a glass panel (optional) */
export const radiusGlassInner = "rounded-[22px]";

export const glassCard = `
  rounded-[28px]
  bg-white/70 dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.05))]
  border border-slate-200 dark:border-white/[0.14]
  shadow-sm dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]
  backdrop-blur-[18px]
`;

export const glassCardSubtle = `
  rounded-[22px]
  bg-white/50 dark:bg-white/[0.04]
  border border-slate-200 dark:border-white/[0.08]
`;

export const glassInput = `
  bg-white dark:bg-white/[0.06]
  border border-gray-300 dark:border-white/[0.12]
  text-slate-900 dark:text-[#f5f5f5]
  placeholder:text-gray-400 dark:placeholder:text-[#666]
  focus:border-[#ff914d] focus:ring-1 focus:ring-[#ff914d]
`;

export const orangeAccentIcon = `
  rounded-xl
  bg-orange-100 dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(255,145,77,.22),rgba(255,255,255,.08))]
  border border-orange-200 dark:border-white/[0.10]
`;

export const textPrimary = "text-slate-900 dark:text-[#f5f5f5]";
export const textSecondary = "text-slate-500 dark:text-[#bdbdbf]";

/** Login / signup / onboarding inputs */
export const authInputClass = `
  w-full rounded-[22px] px-4 py-3 text-sm
  bg-white dark:bg-white/[0.06]
  border border-slate-200 dark:border-white/[0.12]
  text-slate-900 dark:text-[#f5f5f5]
  placeholder:text-slate-400 dark:placeholder:text-[#666]
  focus:outline-none focus:border-[#ff914d] focus:ring-2 focus:ring-[#ff914d]/30
`;

/** Primary action — matches dashboard / marketing CTAs */
export const primaryCtaClass = `
  inline-flex w-full items-center justify-center gap-3 py-3.5 px-4 font-bold rounded-full text-center transition-all
  bg-orange-500 text-white
  dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] dark:text-[#111]
  shadow-[0_14px_34px_rgba(255,145,77,.26)]
  hover:-translate-y-px
  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff914d] focus-visible:ring-offset-2
  focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0a0a0c]
`;

/* ── Pill CTA family — shared by onboarding, settings, widget, billing, admin ──
   Shape/focus/disabled behavior once; primary/secondary colors once; two sizes.
   Geometry matches the app's prevailing buttons so adopting these only changes
   the corner radius. Layout utilities (w-full, self-end, …) compose at call site. */

const ctaPillCore = `
  inline-flex items-center justify-center rounded-full font-medium text-center transition-colors
  focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
`;

const ctaPrimaryColors = `
  bg-orange-500 text-white
  dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] dark:text-[#111]
  shadow-[0_14px_34px_rgba(255,145,77,.26)]
  hover:bg-orange-600 dark:hover:brightness-110
`;

const ctaSecondaryColors = `
  border border-slate-200 dark:border-white/[0.12]
  text-slate-700 dark:text-[#bdbdbf]
  hover:bg-slate-100 dark:hover:bg-white/[0.06]
`;

/** Standard inline primary pill (Next, Save, Launch, Subscribe, …) */
export const primaryCtaInlineClass = `${ctaPillCore} ${ctaPrimaryColors} gap-2 py-2 px-6`;

/** Standard inline secondary pill (Back, Cancel, quiet actions) */
export const secondaryCtaClass = `${ctaPillCore} ${ctaSecondaryColors} gap-2 py-2 px-6`;

/** Compact primary pill (row-level Save/Add, admin forms) */
export const primaryCtaCompactClass = `${ctaPillCore} ${ctaPrimaryColors} gap-1.5 px-3 py-1.5 text-sm`;

/** Compact secondary pill (small utility buttons) */
export const secondaryCtaCompactClass = `${ctaPillCore} ${ctaSecondaryColors} gap-1.5 px-3 py-1.5 text-sm`;
