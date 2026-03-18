import Link from "next/link";
import {
  PhoneOff,
  MessageSquare,
  LayoutDashboard,
  Phone,
  Globe,
  Users,
  Sparkles,
  Inbox,
  TrendingUp,
  Check,
} from "lucide-react";

const steps = [
  {
    icon: PhoneOff,
    title: "Customer calls, you're busy",
    description:
      "You're with a client, on the road, or after hours. The call goes unanswered — but not unnoticed.",
  },
  {
    icon: MessageSquare,
    title: "AI texts them back instantly",
    description:
      "Within seconds, your AI assistant sends a personalized text letting them know you'll follow up.",
  },
  {
    icon: LayoutDashboard,
    title: "You see everything in your dashboard",
    description:
      "Every conversation, contact, and lead — organized and ready for you when you're free.",
  },
];

const features = [
  {
    icon: Phone,
    title: "AI Missed-Call Texting",
    description: "Automatically responds to missed calls via SMS so you never lose a lead.",
  },
  {
    icon: Globe,
    title: "Website Chat Widget",
    description: "Embed an AI chat assistant on your site to engage visitors 24/7.",
  },
  {
    icon: Users,
    title: "Smart Contact Management",
    description: "Every interaction is tracked automatically — calls, texts, and chats.",
  },
  {
    icon: Sparkles,
    title: "Customizable AI Personality",
    description: "Set the tone, greetings, and guardrails so AI sounds like your brand.",
  },
  {
    icon: Inbox,
    title: "Multi-Channel Inbox",
    description: "SMS and web chat conversations in one unified place.",
  },
  {
    icon: TrendingUp,
    title: "Lead Scoring",
    description: "AI identifies your hottest prospects so you know who to call first.",
  },
];

const plans = [
  {
    name: "SMS Only",
    price: "$25",
    description: "Missed-call texting for small teams",
    features: [
      "AI missed-call SMS responses",
      "Smart contact management",
      "Conversation inbox",
      "Up to 500 texts/month",
    ],
    highlighted: false,
  },
  {
    name: "SMS + Web Chat",
    price: "$45",
    description: "Add website chat to capture more leads",
    features: [
      "Everything in SMS Only",
      "Website chat widget",
      "Multi-channel inbox",
      "Customizable AI personality",
      "Up to 1,000 texts/month",
    ],
    highlighted: true,
  },
  {
    name: "Full Suite",
    price: "$65",
    description: "The complete customer communication platform",
    features: [
      "Everything in SMS + Web Chat",
      "Lead scoring",
      "Priority support",
      "Advanced analytics",
      "Unlimited texts",
    ],
    highlighted: false,
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link href="/home" className="text-xl font-bold text-slate-900">
          SimplAssist
        </Link>
        <div className="flex items-center gap-6">
          <a href="#features" className="text-sm text-slate-600 hover:text-slate-900">
            Features
          </a>
          <a href="#pricing" className="text-sm text-slate-600 hover:text-slate-900">
            Pricing
          </a>
          <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">
            Log In
          </Link>
          <Link
            href="/signup"
            className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-24 bg-gradient-to-b from-blue-50 to-white">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-slate-900 tracking-tight">
            Never Miss a Customer Again
          </h1>
          <p className="mt-6 text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
            SimplAssist is your AI-powered assistant that texts back customers 24/7 when you
            can&apos;t answer the phone, and chats with website visitors automatically.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/signup"
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Get Started Free
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 bg-white text-slate-700 font-medium rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-slate-900 mb-4">How It Works</h2>
          <p className="text-center text-slate-600 mb-16 max-w-xl mx-auto">
            Three simple steps to make sure you never lose another customer.
          </p>
          <div className="grid md:grid-cols-3 gap-12">
            {steps.map((step, i) => (
              <div key={step.title} className="text-center">
                <div className="w-16 h-16 mx-auto mb-6 bg-blue-100 rounded-2xl flex items-center justify-center">
                  <span className="absolute -mt-16 -ml-8 text-sm font-bold text-blue-600 bg-blue-50 rounded-full w-7 h-7 flex items-center justify-center">
                    {i + 1}
                  </span>
                  <step.icon className="w-7 h-7 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{step.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-24 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-slate-900 mb-4">
            Everything You Need
          </h2>
          <p className="text-center text-slate-600 mb-16 max-w-xl mx-auto">
            Built for small businesses that want to deliver big-business customer service.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-white p-6 rounded-xl border border-slate-200"
              >
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <feature.icon className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-slate-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-center text-slate-600 mb-16 max-w-xl mx-auto">
            Start free and upgrade as your business grows.
          </p>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-8 flex flex-col ${
                  plan.highlighted
                    ? "border-blue-600 ring-2 ring-blue-600 relative"
                    : "border-slate-200"
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-medium px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                <p className="text-sm text-slate-600 mt-1">{plan.description}</p>
                <div className="mt-6 mb-6">
                  <span className="text-4xl font-bold text-slate-900">{plan.price}</span>
                  <span className="text-slate-600">/mo</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                      <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`block text-center py-2.5 rounded-lg font-medium transition-colors ${
                    plan.highlighted
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-slate-100 text-slate-900 hover:bg-slate-200"
                  }`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-slate-200">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="font-bold text-slate-900">SimplAssist</p>
            <p className="text-sm text-slate-500 mt-1">Built for small businesses</p>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-600">
            <a href="#features" className="hover:text-slate-900">
              Features
            </a>
            <a href="#pricing" className="hover:text-slate-900">
              Pricing
            </a>
            <Link href="/privacy" className="hover:text-slate-900">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-slate-900">
              Terms of Service
            </Link>
            <Link href="/login" className="hover:text-slate-900">
              Login
            </Link>
            <Link href="/signup" className="hover:text-slate-900">
              Sign Up
            </Link>
          </div>
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} SimplAssist. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
