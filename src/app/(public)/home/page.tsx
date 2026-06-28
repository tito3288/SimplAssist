import Link from "next/link";
import Image from "next/image";
import { FadeIn } from "@/components/fade-in";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Phone,
  MessageCircle,
  Inbox,
  Target,
  Star,
  ArrowUpRight,
} from "lucide-react";
import { glassCard } from "@/lib/glass";

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

/* ── Reusable eyebrow component ── */
function Eyebrow({ text }: { text: string }) {
  return (
    <span
      className="
        inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-full text-sm tracking-wide mb-5
        bg-orange-50 dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.05))]
        text-orange-600 dark:text-[#ffd7bf]
        border border-orange-200 dark:border-white/[0.14]
      "
    >
      <span className="w-2.5 h-2.5 rounded-full bg-[#ff914d] shadow-[0_0_18px_rgba(255,145,77,.65)] shrink-0" />
      {text}
    </span>
  );
}

/* ── Page ── */

export default function HomePage() {
  return (
    <div
      className="
        min-h-screen text-slate-900 dark:text-[#f5f5f5] overflow-x-clip relative
        bg-gradient-to-b from-slate-50 via-white to-slate-100
        dark:bg-none dark:bg-[#050505]
      "
    >
      {/* ── Dark-mode radial background gradient ── */}
      <div
        className="hidden dark:block fixed inset-0 pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(circle at top right, rgba(255,145,77,.18), transparent 22%), radial-gradient(circle at 12% 18%, rgba(255,145,77,.10), transparent 20%), linear-gradient(180deg, #080808 0%, #050505 42%, #0a0a0c 100%)",
        }}
      />

      {/* ── Orbs ── */}
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-30 dark:opacity-45"
        style={{
          width: 640,
          height: 640,
          background: "rgba(255,145,77,.20)",
          top: -70,
          right: -210,
          filter: "blur(60px)",
        }}
      />
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-20 dark:opacity-45"
        style={{
          width: 260,
          height: 260,
          background: "rgba(255,145,77,.14)",
          left: -80,
          top: "40%",
          filter: "blur(60px)",
        }}
      />

      {/* ── Navigation — frosted floating bar; must NOT be inside a transformed parent or fixed breaks ── */}
      <nav className="floating-nav flex items-center justify-between gap-3 sm:gap-4 px-3 sm:px-6 sm:py-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <Link href="/home">
                  <Image
                    src="/logo-dark.png"
                    alt="SimplAssist"
                    width={140}
                    height={34}
                    className="hidden dark:block h-8 w-auto object-contain"
                  />
                  <Image
                    src="/logo-light.png"
                    alt="SimplAssist"
                    width={140}
                    height={34}
                    className="block dark:hidden h-8 w-auto object-contain"
                  />
                </Link>
              </div>

              <div className="hidden md:flex items-center gap-6">
                <a href="#features" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors text-sm">
                  Features
                </a>
                <a href="#how-it-works" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors text-sm">
                  How It Works
                </a>
                <a href="#pricing" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors text-sm">
                  Pricing
                </a>
              </div>

              <div className="flex items-center gap-3">
                <ThemeToggle />
                <Link
                  href="/login"
                  className="
                    hidden sm:inline-flex items-center justify-center rounded-full px-5 py-3.5 font-bold text-sm
                    text-slate-700 dark:text-white bg-slate-100 dark:bg-transparent dark:bg-white/[0.08]
                    border border-slate-200 dark:border-white/[0.10]
                    hover:-translate-y-px transition-transform
                  "
                >
                  Log In
                </Link>
                <Link
                  href="/signup"
                  className="
                    inline-flex items-center justify-center rounded-full px-5 py-3.5 font-bold text-sm
                    text-white dark:text-[#111]
                    bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)]
                    shadow-[0_14px_34px_rgba(255,145,77,.26)]
                    hover:-translate-y-px transition-transform whitespace-nowrap
                  "
                >
                  Get Started
                </Link>
              </div>
      </nav>

      {/* ── Container ── */}
      <div className="relative z-[1] w-[min(calc(100%-32px),1200px)] mx-auto pt-[5.25rem] sm:pt-24">
        {/* ── Hero ── */}
        <section className="grid lg:grid-cols-[1.12fr_.88fr] gap-7 items-center pt-4 pb-10">
          <FadeIn priority offset="md">
            <div className="flex flex-col items-start">
              <div className="mt-12 sm:mt-0">
                <Eyebrow text="AI assistant for small businesses" />
              </div>

              <h1 className="text-[clamp(40px,7vw,76px)] font-extrabold leading-[0.96] tracking-[-0.05em] mb-5">
                <span className="text-slate-900 dark:text-[#f5f5f5]">Never miss a{" "}</span>
                <br className="hidden sm:block" />
                <span className="text-[#ff914d]">customer </span>
                <span className="text-slate-900 dark:text-[#f5f5f5]">again.</span>
              </h1>

              <p className="text-[clamp(17px,2.3vw,20px)] leading-[1.7] text-slate-500 dark:text-[#bdbdbf] max-w-[680px] mb-7">
                SimplAssist texts customers back when you miss a call, chats with website
                visitors 24/7, and keeps every lead organized in one clean dashboard.
              </p>

              {/* CTA buttons */}
              <div className="flex gap-3.5 flex-wrap mb-7">
                <Link
                  href="/signup"
                  className="
                    inline-flex items-center justify-center rounded-full px-5 py-3.5 font-bold text-sm
                    text-white dark:text-[#111]
                    bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)]
                    shadow-[0_14px_34px_rgba(255,145,77,.26)]
                    hover:-translate-y-px transition-transform
                  "
                >
                  Get Started Free
                </Link>
                <a
                  href="#how-it-works"
                  className="
                    inline-flex items-center justify-center rounded-full px-5 py-3.5 font-bold text-sm
                    text-slate-700 dark:text-white bg-slate-100 dark:bg-transparent dark:bg-white/[0.08]
                    border border-slate-200 dark:border-white/[0.10]
                    hover:-translate-y-px transition-transform
                  "
                >
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
                  <div
                    key={item.stat}
                    className={`p-5 ${glassCard}`}
                  >
                    <strong className="block text-[22px] mb-2 text-slate-900 dark:text-[#f5f5f5]">
                      {item.stat}
                    </strong>
                    <span className="text-sm text-slate-500 dark:text-[#bdbdbf]">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>

          {/* Hero panel — chat window + dashboard strip */}
          <FadeIn priority delayMs={140} offset="lg" className="hidden lg:block">
            <div
              className={`p-5 relative overflow-hidden ${glassCard}`}
            >
              {/* Panel glow */}
              <div
                className="absolute pointer-events-none hidden dark:block"
                style={{
                  bottom: "-30%",
                  right: "-15%",
                  width: 240,
                  height: 240,
                  borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(255,145,77,.40), transparent 65%)",
                  filter: "blur(16px)",
                }}
              />

              {/* Chat window */}
              <div
                className="
                  rounded-[22px] p-5
                  bg-slate-50 dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04))]
                  border border-slate-200 dark:border-white/[0.10]
                "
              >
                {/* Window top bar */}
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="flex items-center gap-2.5 font-bold text-sm text-slate-700 dark:text-[#f5f5f5]">
                    <Image
                      src="/logo-dark.png"
                      alt="SimplAssist"
                      width={56}
                      height={14}
                      className="hidden dark:block h-3.5 w-auto object-contain"
                    />
                    <Image
                      src="/logo-light.png"
                      alt="SimplAssist"
                      width={56}
                      height={14}
                      className="block dark:hidden h-3.5 w-auto object-contain"
                    />
                    <span>SimplAssist Live</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-white/[0.22]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-white/[0.22]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-white/[0.22]" />
                  </div>
                </div>

                {/* Messages */}
                <div className="space-y-3">
                  <div className="ml-auto w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed font-semibold bg-[linear-gradient(135deg,rgba(255,145,77,.95),rgba(255,176,122,.85))] text-[#151515]">
                    Missed call from Sarah — new customer asking about booking.
                  </div>
                  <div className="w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed bg-slate-100 dark:bg-transparent dark:bg-white/[0.08] border border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-[#f0f0f0]">
                    Hi Sarah! Thanks for calling Acme Plumbing. We missed your call, but
                    we&apos;ve got your message and will follow up soon. Need help right away?
                    You can reply here anytime.
                  </div>
                  <div className="ml-auto w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed font-semibold bg-[linear-gradient(135deg,rgba(255,145,77,.95),rgba(255,176,122,.85))] text-[#151515]">
                    Can you also answer questions on my website?
                  </div>
                  <div className="w-fit max-w-[88%] px-4 py-3.5 rounded-[18px] text-[15px] leading-relaxed bg-slate-100 dark:bg-transparent dark:bg-white/[0.08] border border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-[#f0f0f0]">
                    Yes — SimplAssist can chat with visitors, answer common questions, and
                    help capture more leads even after hours.
                  </div>
                </div>
              </div>

              {/* Dashboard strip */}
              <div className="grid grid-cols-[1.1fr_.9fr] gap-3.5 mt-3.5">
                {/* New Leads */}
                <div className="rounded-[20px] p-5 bg-slate-50 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08]">
                  <div className="text-[12px] font-bold tracking-[0.08em] uppercase text-orange-500 dark:text-[#ffd7bf] mb-2.5">
                    New Leads
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { name: "Sarah M.", badge: "Hot Lead", color: "bg-orange-100 dark:bg-[rgba(255,145,77,.14)] text-orange-600 dark:text-[#ffd5bc] border-orange-200 dark:border-[rgba(255,145,77,.22)]" },
                      { name: "James R.", badge: "Website Chat", color: "bg-blue-50 dark:bg-[rgba(255,145,77,.14)] text-blue-600 dark:text-[#ffd5bc] border-blue-200 dark:border-[rgba(255,145,77,.22)]" },
                      { name: "Alicia T.", badge: "Missed Call", color: "bg-purple-50 dark:bg-[rgba(255,145,77,.14)] text-purple-600 dark:text-[#ffd5bc] border-purple-200 dark:border-[rgba(255,145,77,.22)]" },
                    ].map((lead) => (
                      <div key={lead.name} className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-[14px] bg-white dark:bg-white/[0.04]">
                        <span className="text-sm font-medium text-slate-700 dark:text-[#f5f5f5]">{lead.name}</span>
                        <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-[12px] font-bold border ${lead.color}`}>
                          {lead.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* What You See */}
                <div className="rounded-[20px] p-5 bg-slate-50 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08]">
                  <div className="text-[12px] font-bold tracking-[0.08em] uppercase text-orange-500 dark:text-[#ffd7bf] mb-2.5">
                    What You See
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { label: "Conversations", value: "128" },
                      { label: "Response time", value: "< 10 sec" },
                      { label: "Channels", value: "SMS + Web" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-[14px] bg-white dark:bg-white/[0.04]">
                        <span className="text-sm text-slate-500 dark:text-[#bdbdbf]">{item.label}</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-[#f5f5f5]">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </section>

        {/* ── Features ── */}
        <section id="features" className="py-16 sm:py-24">
          <FadeIn className="mb-12 sm:mb-16">
            <Eyebrow text="Everything you need" />
            <div className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-4">
              <h2 className="text-[clamp(28px,4vw,46px)] leading-[1.04] tracking-[-0.04em] font-extrabold text-slate-900 dark:text-[#f5f5f5]">
                Built for small businesses that want a{" "}
                <span className="text-[#ff914d]">bigger presence</span>.
              </h2>
              <p className="text-slate-500 dark:text-[#bdbdbf] max-w-[600px] leading-[1.65] lg:text-right">
                Give customers a fast, professional experience without hiring a full-time front desk team.
              </p>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((feature, i) => (
              <FadeIn key={feature.title} delayMs={i * 75} className="h-full">
                <div className={`p-6 sm:p-8 relative overflow-hidden h-full ${glassCard}`}>
                  <div
                    className="
                      w-14 h-14 rounded-[22px] grid place-items-center mb-4
                      bg-orange-100 dark:bg-transparent dark:bg-[linear-gradient(135deg,rgba(255,145,77,.22),rgba(255,255,255,.08))]
                      border border-orange-200 dark:border-white/[0.10]
                    "
                  >
                    <feature.icon className="w-6 h-6 text-[#ff914d]" />
                  </div>
                  <h3 className="text-xl sm:text-[22px] font-bold text-slate-900 dark:text-[#f5f5f5] mb-2.5">
                    {feature.title}
                  </h3>
                  <p className="text-slate-500 dark:text-[#bdbdbf] leading-[1.7]">
                    {feature.description}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="py-16 sm:py-24">
          <FadeIn className="mb-12 sm:mb-16">
            <Eyebrow text="How it works" />
            <div className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-4">
              <h2 className="text-[clamp(28px,4vw,46px)] leading-[1.04] tracking-[-0.04em] font-extrabold text-slate-900 dark:text-[#f5f5f5]">
                Three simple steps to keep every{" "}
                <span className="text-[#ff914d]">lead</span>.
              </h2>
              <p className="text-slate-500 dark:text-[#bdbdbf] max-w-[600px] leading-[1.65] lg:text-right">
                Go from sign-up to live AI assistant in under ten minutes.
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-5">
            {steps.map((step, i) => (
              <FadeIn key={step.title} delayMs={i * 90} className="h-full">
                <div className={`p-6 sm:p-8 relative overflow-hidden h-full ${glassCard}`}>
                  <div
                    className="
                      w-11 h-11 rounded-full grid place-items-center mb-4
                      bg-[linear-gradient(135deg,#ff914d,#ffb07a)]
                      text-[#111] font-extrabold text-lg
                    "
                  >
                    {i + 1}
                  </div>
                  <h3 className="text-xl sm:text-[22px] font-bold text-slate-900 dark:text-[#f5f5f5] mb-2.5">
                    {step.title}
                  </h3>
                  <p className="text-slate-500 dark:text-[#bdbdbf] leading-[1.7]">
                    {step.description}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="py-16 sm:py-24">
          <FadeIn className="mb-12 sm:mb-16">
            <Eyebrow text="Simple, transparent pricing" />
            <div className="flex flex-col lg:flex-row items-start lg:items-end justify-between gap-4">
              <h2 className="text-[clamp(28px,4vw,46px)] leading-[1.04] tracking-[-0.04em] font-extrabold text-slate-900 dark:text-[#f5f5f5]">
                Start free and upgrade as your{" "}
                <span className="text-[#ff914d]">business grows</span>.
              </h2>
              <p className="text-slate-500 dark:text-[#bdbdbf] max-w-[600px] leading-[1.65] lg:text-right">
                No contracts. Paid SMS activation includes a one-time $25 setup fee.
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-5 items-start">
            {plans.map((plan, i) => (
              <FadeIn key={plan.name} delayMs={i * 100} className="h-full">
                <div
                  className={`
                    rounded-[28px] p-7 flex flex-col min-h-full relative
                    backdrop-blur-[18px]
                    ${
                      plan.highlighted
                        ? "bg-white/90 dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.06))] outline outline-1 outline-[rgba(255,145,77,.40)] shadow-2xl dark:shadow-[0_30px_80px_rgba(255,145,77,.14)] md:-translate-y-1 z-10 border border-transparent"
                        : `bg-white/70 dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.05))] border border-slate-200 dark:border-white/[0.14] shadow-sm dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]`
                    }
                  `}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-[#f5f5f5]">
                      {plan.name}
                    </h3>
                    {plan.highlighted && (
                      <span className="px-3 py-1.5 rounded-full text-[12px] font-extrabold bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-[#111]">
                        Most Popular
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 dark:text-[#bdbdbf] leading-[1.65] mb-6">
                    {plan.description}
                  </p>
                  <div className="text-[50px] font-extrabold tracking-[-0.05em] mb-5 text-slate-900 dark:text-[#f5f5f5]">
                    {plan.price}
                    <small className="text-lg text-slate-400 dark:text-[#bdbdbf]">/mo</small>
                  </div>
                  <ul className="space-y-3 mb-6 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-slate-700 dark:text-[#efefef] leading-relaxed">
                        <span className="text-[#ff914d] font-black text-2xl leading-none -mt-px">&bull;</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/signup"
                    className={`
                      block text-center py-4 rounded-full font-bold transition-all
                      ${
                        plan.highlighted
                          ? "text-[#111] bg-[linear-gradient(135deg,#ff914d,#ffb07a)] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:-translate-y-px"
                          : "text-slate-700 dark:text-white bg-slate-100 dark:bg-transparent dark:bg-white/[0.08] border border-slate-200 dark:border-white/[0.10] hover:-translate-y-px"
                      }
                    `}
                  >
                    Get Started
                  </Link>
                </div>
              </FadeIn>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <FadeIn>
          <section
            className={`
              my-6 p-8
              grid lg:grid-cols-[1.1fr_.9fr] gap-6 items-center
              ${glassCard}
            `}
          >
            <div>
              <h2 className="text-[clamp(28px,4vw,48px)] font-extrabold leading-[1.02] tracking-[-0.04em] mb-3 text-slate-900 dark:text-[#f5f5f5]">
                Ready to stop losing customers?
              </h2>
              <p className="text-slate-500 dark:text-[#bdbdbf] leading-[1.7] max-w-[680px]">
                Join hundreds of small businesses already using SimplAssist to respond
                faster, capture more leads, and grow without hiring more staff.
              </p>
            </div>
            <div className="rounded-[22px] p-6 bg-slate-50 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08]">
              <strong className="block text-base mb-2.5 text-slate-900 dark:text-[#f5f5f5]">
                What you get on day one:
              </strong>
              <ul className="space-y-2.5 mb-5">
                {[
                  "AI missed-call texting — live in minutes",
                  "Website chat widget — embed with one line of code",
                  "Dashboard with every lead and conversation",
                  "Free 14-day trial — no credit card required",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-slate-700 dark:text-[#ececec]">
                    <span className="w-2 h-2 rounded-full bg-[#ff914d] shadow-[0_0_14px_rgba(255,145,77,.70)] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="
                  block text-center py-4 rounded-full font-bold
                  text-[#111] bg-[linear-gradient(135deg,#ff914d,#ffb07a)]
                  shadow-[0_14px_34px_rgba(255,145,77,.26)]
                  hover:-translate-y-px transition-transform
                "
              >
                Start Free Trial
              </Link>
            </div>
          </section>
        </FadeIn>

        {/* ── Footer ── */}
        <footer className="pb-10 pt-2">
          <FadeIn>
            <div
              className={`
                px-6 py-6 flex items-center justify-between gap-4 flex-wrap
                ${glassCard}
              `}
            >
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
                <small className="text-slate-400 dark:text-[#bdbdbf] block mt-1">
                  &copy; {new Date().getFullYear()} ARAMBULA VENTURES LLC. SimplAssist is a product of ARAMBULA VENTURES LLC. All rights reserved.
                </small>
              </div>
              <div className="flex gap-5 flex-wrap text-sm">
                <a href="#features" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors">Features</a>
                <a href="#pricing" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors">Pricing</a>
                <Link href="/privacy" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors">Privacy</Link>
                <Link href="/terms" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors">Terms</Link>
                <Link href="/login" className="text-slate-500 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors">Log In</Link>
              </div>
            </div>
          </FadeIn>
        </footer>
      </div>
    </div>
  );
}
