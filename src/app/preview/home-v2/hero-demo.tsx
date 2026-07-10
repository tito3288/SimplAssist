"use client";

/**
 * Animated hero conversation demo: a missed call becomes a booked job.
 * Plays at reading pace with typing indicators, pauses on the finished
 * conversation, fades out, and loops. `prefers-reduced-motion` gets the
 * full static conversation instead.
 *
 * The chat area is fixed-height (messages pin to the bottom and older ones
 * scroll up out of view), so the surrounding page never shifts.
 */

import { useEffect, useState } from "react";
import { body, ink, tile, tileRow } from "@/lib/theme-v2/theme";

type Sender = "banner" | "ai" | "customer";

const SCRIPT: { from: Sender; text: string }[] = [
  { from: "banner", text: "Missed call from Sarah — new customer" },
  {
    from: "ai",
    text: "Hi Sarah! This is Acme Plumbing's assistant — sorry we missed your call. How can we help?",
  },
  { from: "customer", text: "My water heater is leaking. Can someone come out this week?" },
  {
    from: "ai",
    text: "We can help with that! We have Tuesday 9 AM or Wednesday 2 PM — which works better?",
  },
  { from: "customer", text: "Tuesday works!" },
  { from: "ai", text: "You're booked for Tuesday at 9 AM ✅ We'll text you a reminder." },
];

const BOOKED_AT = SCRIPT.length; // Sarah flips to "Booked ✅" when the last message lands

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
    <div
      className={`${from === "customer" ? customerBubble : aiBubble} !py-3`}
      aria-hidden
    >
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
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState<"ai" | "customer" | null>(null);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Static: show the whole finished conversation, no loop.
      setVisible(SCRIPT.length);
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
      while (alive) {
        setVisible(0);
        setTyping(null);
        setFaded(false);
        await wait(600);
        if (!alive) return;
        setVisible(1); // system banner — no typing indicator

        for (let i = 1; i < SCRIPT.length; i++) {
          // Reading pause scaled to the previous message's length
          await wait(500 + Math.min(SCRIPT[i - 1].text.length * 10, 900));
          if (!alive) return;
          const from = SCRIPT[i].from as "ai" | "customer";
          setTyping(from);
          await wait(from === "ai" ? 1300 : 1050);
          if (!alive) return;
          setTyping(null);
          setVisible(i + 1);
        }

        await wait(4000); // hold the completed conversation
        if (!alive) return;
        setFaded(true);
        await wait(700); // fade out, then loop
        if (!alive) return;
      }
    }

    run();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion]);

  const booked = visible >= BOOKED_AT;

  const leads = [
    {
      name: "Sarah M.",
      badge: booked ? "Booked ✅" : "Hot Lead",
      color: booked
        ? "bg-green-50 text-green-700 border-green-200 dark:bg-[rgba(74,222,128,.12)] dark:text-[#bbf7d0] dark:border-[rgba(74,222,128,.25)]"
        : "bg-[#fcebdd] text-[#9a3412] border-[#f6d9c0] dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]",
    },
    {
      name: "James R.",
      badge: "Website Chat",
      color:
        "bg-blue-50 text-blue-700 border-blue-200 dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]",
    },
    {
      name: "Alicia T.",
      badge: "Missed Call",
      color:
        "bg-purple-50 text-purple-700 border-purple-200 dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]",
    },
  ];

  return (
    <div className={`transition-opacity duration-700 ${faded ? "opacity-0" : "opacity-100"}`}>
      <style>{`
        @keyframes sa-demo-grow {
          from { grid-template-rows: 0fr; opacity: 0; transform: translateY(8px); }
          to { grid-template-rows: 1fr; opacity: 1; transform: translateY(0); }
        }
        @keyframes sa-demo-blink {
          0%, 80%, 100% { opacity: .25; }
          40% { opacity: 1; }
        }
      `}</style>

      {/* Chat window */}
      <div className={`${tile} p-5`}>
        {/* Window top bar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`font-bold text-sm ${ink}`}>Acme Plumbing</span>
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

        {/* Fixed-height message area: stack pinned to the bottom edge, messages
            push upward as they arrive and older ones clip out the top */}
        <div className="relative h-[380px] overflow-hidden" aria-live="polite">
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3">
            {SCRIPT.slice(0, visible).map((m, i) => (
              <Enter key={i} animate={!reduceMotion}>
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

      {/* Dashboard strip */}
      <div className="grid grid-cols-[1.1fr_.9fr] gap-3.5 mt-3.5">
        {/* New Leads */}
        <div className={`${tile} rounded-[20px] p-5`}>
          <div className="text-[12px] font-bold tracking-[0.08em] uppercase text-[#c2410c] dark:text-[#ffd7bf] mb-2.5">
            New Leads
          </div>
          <div className="space-y-2.5">
            {leads.map((lead) => (
              <div key={lead.name} className={`flex items-center justify-between gap-3 px-3.5 py-3 ${tileRow}`}>
                <span className={`text-sm font-medium ${ink}`}>{lead.name}</span>
                <span
                  className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-[12px] font-bold border transition-colors duration-500 ${lead.color}`}
                >
                  {lead.badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* The Outcome */}
        <div className={`${tile} rounded-[20px] p-5`}>
          <div className="text-[12px] font-bold tracking-[0.08em] uppercase text-[#c2410c] dark:text-[#ffd7bf] mb-2.5">
            The Outcome
          </div>
          <div className="space-y-2.5">
            {[
              { label: "Reply time", value: "Under 10 sec" },
              { label: "Works 24/7", value: "Even after hours" },
            ].map((item) => (
              <div key={item.label} className={`flex items-center justify-between gap-3 px-3.5 py-3 ${tileRow}`}>
                <span className={`text-sm ${body}`}>{item.label}</span>
                <span className={`text-sm font-bold ${ink}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
