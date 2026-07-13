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
import { HeroDemo } from "@/lib/theme-v2/hero-demo";
import {
  accentText,
  body,
  btnPrimary,
  btnPrimaryWide,
  btnSecondary,
  card,
  cardHover,
  darkAmbient,
  fontStack,
  ink,
  lightAmbient,
  navLink,
  navShell,
  pageShell,
  tile,
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

const heroStats = [
  { stat: "24/7", label: "AI response coverage for calls and website visitors" },
  { stat: "1 inbox", label: "SMS and web chat conversations in one place" },
  { stat: "Fast setup", label: "Built for small teams that want results without complexity" },
];

/* ── Local pieces ── */

function HeroStatCards() {
  return (
    <>
      {heroStats.map((item) => (
        <div key={item.stat} className={`p-5 ${card} ${cardHover}`}>
          <strong className={`block text-[22px] mb-2 ${ink}`}>{item.stat}</strong>
          <span className={`text-sm ${body}`}>{item.label}</span>
        </div>
      ))}
    </>
  );
}

function Logo() {
  return (
    <>
      <Image src="/logo-dark.png" alt="SimplAssist" width={140} height={34} className="hidden dark:block h-8 w-auto object-contain" />
      <Image src="/logo-light.png" alt="SimplAssist" width={140} height={34} className="block dark:hidden h-8 w-auto object-contain" />
    </>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <Reveal className="mb-12 sm:mb-16">
      <h2 className={`text-[clamp(28px,4vw,46px)] leading-[1.04] tracking-[-0.04em] font-extrabold ${ink}`}>
        {title}
      </h2>
      <p className={`${body} mt-4 max-w-[60ch] leading-[1.65]`}>{subtitle}</p>
    </Reveal>
  );
}

/* ── Page ── */

export default function HomePage() {
  return (
    <div className={`${pageShell} isolate`} style={{ fontFamily: fontStack }}>
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
              <h1 className={`text-[clamp(40px,7vw,76px)] font-extrabold leading-[0.96] tracking-[-0.05em] mb-5 mt-12 sm:mt-0 ${ink}`}>
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
                  Get Started
                </Link>
                <a href="#how-it-works" className={btnSecondary}>
                  See How It Works
                </a>
              </div>

              {/* Mini stat cards — desktop: in-column under the CTAs */}
              <div className="hidden lg:grid lg:grid-cols-3 gap-3.5 mt-7 w-full">
                <HeroStatCards />
              </div>
            </div>
          </Reveal>

          {/* Hero panel — animated conversation demo (all widths) */}
          <Reveal priority delayMs={140}>
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
              <HeroDemo />
            </div>
          </Reveal>

          {/* Mini stat cards — mobile/tablet: after the demo */}
          <Reveal className="lg:hidden">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 w-full">
              <HeroStatCards />
            </div>
          </Reveal>
        </section>

        {/* ── Features ── */}
        <section id="features" className="py-16 sm:py-24">
          <SectionHeader
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
            title={
              <>
                Three simple steps to keep every <span className={accentText}>lead</span>.
              </>
            }
            subtitle="Go from sign-up to live AI assistant in just a few guided steps."
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
            title={
              <>
                Simple plans that grow with your{" "}
                <span className={accentText}>business</span>.
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
          <section className={`my-6 p-8 grid lg:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-10 items-start ${card}`}>
            <div className="lg:pt-1.5">
              <h2 className={`text-balance text-[clamp(28px,4vw,48px)] font-extrabold leading-[1.05] tracking-[-0.04em] mb-3 ${ink}`}>
                Your voicemail isn&apos;t closing deals.
              </h2>
              <p className={`${body} leading-[1.7] max-w-[560px]`}>
                SimplAssist texts customers back before they&apos;ve dialed your competitor.
              </p>
            </div>
            <div className={`${tile} p-6`}>
              <strong className={`block text-base mb-2.5 ${ink}`}>
                What you get:
              </strong>
              <ul className="space-y-2.5 mb-5">
                {[
                  "AI that texts back every missed call, day or night",
                  "Website chat widget — embed with one line of code",
                  "Every lead and conversation in one dashboard",
                  "Live the same week, once your number's approved to send",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-stone-700 dark:text-[#ececec]">
                    <span className="w-2 h-2 rounded-full bg-[#ea580c] dark:bg-[#ff914d] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={btnPrimaryWide}>
                Get Started
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
