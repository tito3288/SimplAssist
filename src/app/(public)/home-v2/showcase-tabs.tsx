"use client";

/**
 * Tabbed showcase for /home-v2 — the exact ElevenLabs "impact" composition:
 *
 *   ┌ sm ┐              ┌───────┐  ┌ md card ┐
 *        │              │  lg   │  │         │
 *   ┌ md card ┐         │ center│  └ sm ┘
 *
 * Desktop/tablet: three columns (1fr / 1.5fr / 1fr). The side columns are
 * zigzag groups — left: small gray tile top-right, card below; right: card
 * top, small gray tile bottom-left — stretched (justify-between) to the
 * center card's height. The center card fills the row height, which the
 * square side cards define, so it lands ~square like the reference.
 *
 * Mobile: a staggered vertical zigzag (tile+card / big card / card+tile),
 * matching ElevenLabs' phone layout — tiles stay visible.
 *
 * Captions sit ON the art over a bottom scrim (white text), like the
 * reference's photo cards. Both tab panels stay mounted, stacked in one grid
 * cell, and crossfade on switch (visibility rides the transition so the
 * hidden panel leaves the a11y/tab order only after the fade).
 *
 * Card art is pure CSS placeholder work (CardArt) — swap in real photography
 * there when it exists.
 *
 * Imports its data from ./content directly (lucide icon references must not
 * cross the RSC serialization boundary as props).
 */

import { useRef, useState } from "react";
import { MessageCircle, PhoneMissed } from "lucide-react";
import { hairline } from "@/lib/theme-v2/grid";
import { showcaseTabs, type ShowcaseCard } from "./content";

/* ── Placeholder card art ── */

function CardArt({ variant }: { variant: ShowcaseCard["art"] }) {
  if (variant === "blank") {
    return (
      <div
        aria-hidden
        className="h-full w-full bg-[linear-gradient(160deg,#f4efe6,#ece4d8)] dark:bg-[linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.02))]"
      />
    );
  }

  if (variant === "thread") {
    // Skeleton SMS thread: missed-call pill + two inbound bubbles + one accent reply
    return (
      <div
        aria-hidden
        className="relative h-full w-full p-4 flex flex-col justify-end gap-2 bg-[linear-gradient(150deg,#fdf1e7,#f7e3cf)] dark:bg-[linear-gradient(150deg,rgba(255,145,77,.16),rgba(255,255,255,.04))]"
      >
        <span className="absolute top-3.5 left-3.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-white/85 text-stone-600 dark:bg-white/[0.10] dark:text-[#e5e5e5]">
          <PhoneMissed className="h-3 w-3 text-[#ea580c] dark:text-[#ff914d]" />
          Missed call
        </span>
        {/* Leave the bottom third clear for the caption overlay */}
        <span className="h-6 w-3/5 rounded-[10px] rounded-bl-[4px] bg-white/85 dark:bg-white/[0.12]" />
        <span className="h-6 w-2/5 self-end rounded-[10px] rounded-br-[4px] bg-[#ea580c]/85 dark:bg-[#ff914d]/80" />
        <span className="mb-[34%] h-6 w-1/2 rounded-[10px] rounded-bl-[4px] bg-white/85 dark:bg-white/[0.12]" />
      </div>
    );
  }

  // "chat": faint page skeleton + floating accent chat widget
  return (
    <div
      aria-hidden
      className="relative h-full w-full p-4 bg-[linear-gradient(150deg,#faf4ea,#f1e6d6)] dark:bg-[linear-gradient(150deg,rgba(255,255,255,.07),rgba(255,145,77,.10))]"
    >
      <span className="block h-2.5 w-2/5 rounded bg-black/[0.07] dark:bg-white/[0.10] mb-2" />
      <span className="block h-2.5 w-3/5 rounded bg-black/[0.05] dark:bg-white/[0.07] mb-2" />
      <span className="block h-16 w-full rounded-[10px] bg-black/[0.04] dark:bg-white/[0.05]" />
      <span className="absolute top-[42%] right-3.5 px-2.5 py-1.5 rounded-[10px] rounded-br-[4px] bg-white/90 dark:bg-white/[0.12] text-[10px] font-semibold text-stone-600 dark:text-[#e5e5e5]">
        Hi! Need a quote?
      </span>
      <span className="absolute top-[56%] right-3.5 grid place-items-center h-9 w-9 rounded-full bg-[#ea580c] dark:bg-[#ff914d]">
        <MessageCircle className="h-4 w-4 text-white dark:text-[#16100b]" />
      </span>
    </div>
  );
}

/* ── Cards ── */

/** Photo-style card: art fills the frame, caption overlays a bottom scrim. */
function Card({ card, className = "" }: { card: ShowcaseCard; className?: string }) {
  return (
    <figure className={`relative overflow-hidden rounded-2xl border ${hairline} ${className}`}>
      <div className="absolute inset-0">
        <CardArt variant={card.art} />
      </div>
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 via-black/25 to-transparent"
      />
      <figcaption className="absolute inset-x-0 bottom-0 p-4">
        <div className="text-sm font-semibold text-white">{card.industry}</div>
        <div className="text-xs text-white/85 leading-relaxed mt-0.5">{card.caption}</div>
      </figcaption>
    </figure>
  );
}

/** Small blank gray tile — a future photography slot. */
function Tile({ card, className = "" }: { card: ShowcaseCard; className?: string }) {
  return (
    <div aria-hidden className={`overflow-hidden rounded-2xl aspect-square ${className}`}>
      <CardArt variant={card.art} />
    </div>
  );
}

function Panel({ cards, flip = false }: { cards: ShowcaseCard[]; flip?: boolean }) {
  // Card order is [sm, md, lg, md, sm] (see content.ts).
  // `flip` mirrors the zigzag — the gray tiles jump to the opposite corners —
  // so alternating tabs visibly rearrange on switch.
  const [smLeft, mdLeft, lgCenter, mdRight, smRight] = cards;
  const col = flip ? "flex-col-reverse" : "flex-col";
  const row = flip ? "flex-row-reverse" : "flex-row";
  return (
    <>
      {/* ≥ sm: three columns — zigzag side groups stretched to the center card */}
      <div className="hidden sm:grid grid-cols-[1fr_1.5fr_1fr] gap-3 lg:gap-4">
        <div className={`flex ${col} justify-between gap-3 lg:gap-4`}>
          <Tile card={smLeft} className="w-[45%] self-end" />
          <Card card={mdLeft} className="aspect-square" />
        </div>
        <Card card={lgCenter} className="h-full min-h-[280px]" />
        <div className={`flex ${col} justify-between gap-3 lg:gap-4`}>
          <Card card={mdRight} className="aspect-square" />
          <Tile card={smRight} className="w-[45%] self-start" />
        </div>
      </div>

      {/* < sm: staggered vertical zigzag, tiles included */}
      <div className="sm:hidden flex flex-col gap-3">
        <div className={`flex ${row} items-end gap-3`}>
          <Tile card={smLeft} className="w-[26%] shrink-0" />
          <Card card={mdLeft} className="flex-1 aspect-square" />
        </div>
        <Card card={lgCenter} className={`w-[92%] aspect-square ${flip ? "self-end" : ""}`} />
        <div className={`flex ${row} items-start gap-3`}>
          <Card card={mdRight} className="flex-1 aspect-square" />
          <Tile card={smRight} className="w-[26%] shrink-0" />
        </div>
      </div>
    </>
  );
}

/* ── Tabs ── */

export function ShowcaseTabs() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = showcaseTabs.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (active + 1) % count;
    else if (e.key === "ArrowLeft") next = (active - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <div>
      {/* Switcher — inverted active pill; orange stays reserved for CTAs */}
      <div className="flex justify-center mb-10 sm:mb-14">
        <div
          role="tablist"
          aria-label="Product showcases"
          onKeyDown={onKeyDown}
          className={`inline-flex rounded-full border ${hairline} bg-white dark:bg-white/[0.06] p-1`}
        >
          {showcaseTabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`showcase-tab-${tab.id}`}
              aria-selected={i === active}
              aria-controls={`showcase-panel-${tab.id}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 dark:focus-visible:ring-white/40 ${
                i === active
                  ? "bg-stone-900 text-white dark:bg-white/[0.14] dark:text-white"
                  : "text-stone-500 hover:text-stone-900 dark:text-[#bdbdbf] dark:hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Panels — stacked in one grid cell for the crossfade */}
      <div className="grid">
        {showcaseTabs.map((tab, i) => {
          const isActive = i === active;
          return (
            <div
              key={tab.id}
              role="tabpanel"
              id={`showcase-panel-${tab.id}`}
              aria-labelledby={`showcase-tab-${tab.id}`}
              aria-hidden={!isActive}
              tabIndex={isActive ? 0 : undefined}
              className={`col-start-1 row-start-1 transition-[opacity,transform,visibility] duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:translate-y-0 ${
                isActive
                  ? "opacity-100 translate-y-0 visible delay-75"
                  : "opacity-0 translate-y-3 invisible pointer-events-none"
              }`}
            >
              <Panel cards={tab.cards} flip={i % 2 === 1} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
