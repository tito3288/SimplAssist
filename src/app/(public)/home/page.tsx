import Link from "next/link";
import Image from "next/image";
import {
  Phone,
  MessageCircle,
  Inbox,
  Target,
  Star,
  ArrowUpRight,
} from "lucide-react";
import { Reveal, ThemeToggleV2 } from "@/lib/theme-v2/ui";
import {
  accentText,
  body,
  btnPrimary,
  btnPrimaryWide,
  btnSecondary,
  card,
  cardHover,
  darkAmbient,
  eyebrow,
  fontStack,
  ink,
  lightAmbient,
  navLink,
  navShell,
  pageShell,
  tile,
  tileRow,
} from "@/lib/theme-v2/theme";

/* ── Data ── */

const features = [
  {
    icon: Phone,
    title: "AI Missed-Call Texting",
    description:
      "Automatically reply when you can't answer the phone so potential customers never hear silence.",
  },
  {
    icon: MessageCircle,
    title: "Website Chat Widget",
    description:
      "Turn your site into a lead-capturing assistant that answers questions around the clock.",
  },
  {
    icon: Inbox,
    title: "Unified Inbox",
    description:
      "Keep SMS and website conversations together so you always know where each lead came from.",
  },
  {
    icon: Target,
    title: "Smart Contact Tracking",
    description:
      "Calls, chats, and follow-ups are organized automatically for a cleaner sales workflow.",
  },
  {
    icon: Star,
    title: "Custom AI Personality",
    description:
      "Set tone, greetings, and guardrails so your assistant sounds like your brand, not a generic bot.",
  },
  {
    icon: ArrowUpRight,
    title: "Lead Prioritization",
    description:
      "See your warmest prospects first so you know where to focus your time when you're back online.",
  },
];

const steps = [
  {
    title: "Customer calls, you're busy",
    description:
      "You're with a client, driving, or closed for the day. The call goes unanswered, but the lead is still active.",
  },
  {
    title: "AI texts back instantly",
    description:
      "Within seconds, SimplAssist sends a branded message so customers know they've been heard.",
  },
  {
    title: "You follow up with context",
    description:
      "Every message and contact lives in your dashboard so you can respond faster and close more leads.",
  },
];

const plans = [
  {
    name: "SMS Only",
    price: "$25",
    description: "Missed-call texting for small teams that want fast coverage.",
    features: [
      "One local AI phone number",
      "Manual SMS inbox and replies",
      "Missed-call auto text",
      "Basic AI missed-call response",
      "500 included SMS parts/month",
    ],
    highlighted: false,
  },
  {
    name: "SMS + Web Chat",
    price: "$45",
    description: "Add website chat to capture more leads and unify conversations.",
    features: [
      "Everything in SMS Only",
      "Website chat widget",
      "Web chat lead capture",
      "Full AI SMS conversations",
      "Customize your AI's answers and tone",
      "1,500 included SMS parts/month",
    ],
    highlighted: true,
  },
  {
    name: "Full Suite",
    price: "$65",
    description: "The complete communication platform for growing businesses.",
    features: [
      "Everything in SMS + Web Chat",
      "Google Calendar booking",
      "AI appointment scheduling",
      "Advanced AI guardrails",
      "Priority support",
      "2,500 included SMS parts/month",
    ],
    highlighted: false,
  },
];

/* ── Local pieces ── */

function Eyebrow({ text }: { text: string }) {
  return (
    <span className={eyebrow}>
      <span
        className="
          h-2.5 w-2.5 shrink-0 rounded-full
          bg-[#ea580c] dark:bg-[#ff914d]
          dark:shadow-[0_0_14px_rgba(255,145,77,.55)]
        "
      />
      {text}
    </span>
  );
}

function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "h-3.5 w-auto object-contain" : "h-8 w-auto object-contain";
  const dims = size === "sm" ? { width: 56, height: 14 } : { width: 140, height: 34 };
  return (
    <>
      <Image src="/logo-dark.png" alt="SimplAssist" {...dims} className={`hidden dark:block ${cls}`} />
      <Image src="/logo-light.png" alt="SimplAssist" {...dims} className={`block dark:hidden ${cls}`} />
    </>
  );
}

function SectionHeader({
  eyebrowText,
  title,
  subtitle,
}: {
  eyebrowText: string;
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <Reveal className="mb-12 sm:mb-16">
      <Eyebrow text={eyebrowText} />
      <div className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-4">
        <h2 className={`text-[clamp(28px,4vw,46px)] leading-[1.04] tracking-[-0.04em] font-extrabold ${ink}`}>
          {title}
        </h2>
        <p className={`${body} max-w-[600px] leading-[1.65] lg:text-right`}>{subtitle}</p>
      </div>
    </Reveal>
  );
}

/* ── Page ── */

export default function HomePage() {
  return (
    <div className={pageShell} style={{ fontFamily: fontStack }}>
      {/* Ambient backgrounds — light gets its own warm treatment */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="fixed inset-0 -z-10 pointer-events-none hidden dark:block"
        style={{ background: darkAmbient }}
      />

      {/* Orbs */}
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-20 dark:opacity-45"
        style={{
          width: 640,
          height: 640,
          background: "rgba(255,145,77,.18)",
          top: -70,
          right: -210,
          filter: "blur(64px)",
        }}
      />
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-15 dark:opacity-45"
        style={{
          width: 260,
          height: 260,
          background: "rgba(255,145,77,.14)",
          left: -80,
          top: "40%",
          filter: "blur(64px)",
        }}
      />

      {/* ── Navigation — frosted pill; must NOT be inside a transformed parent or fixed breaks ── */}
      <nav className={`${navShell} flex items-center justify-between gap-3 sm:gap-4 px-3 py-2 sm:px-6 sm:py-3`}>
        <div className="flex items-center gap-3.5 min-w-0">
          <Link href="/home">
            <Logo />
          </Link>
        </div>

        <div className="hidden md:flex items-center gap-6">
          <a href="#features" className={navLink}>
            Features
          </a>
          <a href="#how-it-works" className={navLink}>
            How It Works
          </a>
          <a href="#pricing" className={navLink}>
            Pricing
          </a>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggleV2 />
          <Link href="/login" className={`${btnSecondary} max-sm:hidden`}>
            Log In
          </Link>
          <Link href="/signup" className={btnPrimary}>
            Get Started
          </Link>
        </div>
      </nav>

      {/* ── Container ── */}
      <div className="relative z-[1] w-[min(calc(100%-32px),1200px)] mx-auto pt-[5.25rem] sm:pt-24">
        {/* ── Hero ── */}
        <section className="grid lg:grid-cols-[1.12fr_.88fr] gap-7 items-center pt-4 pb-10">
          <Reveal priority>
            <div className="flex flex-col items-start">
              <div className="mt-12 sm:mt-0">
                <Eyebrow text="AI assistant for small businesses" />
              </div>

              <h1 className={`text-[clamp(40px,7vw,76px)] font-extrabold leading-[0.96] tracking-[-0.05em] mb-5 ${ink}`}>
                Never miss a{" "}
                <br className="hidden sm:block" />
                <span className={accentText}>customer</span> again.
              </h1>

              <p className={`text-[clamp(17px,2.3vw,20px)] leading-[1.7] ${body} max-w-[680px] mb-7`}>
                SimplAssist texts customers back when you miss a call, chats with website
                visitors 24/7, and keeps every lead organized in one clean dashboard.
              </p>

              {/* CTA buttons — flat, matte, no glow */}
              <div className="flex gap-3.5 flex-wrap mb-7">
                <Link href="/signup" className={btnPrimary}>
                  Get Started Free
                </Link>
                <a href="#how-it-works" className={btnSecondary}>
                  See How It Works
                </a>
              </div>

              {/* Mini stat cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-7 w-full">
                {[
                  { stat: "24/7", label: "AI response coverage for calls and website visitors" },
                  { stat: "1 inbox", label: "SMS and web chat conversations in one place" },
                  { stat: "Fast setup", label: "Built for small teams that want results without complexity" },
                ].map((item) => (
                  <div key={item.stat} className={`p-5 ${card} ${cardHover}`}>
                    <strong className={`block text-[22px] mb-2 ${ink}`}>{item.stat}</strong>
                    <span className={`text-sm ${body}`}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Hero panel — chat window + dashboard strip */}
          <Reveal priority delayMs={140} className="hidden lg:block">
            <div className={`p-5 relative overflow-hidden ${card}`}>
              {/* Ambient corner tint (dark only) */}
              <div
                className="absolute pointer-events-none hidden dark:block"
                style={{
                  bottom: "-30%",
                  right: "-15%",
                  width: 240,
                  height: 240,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(255,145,77,.32), transparent 65%)",
                  filter: "blur(18px)",
                }}
              />

              {/* Chat window */}
              <div className={`${tile} p-5`}>
                {/* Window top bar */}
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className={`flex items-center gap-2.5 font-bold text-sm ${ink}`}>
                    <Logo size="sm" />
                    <span>SimplAssist Live</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-white/[0.22]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-white/[0.22]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-white/[0.22]" />
                  </div>
                </div>

                {/* Messages — matte bubbles, no gradients */}
                <div className="space-y-3">
                  <div
                    className="
                      ml-auto w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed font-semibold
                      bg-[#fcebdd] border border-[#f6d9c0] text-[#9a3412]
                      dark:bg-[#ff914d] dark:border-transparent dark:text-[#16100b]
                    "
                  >
                    Missed call from Sarah — new customer asking about booking.
                  </div>
                  <div
                    className="
                      w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed
                      bg-white border border-[#ece4d8] text-stone-700
                      dark:bg-white/[0.08] dark:border-white/[0.08] dark:text-[#f0f0f0]
                    "
                  >
                    Hi Sarah! Thanks for calling Acme Plumbing. We missed your call, but
                    we&apos;ve got your message and will follow up soon. Need help right away?
                    You can reply here anytime.
                  </div>
                  <div
                    className="
                      ml-auto w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed font-semibold
                      bg-[#fcebdd] border border-[#f6d9c0] text-[#9a3412]
                      dark:bg-[#ff914d] dark:border-transparent dark:text-[#16100b]
                    "
                  >
                    Can you also answer questions on my website?
                  </div>
                  <div
                    className="
                      w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed
                      bg-white border border-[#ece4d8] text-stone-700
                      dark:bg-white/[0.08] dark:border-white/[0.08] dark:text-[#f0f0f0]
                    "
                  >
                    Yes — SimplAssist can chat with visitors, answer common questions, and
                    help capture more leads even after hours.
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
                    {[
                      { name: "Sarah M.", badge: "Hot Lead", color: "bg-[#fcebdd] text-[#9a3412] border-[#f6d9c0] dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]" },
                      { name: "James R.", badge: "Website Chat", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]" },
                      { name: "Alicia T.", badge: "Missed Call", color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]" },
                    ].map((lead) => (
                      <div key={lead.name} className={`flex items-center justify-between gap-3 px-3.5 py-3 ${tileRow}`}>
                        <span className={`text-sm font-medium ${ink}`}>{lead.name}</span>
                        <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${lead.color}`}>
                          {lead.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* What You See */}
                <div className={`${tile} rounded-[20px] p-5`}>
                  <div className="text-[12px] font-bold tracking-[0.08em] uppercase text-[#c2410c] dark:text-[#ffd7bf] mb-2.5">
                    What You See
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { label: "Conversations", value: "128" },
                      { label: "Response time", value: "< 10 sec" },
                      { label: "Channels", value: "SMS + Web" },
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
          </Reveal>
        </section>

        {/* ── Features ── */}
        <section id="features" className="py-16 sm:py-24">
          <SectionHeader
            eyebrowText="Everything you need"
            title={
              <>
                Built for small businesses that want a{" "}
                <span className={accentText}>bigger presence</span>.
              </>
            }
            subtitle="Give customers a fast, professional experience without hiring a full-time front desk team."
          />

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((feature, i) => (
              <Reveal key={feature.title} delayMs={i * 75} className="h-full">
                <div className={`p-6 sm:p-8 relative overflow-hidden h-full ${card} ${cardHover}`}>
                  <div
                    className="
                      w-14 h-14 rounded-[22px] grid place-items-center mb-4
                      bg-[#fdf1e7] border border-[#f5dcc4]
                      dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(255,145,77,.22),rgba(255,255,255,.08))]
                      dark:border-white/[0.10]
                    "
                  >
                    <feature.icon className="w-6 h-6 text-[#ea580c] dark:text-[#ff914d]" />
                  </div>
                  <h3 className={`text-xl sm:text-[22px] font-bold ${ink} mb-2.5`}>
                    {feature.title}
                  </h3>
                  <p className={`${body} leading-[1.7]`}>{feature.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="py-16 sm:py-24">
          <SectionHeader
            eyebrowText="How it works"
            title={
              <>
                Three simple steps to keep every <span className={accentText}>lead</span>.
              </>
            }
            subtitle="Go from sign-up to live AI assistant in under ten minutes."
          />

          <div className="grid md:grid-cols-3 gap-5">
            {steps.map((step, i) => (
              <Reveal key={step.title} delayMs={i * 90} className="h-full">
                <div className={`p-6 sm:p-8 relative overflow-hidden h-full ${card} ${cardHover}`}>
                  <div
                    className="
                      w-11 h-11 rounded-full grid place-items-center mb-4
                      bg-[#ea580c] text-white dark:bg-[#ff914d] dark:text-[#16100b]
                      font-extrabold text-lg
                    "
                  >
                    {i + 1}
                  </div>
                  <h3 className={`text-xl sm:text-[22px] font-bold ${ink} mb-2.5`}>
                    {step.title}
                  </h3>
                  <p className={`${body} leading-[1.7]`}>{step.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="py-16 sm:py-24">
          <SectionHeader
            eyebrowText="Simple, transparent pricing"
            title={
              <>
                Start free and upgrade as your{" "}
                <span className={accentText}>business grows</span>.
              </>
            }
            subtitle="No contracts. Paid SMS activation includes a one-time $25 setup fee."
          />

          <div className="grid md:grid-cols-3 gap-5 items-start">
            {plans.map((plan, i) => (
              <Reveal key={plan.name} delayMs={i * 100} className="h-full">
                <div
                  className={
                    plan.highlighted
                      ? `
                        rounded-[28px] p-7 flex flex-col min-h-full relative md:-translate-y-1 z-10
                        bg-white border border-transparent
                        outline outline-2 outline-[rgba(194,65,12,.30)]
                        shadow-[0_2px_4px_rgba(28,25,23,0.05),0_28px_56px_-16px_rgba(154,52,18,0.18)]
                        dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.11),rgba(255,255,255,0.05))]
                        dark:outline-[rgba(255,145,77,.42)]
                        dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_56px_-16px_rgba(0,0,0,0.7)]
                        dark:backdrop-blur-[18px]
                      `
                      : `p-7 flex flex-col min-h-full relative ${card} ${cardHover}`
                  }
                >
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className={`text-2xl font-bold ${ink}`}>{plan.name}</h3>
                    {plan.highlighted && (
                      <span className="px-3 py-1.5 rounded-full text-[12px] font-extrabold bg-[#ea580c] text-white dark:bg-[#ff914d] dark:text-[#16100b]">
                        Most Popular
                      </span>
                    )}
                  </div>
                  <p className={`${body} leading-[1.65] mb-6`}>{plan.description}</p>
                  <div className={`text-[50px] font-extrabold tracking-[-0.05em] mb-5 ${ink}`}>
                    {plan.price}
                    <small className="text-lg text-stone-400 dark:text-[#bdbdbf]">/mo</small>
                  </div>
                  <ul className="space-y-3 mb-6 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-stone-700 dark:text-[#efefef] leading-relaxed">
                        <span className="text-[#ea580c] dark:text-[#ff914d] font-black text-2xl leading-none -mt-px">&bull;</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/signup"
                    className={plan.highlighted ? `${btnPrimary} w-full` : `${btnSecondary} w-full`}
                  >
                    Get Started
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <Reveal>
          <section className={`my-6 p-8 grid lg:grid-cols-[1.1fr_.9fr] gap-6 items-center ${card}`}>
            <div>
              <h2 className={`text-[clamp(28px,4vw,48px)] font-extrabold leading-[1.02] tracking-[-0.04em] mb-3 ${ink}`}>
                Ready to stop losing customers?
              </h2>
              <p className={`${body} leading-[1.7] max-w-[680px]`}>
                Join hundreds of small businesses already using SimplAssist to respond
                faster, capture more leads, and grow without hiring more staff.
              </p>
            </div>
            <div className={`${tile} p-6`}>
              <strong className={`block text-base mb-2.5 ${ink}`}>
                What you get on day one:
              </strong>
              <ul className="space-y-2.5 mb-5">
                {[
                  "AI missed-call texting — live in minutes",
                  "Website chat widget — embed with one line of code",
                  "Dashboard with every lead and conversation",
                  "Free 14-day trial — no credit card required",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-stone-700 dark:text-[#ececec]">
                    <span className="w-2 h-2 rounded-full bg-[#ea580c] dark:bg-[#ff914d] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={btnPrimaryWide}>
                Start Free Trial
              </Link>
            </div>
          </section>
        </Reveal>

        {/* ── Footer ── */}
        <footer className="pb-10 pt-2">
          <Reveal>
            <div className={`px-6 py-6 flex items-center justify-between gap-4 flex-wrap ${card}`}>
              <div className="flex items-center gap-3.5">
                <Image
                  src="/logo-dark.png"
                  alt="SimplAssist"
                  width={88}
                  height={22}
                  className="hidden dark:block h-[22px] w-auto object-contain"
                />
                <Image
                  src="/logo-light.png"
                  alt="SimplAssist"
                  width={88}
                  height={22}
                  className="block dark:hidden h-[22px] w-auto object-contain"
                />
                <small className="text-stone-500 dark:text-[#bdbdbf] block mt-1">
                  &copy; {new Date().getFullYear()} ARAMBULA VENTURES LLC. SimplAssist is a product of ARAMBULA VENTURES LLC. All rights reserved.
                </small>
              </div>
              <div className="flex gap-5 flex-wrap text-sm">
                <a href="#features" className={navLink}>Features</a>
                <a href="#pricing" className={navLink}>Pricing</a>
                <Link href="/privacy" className={navLink}>Privacy</Link>
                <Link href="/terms" className={navLink}>Terms</Link>
                <Link href="/login" className={navLink}>Log In</Link>
              </div>
            </div>
          </Reveal>
        </footer>
      </div>
    </div>
  );
}
