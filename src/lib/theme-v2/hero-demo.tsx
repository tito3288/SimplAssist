"use client";

/**
 * Animated hero conversation demo. Rotates through three industry
 * conversations (plumbing → auto repair → lawn care → loop), each a missed
 * call / website chat that becomes a booked job. Plays at reading pace with
 * typing indicators, holds on the finished conversation, then cross-fades to
 * the next business.
 *
 * Below the chat, the dashboard strip is a single full-width "Lead
 * Pipeline" tile at every width — Missed call → AI replies → Booked —
 * whose nodes light up in sync with the chat (banner lands → step 1,
 * typing bubble → step 2 pulses, booked → step 3 flips green with the
 * appointment slot). The tile shell, queue chips, and footer stat stay
 * constant across the cross-fade; only the pipeline row fades and remounts
 * (keyed on the conversation) so connector bars reset invisibly instead of
 * visibly draining. Below sm the step columns compress and the avatar
 * chips hide.
 *
 * `prefers-reduced-motion` shows the static plumbing conversation, no loop.
 *
 * The chat area is fixed-height so the surrounding page never shifts, and it
 * behaves like a real messaging app: a fresh conversation fills from the TOP
 * (first message under the header, appending downward), and once the content
 * outgrows the window it scrolls down to keep the newest message in view —
 * older messages scroll out the top, exactly like a chat thread. The window
 * is an overflow-hidden box scrolled programmatically: on every message or
 * typing change, scrollTop is pinned to the bottom each animation frame for
 * the duration of the bubble's grow-in, so the scroll moves in lockstep with
 * it and native clamping handles all the edge cases (short conversations,
 * the typing-bubble swap, conversation resets).
 */

import { useEffect, useRef, useState } from "react";
import { body, ink, tile } from "@/lib/theme-v2/theme";

type Sender = "banner" | "ai" | "customer";
type Message = { from: Sender; text: string };

type Conversation = {
  business: string;
  script: Message[];
  /** Active lead shown under the pipeline's first step. */
  lead: { name: string };
};

const CONVERSATIONS: Conversation[] = [
  {
    business: "Manny's Plumbing",
    lead: { name: "Sarah M." },
    script: [
      { from: "banner", text: "Missed call from Sarah — new customer" },
      {
        from: "ai",
        text: "Hi Sarah! This is the assistant at Manny's Plumbing — sorry we missed your call. How can we help?",
      },
      { from: "customer", text: "My water heater is leaking. Can someone come out this week?" },
      {
        from: "ai",
        text: "We can help with that! We have Tuesday 9 AM or Wednesday 2 PM — which works better?",
      },
      { from: "customer", text: "Tuesday works!" },
      { from: "ai", text: "You're booked for Tuesday at 9 AM ✅ We'll text you a reminder." },
    ],
  },
  {
    business: "Summit Auto Repair",
    lead: { name: "Mike R." },
    script: [
      { from: "banner", text: "Missed call from Mike — new customer" },
      {
        from: "ai",
        text: "Hi Mike! Summit Auto Repair's assistant here — sorry we missed you. What can we help with?",
      },
      { from: "customer", text: "My check engine light came on. How much is a diagnostic?" },
      {
        from: "ai",
        text: "Diagnostics are $89, applied to the repair if you book with us. Want to bring it in tomorrow morning?",
      },
      { from: "customer", text: "Yeah, 8 AM if you have it." },
      { from: "ai", text: "You're set for 8 AM tomorrow ✅ We'll text a reminder tonight." },
    ],
  },
  {
    business: "GreenScape Lawn Care",
    lead: { name: "Jessica L." },
    script: [
      { from: "banner", text: "New website chat — Jessica, 7:42 PM" },
      { from: "ai", text: "Hi! Thanks for reaching out to GreenScape 🌱 How can we help?" },
      { from: "customer", text: "Do you do weekly mowing? I need someone starting this month." },
      {
        from: "ai",
        text: "We do! We have weekly and biweekly plans. Can we schedule a free quote visit this week?",
      },
      { from: "customer", text: "Thursday afternoon?" },
      { from: "ai", text: "Thursday between 1–4 PM it is ✅ Our team will confirm by text in the morning." },
    ],
  },
];

/* Matte bubble styles (match the static v2 mockup) */
const customerBubble = `
  ml-auto w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed font-semibold
  bg-[#fcebdd] border border-[#f6d9c0] text-[#9a3412]
  dark:bg-[#ff914d] dark:border-transparent dark:text-[#16100b]
`;
const aiBubble = `
  w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed
  bg-white border border-[#ece4d8] text-stone-700
  dark:bg-white/[0.08] dark:border-white/[0.08] dark:text-[#f0f0f0]
`;
const bannerPill = `
  mx-auto w-fit inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold
  bg-white border border-[#ece4d8] text-stone-500
  dark:bg-white/[0.06] dark:border-white/[0.10] dark:text-[#cfcfcf]
`;

/** The rest of the lead queue — shown as initials chips in the strip header. */
const QUEUE = ["James R.", "Alicia T."];

/**
 * Pipeline copy per conversation — index-aligned with CONVERSATIONS.
 * `source` labels step 1, `won` labels step 3, `slot` is the appointment
 * detail revealed on booking, `reply` is the per-business speed stat shown
 * once the AI has answered (their average is the footer's "9 sec").
 */
const PIPELINE_META = [
  { source: "Missed call", won: "Booked", slot: "Tue 9:00 AM", reply: "replied in 8s" },
  { source: "Missed call", won: "Booked", slot: "Tomorrow 8 AM", reply: "replied in 11s" },
  { source: "Website chat", won: "Quote set", slot: "Thu 1–4 PM", reply: "replied in 7s" },
] as const;

type StepState = "pending" | "active" | "done" | "won";

/* Node tones — same tint families as the lead badges. Orange is the
   "in motion" color; success green is reserved for the booked node only. */
const NODE_TONES: Record<StepState, string> = {
  pending: `bg-white border-[#f0e9de] text-stone-400
    dark:bg-white/[0.04] dark:border-white/[0.08] dark:text-[#7c7c7e]`,
  active: `bg-[#ea580c] border-[#ea580c] text-white
    dark:bg-[#ff914d] dark:border-[#ff914d] dark:text-[#16100b]`,
  done: `bg-[#fcebdd] border-[#f6d9c0] text-[#9a3412]
    dark:bg-[rgba(255,145,77,.16)] dark:border-[rgba(255,145,77,.24)] dark:text-[#ffd5bc]`,
  won: `bg-green-50 border-green-200 text-green-700
    dark:bg-[rgba(74,222,128,.14)] dark:border-[rgba(74,222,128,.28)] dark:text-[#86efac]`,
};

function StepIcon({ kind, drawCheck }: { kind: "call" | "chat" | "reply" | "booked"; drawCheck?: boolean }) {
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
  if (kind === "call")
    return (
      <svg {...p}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  if (kind === "chat")
    return (
      <svg {...p}>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    );
  if (kind === "reply")
    return (
      <svg {...p}>
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
      </svg>
    );
  return (
    <svg {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
      <path
        d="m9 16 2 2 4-4"
        style={
          drawCheck
            ? { strokeDasharray: 20, animation: "sa-demo-draw .45s ease-out .3s both" }
            : undefined
        }
      />
    </svg>
  );
}

/** One pipeline stage: 36px node over a label + sub-line. */
function PipelineStep({
  state,
  icon,
  label,
  sub,
  pulse,
  pop,
}: {
  state: StepState;
  icon: React.ReactNode;
  label: string;
  sub: string;
  pulse?: boolean;
  pop?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 w-[72px] sm:w-[112px] shrink-0">
      <span
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-500 ${NODE_TONES[state]}`}
        style={pop ? { animation: "sa-demo-pop .5s cubic-bezier(.22,1,.36,1) both" } : undefined}
      >
        {pulse && (
          <span
            aria-hidden
            className="absolute -inset-px rounded-full border-2 border-[#ea580c] dark:border-[#ff914d]"
            style={{ animation: "sa-demo-ping 1.6s cubic-bezier(0,0,.2,1) infinite" }}
          />
        )}
        {icon}
      </span>
      <span className="text-center leading-tight">
        <span
          className={`block text-[11px] sm:text-[12px] font-bold transition-colors duration-500 ${
            state === "pending" ? "text-stone-400 dark:text-[#7c7c7e]" : ink
          }`}
        >
          {label}
        </span>
        <span className={`block text-[10px] sm:text-[11px] mt-0.5 min-h-[14px] ${body}`}>{sub}</span>
      </span>
    </div>
  );
}

/** Progress bar between stages — fills left→right when the stage is crossed. */
function Connector({ filled }: { filled: boolean }) {
  return (
    <div
      aria-hidden
      className="relative flex-1 min-w-[10px] sm:min-w-[14px] h-[3px] mt-[17px] -mx-2.5 sm:-mx-6 rounded-full overflow-hidden bg-[#ede5d9] dark:bg-white/[0.10]"
    >
      <div
        className={`h-full rounded-full bg-[#ea580c] dark:bg-[#ff914d] transition-[width] duration-700 ease-out ${
          filled ? "w-full" : "w-0"
        }`}
      />
    </div>
  );
}

function Bubble({ from, children }: { from: Sender; children: React.ReactNode }) {
  if (from === "banner") {
    return (
      <div className={bannerPill}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ea580c] dark:bg-[#ff914d]" />
        {children}
      </div>
    );
  }
  return <div className={from === "customer" ? customerBubble : aiBubble}>{children}</div>;
}

/** Grows into place (smooth push-up via grid-rows animation) while fading in. */
function Enter({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid [grid-template-rows:1fr]"
      style={animate ? { animation: "sa-demo-grow .5s cubic-bezier(.22,1,.36,1) both" } : undefined}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function TypingBubble({ from }: { from: "ai" | "customer" }) {
  return (
    <div className={`${from === "customer" ? customerBubble : aiBubble} !py-3`} aria-hidden>
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full bg-current"
            style={{ animation: "sa-demo-blink 1.1s ease-in-out infinite", animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

export function HeroDemo() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState<"ai" | "customer" | null>(null);
  const [faded, setFaded] = useState(false);
  const chatWindowRef = useRef<HTMLDivElement | null>(null);

  // Real-chat scroll: on every message/typing change, pin the window's
  // scrollTop to the bottom each animation frame for the duration of the
  // bubble's grow-in (500ms + buffer), so the scroll tracks the growth in
  // lockstep. Native clamping does the rest: short conversations don't
  // scroll at all (content sits at the top), and a conversation swap snaps
  // back to the top on its own while faded out.
  useEffect(() => {
    const el = chatWindowRef.current;
    if (!el) return;
    let raf = 0;
    const start = performance.now();
    const pin = () => {
      el.scrollTop = el.scrollHeight;
      if (performance.now() - start < 650) raf = requestAnimationFrame(pin);
    };
    pin();
    return () => cancelAnimationFrame(raf);
  }, [visible, typing, activeIndex]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Static: the full plumbing conversation, booked, no rotation.
      setActiveIndex(0);
      setVisible(CONVERSATIONS[0].script.length);
      setTyping(null);
      setFaded(false);
      return;
    }

    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    async function run() {
      let index = 0;
      while (alive) {
        // Swap in this conversation. On a transition we're still faded out
        // from the previous one, so header/leads/messages change invisibly.
        setActiveIndex(index);
        setVisible(0);
        setTyping(null);
        await wait(60); // paint the swap at opacity 0 before fading in
        if (!alive) return;

        setFaded(false); // fade in the new business
        await wait(560);
        if (!alive) return;
        setVisible(1); // system banner — no typing indicator

        const script = CONVERSATIONS[index].script;
        for (let i = 1; i < script.length; i++) {
          // Reading pause scaled to the previous message's length
          await wait(500 + Math.min(script[i - 1].text.length * 10, 900));
          if (!alive) return;
          const from = script[i].from as "ai" | "customer";
          setTyping(from);
          await wait(from === "ai" ? 1300 : 1050);
          if (!alive) return;
          setTyping(null);
          setVisible(i + 1);
        }

        await wait(3600); // hold the completed conversation
        if (!alive) return;
        setFaded(true); // fade out
        await wait(720); // fade-out completes + brief pause
        if (!alive) return;
        index = (index + 1) % CONVERSATIONS.length;
      }
    }

    run();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion]);

  const convo = CONVERSATIONS[activeIndex];
  const booked = visible >= convo.script.length;
  // AI stage engages the moment the typing bubble appears (typing is set
  // before visible hits 2), so the pipeline node lights in sync with the chat.
  const aiEngaged = booked || typing !== null || visible >= 2;

  const fadeClass = `transition-opacity duration-700 ${faded ? "opacity-0" : "opacity-100"}`;

  return (
    <div>
      <style>{`
        @keyframes sa-demo-grow {
          from { grid-template-rows: 0fr; opacity: 0; transform: translateY(8px); }
          to { grid-template-rows: 1fr; opacity: 1; transform: translateY(0); }
        }
        @keyframes sa-demo-blink {
          0%, 80%, 100% { opacity: .25; }
          40% { opacity: 1; }
        }
        @keyframes sa-demo-ping {
          0% { transform: scale(1); opacity: .5; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        @keyframes sa-demo-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
        @keyframes sa-demo-draw {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Chat window — cross-fades on each business change */}
      <div className={`${tile} p-5 ${fadeClass}`}>
        {/* Window top bar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`font-bold text-sm ${ink}`}>{convo.business}</span>
            <span className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#9a9a9c] whitespace-nowrap">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 dark:bg-green-400" />
              AI Assistant active
            </span>
          </div>
          <div className="flex gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-white/[0.22]" />
            <span className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-white/[0.22]" />
            <span className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-white/[0.22]" />
          </div>
        </div>

        {/* Fixed-height message area: the conversation fills from the top like
            a real chat; once it outgrows the window, programmatic scrolling
            (see the pin effect above) keeps the newest message in view */}
        <div ref={chatWindowRef} className="relative h-[380px] overflow-hidden" aria-live="polite">
          <div className="flex flex-col gap-3">
            {convo.script.slice(0, visible).map((m, i) => (
              <Enter key={`${activeIndex}-${i}`} animate={!reduceMotion}>
                <Bubble from={m.from}>{m.text}</Bubble>
              </Enter>
            ))}
            {typing && (
              <Enter animate>
                <TypingBubble from={typing} />
              </Enter>
            )}
          </div>
        </div>
      </div>

      {/* Dashboard strip — live lead pipeline. The tile shell, header,
          queue chips and footer stat stay constant; only the pipeline row
          cross-fades (and remounts) with the conversation. */}
      <div
        className={`${tile} rounded-[20px] p-5 mt-3.5`}
        role="group"
        aria-label="Lead pipeline: lead comes in, AI replies, job gets booked"
      >
        {/* Header — label + the rest of the queue compressed to chips */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="text-[12px] font-bold tracking-[0.08em] uppercase text-[#c2410c] dark:text-[#ffd7bf]">
            Lead Pipeline
          </span>
          <span className="flex items-center gap-2">
            <span className="hidden sm:flex -space-x-1.5" aria-hidden>
              {QUEUE.map((name) => (
                <span
                  key={name}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold bg-white border border-[#ece4d8] text-stone-500 dark:bg-[#221d19] dark:border-white/[0.14] dark:text-[#cfcfcf]"
                >
                  {name.split(" ").map((part) => part[0]).join("")}
                </span>
              ))}
            </span>
            <span className="text-[11px] font-semibold whitespace-nowrap text-stone-500 dark:text-[#9a9a9c]">
              {QUEUE.length} more waiting
            </span>
          </span>
        </div>

        {/* Pipeline — keyed on the conversation so connectors remount at w-0
            during the opacity-0 swap instead of visibly draining on fade-in.
            aria-hidden: the chat's aria-live region owns the narration. */}
        <div
          key={activeIndex}
          aria-hidden
          className={`flex items-start mx-auto w-full max-w-[520px] ${fadeClass}`}
        >
          <PipelineStep
            state={visible >= 1 ? "done" : "pending"}
            icon={
              <StepIcon
                kind={PIPELINE_META[activeIndex].source === "Website chat" ? "chat" : "call"}
              />
            }
            label={PIPELINE_META[activeIndex].source}
            sub={convo.lead.name}
          />
          <Connector filled={aiEngaged} />
          <PipelineStep
            state={booked ? "done" : aiEngaged ? "active" : "pending"}
            icon={<StepIcon kind="reply" />}
            label="AI replies"
            sub={booked ? PIPELINE_META[activeIndex].reply : aiEngaged ? "replying…" : "—"}
            pulse={!booked && aiEngaged && !reduceMotion}
          />
          <Connector filled={booked} />
          <PipelineStep
            state={booked ? "won" : "pending"}
            icon={<StepIcon kind="booked" drawCheck={booked && !reduceMotion} />}
            label={PIPELINE_META[activeIndex].won}
            sub={booked ? PIPELINE_META[activeIndex].slot : "—"}
            pop={booked && !reduceMotion}
          />
        </div>

        {/* Footer — constant diegetic stat carrying the marketing punch */}
        <p
          className={`mt-4 pt-3.5 border-t border-[#ede5d9] dark:border-white/[0.08] text-[12px] leading-relaxed ${body}`}
        >
          <span className="font-bold text-[#c2410c] dark:text-[#ff914d]">
            Avg. first reply: 9 sec
          </span>{" "}
          — before they can call your competitor.
        </p>
      </div>
    </div>
  );
}
