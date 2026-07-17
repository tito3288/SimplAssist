"use client";

/**
 * CTA closer vignette — one missed call, two endings.
 *
 * A single missed call ("2:47 PM — Missed call from Dana") forks into two
 * lanes: the voicemail lane (gray — waits an hour, four hours, a day, then
 * Dana books elsewhere) and the SimplAssist lane (orange — texts back in
 * 8 seconds and books the job while the other lane is still waiting).
 * The race starts when the section scrolls into view (~30% visible), plays
 * out over ~9 seconds, holds on the finished contrast, fades, and loops.
 *
 * Deliberately a small visual-language echo of the hero pipeline (same node
 * tint families, pulse ring, check-draw, pop) at a fraction of its size —
 * not a second demo.
 *
 * `prefers-reduced-motion`: static final frame (booked vs. lost), no loop;
 * an sr-only paragraph narrates the contrast and the animated block is
 * aria-hidden.
 *
 * Lane rows are fixed-shape (truncating one-line statuses, min-width meta
 * pills) so status swaps never shift layout. Below `sm` the meta pill folds
 * into the status line ("Still no callback · 4 hrs") so the verdict never
 * ellipsizes at narrow widths.
 *
 * The root is h-full flex-col (caption pinned to the bottom) so the vignette
 * absorbs whatever height the CTA card's right tile sets — the dead space
 * this component exists to kill.
 */

import { useEffect, useRef, useState } from "react";
import { body, ink, tile, tileRow } from "@/lib/theme-v2/theme";

/* ── Tones — same tint families as the hero pipeline nodes ── */

type Tone = "pending" | "gray" | "dead" | "active" | "done" | "won";

const NODE_TONES: Record<Tone, string> = {
  pending: `bg-white border-[#f0e9de] text-stone-300
    dark:bg-white/[0.04] dark:border-white/[0.08] dark:text-[#5c5c5e]`,
  gray: `bg-stone-100 border-stone-200 text-stone-500
    dark:bg-white/[0.08] dark:border-white/[0.10] dark:text-[#9a9a9c]`,
  dead: `bg-stone-100 border-stone-200 text-stone-400
    dark:bg-white/[0.05] dark:border-white/[0.08] dark:text-[#7c7c7e]`,
  active: `bg-[#ea580c] border-[#ea580c] text-white
    dark:bg-[#ff914d] dark:border-[#ff914d] dark:text-[#16100b]`,
  done: `bg-[#fcebdd] border-[#f6d9c0] text-[#9a3412]
    dark:bg-[rgba(255,145,77,.16)] dark:border-[rgba(255,145,77,.24)] dark:text-[#ffd5bc]`,
  won: `bg-green-50 border-green-200 text-green-700
    dark:bg-[rgba(74,222,128,.14)] dark:border-[rgba(74,222,128,.28)] dark:text-[#86efac]`,
};

const META_TONES = {
  pending: `border-transparent bg-transparent text-stone-300 dark:text-[#5c5c5e]`,
  gray: `bg-stone-100 text-stone-500 border-stone-200/70
    dark:bg-white/[0.06] dark:text-[#9a9a9c] dark:border-white/[0.08]`,
  orange: `bg-[#fcebdd] text-[#9a3412] border-[#f6d9c0]
    dark:bg-[rgba(255,145,77,.16)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.24)]`,
  green: `bg-green-50 text-green-700 border-green-200
    dark:bg-[rgba(74,222,128,.14)] dark:text-[#86efac] dark:border-[rgba(74,222,128,.28)]`,
} as const;

/* ── Phase script — index = phase (0-5) ── */

type LaneFrame = {
  status: string;
  meta: string;
  tone: Tone;
  metaTone: keyof typeof META_TONES;
  /** Dim the whole row (the lead is gone). */
  dim?: boolean;
  /** Hero-style pulse ring while the AI is replying. */
  pulse?: boolean;
  /** Node pop + check-draw on booking. */
  pop?: boolean;
  /** Swap the lane icon to the drawn check. */
  check?: boolean;
};

const BOOKED: LaneFrame = {
  status: "Dana's on the calendar.",
  meta: "Tue 9 AM",
  tone: "won",
  metaTone: "green",
  pop: true,
  check: true,
};

const VM_FRAMES: LaneFrame[] = [
  { status: "Ringing…", meta: "—", tone: "pending", metaTone: "pending" },
  { status: "Sent to voicemail.", meta: "0 min", tone: "gray", metaTone: "gray" },
  { status: "Sent to voicemail.", meta: "0 min", tone: "gray", metaTone: "gray" },
  { status: "Still no callback…", meta: "1 hr", tone: "gray", metaTone: "gray" },
  { status: "Still no callback…", meta: "4 hrs", tone: "gray", metaTone: "gray" },
  { status: "Dana books elsewhere.", meta: "next day", tone: "dead", metaTone: "gray", dim: true },
];

const SA_FRAMES: LaneFrame[] = [
  { status: "Ringing…", meta: "—", tone: "pending", metaTone: "pending" },
  { status: "Texting Dana back…", meta: "…", tone: "active", metaTone: "orange", pulse: true },
  { status: "Replied in 8 seconds.", meta: "8 sec", tone: "done", metaTone: "orange" },
  BOOKED,
  BOOKED,
  BOOKED,
];

const FINAL_PHASE = VM_FRAMES.length - 1;

/* ── Pieces ── */

function LaneIcon({ kind, draw }: { kind: "voicemail" | "zap" | "check"; draw?: boolean }) {
  const p = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "voicemail")
    return (
      <svg {...p}>
        <circle cx="6" cy="12" r="4" />
        <circle cx="18" cy="12" r="4" />
        <line x1="6" x2="18" y1="16" y2="16" />
      </svg>
    );
  if (kind === "zap")
    return (
      <svg {...p}>
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
      </svg>
    );
  return (
    <svg {...p}>
      <path
        d="m5 13 4 4L19 7"
        style={
          draw
            ? { strokeDasharray: 24, animation: "sa-cta-draw .4s ease-out .15s both" }
            : undefined
        }
      />
    </svg>
  );
}

/** One fate lane: icon node | label + one-line status | meta pill (sm+). */
function Lane({
  label,
  labelClass,
  statusClass,
  frame,
  icon,
  animate,
}: {
  label: string;
  labelClass: string;
  statusClass: string;
  frame: LaneFrame;
  icon: React.ReactNode;
  animate: boolean;
}) {
  const foldMeta = frame.meta !== "—" && frame.meta !== "…";
  return (
    <div
      className={`${tileRow} flex items-center gap-3 px-3.5 py-3 transition-opacity duration-700 ${
        frame.dim ? "opacity-70" : "opacity-100"
      }`}
    >
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-500 ${NODE_TONES[frame.tone]}`}
        style={
          frame.pop && animate
            ? { animation: "sa-cta-pop .5s cubic-bezier(.22,1,.36,1) both" }
            : undefined
        }
      >
        {frame.pulse && animate && (
          <span
            aria-hidden
            className="absolute -inset-px rounded-full border-2 border-[#ea580c] dark:border-[#ff914d]"
            style={{ animation: "sa-cta-ping 1.6s cubic-bezier(0,0,.2,1) infinite" }}
          />
        )}
        {icon}
      </span>
      <span className="flex-1 min-w-0 leading-tight">
        <span className={`block text-[10px] font-bold uppercase tracking-[0.08em] ${labelClass}`}>
          {label}
        </span>
        {/* Keyed on the copy so each swap remounts and replays the rise-in.
            Below sm the meta value folds into this line (no pill). */}
        <span
          key={`${frame.status}|${frame.meta}`}
          className={`block truncate text-[13px] font-semibold mt-0.5 ${statusClass}`}
          style={animate ? { animation: "sa-cta-swap .35s ease-out both" } : undefined}
        >
          {frame.status}
          {foldMeta && <span className="sm:hidden font-medium"> · {frame.meta}</span>}
        </span>
      </span>
      <span
        key={frame.meta}
        className={`hidden sm:block shrink-0 min-w-[66px] text-center px-2.5 py-1 rounded-full border text-[11px] font-bold transition-colors duration-500 ${META_TONES[frame.metaTone]}`}
        style={animate ? { animation: "sa-cta-swap .35s ease-out both" } : undefined}
      >
        {frame.meta}
      </span>
    </div>
  );
}

/* ── Component ── */

export function CtaRace() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const [phase, setPhase] = useState(0);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Start the race only once the vignette is actually on screen, so every
  // viewer sees the fork from the ringing moment instead of mid-cycle.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Static: the finished contrast — booked vs. lost. No loop.
      setPhase(FINAL_PHASE);
      setFaded(false);
      return;
    }
    if (!inView) return;

    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    async function run() {
      while (alive) {
        setPhase(0);
        await wait(60); // paint the reset before fading in
        if (!alive) return;
        setFaded(false);
        await wait(560);
        if (!alive) return;
        setPhase(1); // call lands: voicemail beeps, AI starts typing
        await wait(1500);
        if (!alive) return;
        setPhase(2); // AI replied — 8 seconds
        await wait(1400);
        if (!alive) return;
        setPhase(3); // booked; voicemail lane: 1 hr, nothing
        await wait(1700);
        if (!alive) return;
        setPhase(4); // 4 hrs, still nothing
        await wait(1500);
        if (!alive) return;
        setPhase(5); // next day: Dana books elsewhere
        await wait(3800); // hold the finished contrast
        if (!alive) return;
        setFaded(true);
        await wait(700); // fade-out completes + brief pause
        if (!alive) return;
      }
    }

    run();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion, inView]);

  const vm = VM_FRAMES[phase];
  const sa = SA_FRAMES[phase];
  const animate = !reduceMotion;

  return (
    <div
      ref={rootRef}
      className={`${tile} p-4 sm:p-5 h-full flex flex-col`}
      role="group"
      aria-label="One missed call, two endings — with and without SimplAssist"
    >
      <style>{`
        @keyframes sa-cta-drop {
          from { opacity: 0; transform: translateY(-7px) scale(.97); }
          to { opacity: 1; transform: none; }
        }
        @keyframes sa-cta-swap {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes sa-cta-ping {
          0% { transform: scale(1); opacity: .5; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        @keyframes sa-cta-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
        @keyframes sa-cta-draw {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <p className="sr-only">
        Without SimplAssist, the missed call goes to voicemail and by the next day the
        customer has booked elsewhere. With SimplAssist, the AI texts back in 8 seconds
        and the job is booked for Tuesday at 9 AM.
      </p>

      {/* Animated block — flexible middle (extra card height centers the
          lanes); the sr-only paragraph above owns the narration */}
      <div
        aria-hidden
        className={`flex-1 flex flex-col justify-center transition-opacity duration-700 ${
          faded ? "opacity-0" : "opacity-100"
        }`}
      >
        {/* The fork point — one shared event, diegetic timestamp */}
        <div
          className={`w-fit inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold
            bg-white border border-[#ece4d8] text-stone-500
            dark:bg-white/[0.06] dark:border-white/[0.10] dark:text-[#cfcfcf]
            ${phase >= 1 ? "" : "opacity-0"}`}
          style={
            phase >= 1 && animate
              ? { animation: "sa-cta-drop .45s cubic-bezier(.22,1,.36,1) both" }
              : undefined
          }
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ea580c] dark:bg-[#ff914d]" />
          2:47 PM — Missed call from Dana
        </div>

        {/* The two fates */}
        <div className="mt-3 space-y-2.5">
          <Lane
            label="Without SimplAssist"
            labelClass="text-stone-400 dark:text-[#7c7c7e]"
            statusClass="text-stone-600 dark:text-[#bdbdbf]"
            frame={vm}
            icon={<LaneIcon kind="voicemail" />}
            animate={animate}
          />
          <Lane
            label="With SimplAssist"
            labelClass="text-[#c2410c] dark:text-[#ffd7bf]"
            statusClass={ink}
            frame={sa}
            icon={<LaneIcon kind={sa.check ? "check" : "zap"} draw={sa.pop && animate} />}
            animate={animate}
          />
        </div>
      </div>

      {/* Constant footer caption — echoes the hero strip's stat line */}
      <p
        className={`mt-3.5 pt-3 border-t border-[#ede5d9] dark:border-white/[0.08] text-[12px] leading-relaxed ${body}`}
      >
        <span className="font-bold text-[#c2410c] dark:text-[#ff914d]">Same call.</span>{" "}
        Two very different Tuesdays.
      </p>
    </div>
  );
}
