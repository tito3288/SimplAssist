/**
 * Hairline grid-frame primitives — the "engineering blueprint" system used by
 * the v2 marketing pages: one pair of vertical rails frames the content, each
 * section draws a horizontal rule that runs the FULL viewport width (past the
 * rails, like ElevenLabs), and a small solid dot marks every rule/rail
 * intersection — with a halo of page-background color around it so the lines
 * stop just short of the dot instead of touching it.
 *
 * Server-safe (no hooks, no "use client").
 *
 * Usage:
 *   <GridFrame>
 *     <GridSection rule={false} dots={false}>hero…</GridSection>
 *     <GridSection id="features">…</GridSection>
 *   </GridFrame>
 *
 * The frame renders opening and closing caps (rule + dots) so the rails never
 * trail off. Below `sm` the rails and dots disappear (sections keep their own
 * gutters); horizontal rules stay full-width.
 *
 * Requirements on the host page: the page shell must have `overflow-x-clip`
 * (pageShell does) — the w-screen rules would otherwise cause a horizontal
 * scrollbar. The frame must NOT get `overflow-hidden` — dots hang half
 * outside the rails and rules extend past them.
 */

/** Decorative hairline — tuned for the warm off-white page / dark glass. */
export const hairline = "border-black/[0.06] dark:border-white/[0.08]";
export const hairlineDivide = "divide-black/[0.06] dark:divide-white/[0.08]";
/** bg-color twin of `hairline` for lines drawn as elements, not borders. */
const hairlineBg = "bg-black/[0.06] dark:bg-white/[0.08]";

/**
 * Solid dot centered on a rule/rail intersection — the signature moment.
 * The outer span is a page-background halo that masks the lines passing
 * beneath, so rules and rails stop ~4px short of the dot on every side.
 */
function CornerDot({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={`hidden sm:grid place-items-center absolute top-0 h-3.5 w-3.5 rounded-full -translate-y-1/2 bg-[#faf8f4] dark:bg-[#050505] ${
        side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-stone-900 dark:bg-[#e8e8e8]" />
    </span>
  );
}

/** Full-viewport-width horizontal rule, centered on its parent's top edge. */
function RuleLine() {
  return (
    <span
      aria-hidden
      className={`absolute top-0 left-1/2 -translate-x-1/2 w-screen h-px ${hairlineBg}`}
    />
  );
}

/** Zero-height horizontal rule with both intersection dots (frame caps). */
function GridRule() {
  return (
    <div aria-hidden className="relative">
      <RuleLine />
      <CornerDot side="left" />
      <CornerDot side="right" />
    </div>
  );
}

/**
 * The page frame: a single centered pair of vertical rails. One frame per
 * page guarantees every section's lines align by construction.
 */
export function GridFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative mx-auto w-[min(100%,1176px)] sm:border-x ${hairline} ${className}`}>
      <GridRule />
      {children}
      <GridRule />
    </div>
  );
}

/**
 * One section inside the frame. `rule` draws the full-width horizontal line
 * across the section's top edge (the line shared with the previous section —
 * sections only ever draw their top rule, so adjacent sections share exactly
 * one line) and `dots` marks its two rail intersections. `className`
 * REPLACES the default padding.
 */
export function GridSection({
  id,
  rule = true,
  dots = true,
  className = "px-5 sm:px-10 lg:px-14 py-16 sm:py-24",
  children,
}: {
  id?: string;
  rule?: boolean;
  dots?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`relative ${className}`}>
      {rule && <RuleLine />}
      {dots && <CornerDot side="left" />}
      {dots && <CornerDot side="right" />}
      {children}
    </section>
  );
}
