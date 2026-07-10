"use client";

/**
 * Design preview for the signup/login pages. Visual redesign only — forms are
 * inert (no Supabase calls): submitting "Create account" shows the
 * check-your-email state, submitting "Sign in" shows the loading state.
 * `?view=login` opens the login view (the home-v2 nav links here).
 */

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Mail } from "lucide-react";
import { LoadingDot, ThemeToggleV2 } from "@/lib/theme-v2/ui";
import {
  body,
  btnPrimaryWide,
  card,
  darkAmbient,
  fieldLabel,
  fontStack,
  ink,
  inlineLink,
  inputField,
  lightAmbient,
  pageShell,
  tile,
} from "@/lib/theme-v2/theme";

type View = "signup" | "login" | "sent";

/* ── Password field (local copy, matte v2 styling) ── */

function PasswordField({
  id,
  label,
  autoComplete,
  placeholder = "••••••••",
}: {
  id: string;
  label: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className={`${inputField} pr-12`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="
            absolute right-2.5 top-1/2 -translate-y-1/2 rounded-xl p-2
            text-stone-500 hover:text-[#c2410c]
            dark:text-[#888] dark:hover:text-[#ffb07a]
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/50
            dark:focus-visible:ring-[#ff914d]/50 focus-visible:ring-offset-2
            focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0a0a0c]
          "
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? (
            <Eye className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
          ) : (
            <EyeOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Card content per view ── */

function SignupView({
  onSwitchToLogin,
  onSent,
}: {
  onSwitchToLogin: () => void;
  onSent: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Design preview only — simulate the request, then show the success state.
    window.setTimeout(() => {
      setSubmitting(false);
      onSent();
    }, 900);
  }

  return (
    <div>
      <h1 className={`text-center text-2xl font-bold tracking-tight ${ink}`}>
        Create your account
      </h1>
      <p className={`mt-1 text-center text-sm ${body}`}>
        Free to try — no credit card required.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="fullName" className={fieldLabel}>
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            className={inputField}
            placeholder="Bryan Arambula"
          />
        </div>

        <div>
          <label htmlFor="email" className={fieldLabel}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className={inputField}
            placeholder="you@example.com"
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
        />

        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          placeholder="••••••••"
        />

        <button type="submit" disabled={submitting} className={btnPrimaryWide}>
          {submitting ? (
            <>
              <LoadingDot />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p className={`mt-6 text-center text-xs ${body}`}>
        By signing up you agree to our{" "}
        <Link href="/terms" className={`${inlineLink} underline-offset-2 hover:underline`}>
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className={`${inlineLink} underline-offset-2 hover:underline`}>
          Privacy
        </Link>
        .
      </p>

      <p className={`mt-4 text-center text-sm ${body}`}>
        Already have an account?{" "}
        <button type="button" onClick={onSwitchToLogin} className={inlineLink}>
          Log in
        </button>
      </p>
    </div>
  );
}

function SentView({ onBack }: { onBack: () => void }) {
  return (
    <div className="text-center">
      <div
        className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center ${tile}`}
      >
        <Mail className="h-7 w-7 text-[#ea580c] dark:text-[#ff914d]" aria-hidden />
      </div>
      <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>
        Check your email
      </h1>
      <p className={`mt-2 text-sm leading-relaxed ${body}`}>
        We sent you a confirmation link. Open it to activate your account and
        start using SimplAssist.
      </p>
      <p className={`mt-6 text-sm ${body}`}>
        Wrong address?{" "}
        <button type="button" onClick={onBack} className={inlineLink}>
          Go back
        </button>
      </p>
    </div>
  );
}

function LoginView({ onSwitchToSignup }: { onSwitchToSignup: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Design preview only — simulate the request.
    window.setTimeout(() => setSubmitting(false), 900);
  }

  return (
    <div>
      <h1 className={`text-center text-2xl font-bold tracking-tight ${ink}`}>
        Log in
      </h1>
      <p className={`mt-1 text-center text-sm ${body}`}>
        Welcome back — pick up where you left off.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className={fieldLabel}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className={inputField}
            placeholder="you@example.com"
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          placeholder="••••••••"
        />

        <button type="submit" disabled={submitting} className={btnPrimaryWide}>
          {submitting ? (
            <>
              <LoadingDot />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className={`mt-8 text-center text-sm ${body}`}>
        Don&apos;t have an account?{" "}
        <button type="button" onClick={onSwitchToSignup} className={inlineLink}>
          Create one
        </button>
      </p>
    </div>
  );
}

/* ── Page shell ── */

function AuthV2Content() {
  const searchParams = useSearchParams();
  const initialView: View = searchParams.get("view") === "login" ? "login" : "signup";
  const [view, setView] = useState<View>(initialView);

  return (
    <div
      className={`${pageShell} flex flex-col items-center justify-center p-4 sm:p-6`}
      style={{ fontFamily: fontStack }}
    >
      {/* Ambient backgrounds */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{ background: darkAmbient }}
      />

      {/* Orbs */}
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-20 dark:opacity-40"
        style={{
          width: 520,
          height: 520,
          background: "rgba(255,145,77,.20)",
          top: -120,
          right: -160,
          filter: "blur(64px)",
        }}
      />
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-15 dark:opacity-35"
        style={{
          width: 280,
          height: 280,
          background: "rgba(255,145,77,.14)",
          left: -100,
          bottom: "12%",
          filter: "blur(56px)",
        }}
      />

      <div className="relative z-[1] w-full max-w-[440px]">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/preview/home-v2"
            className="
              inline-flex items-center gap-2 text-sm font-medium
              text-stone-600 hover:text-[#c2410c]
              dark:text-[#bdbdbf] dark:hover:text-[#ff914d]
              transition-colors
            "
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back to home
          </Link>
          <ThemeToggleV2 />
        </div>

        {/* Brand */}
        <div className="mb-8 text-center">
          <Link
            href="/preview/home-v2"
            className="
              inline-flex flex-col items-center gap-3 rounded-[28px]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/50
              dark:focus-visible:ring-[#ff914d]/50 focus-visible:ring-offset-2
              focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
            "
          >
            <Image
              src="/logo-light.png"
              alt="SimplAssist"
              width={180}
              height={48}
              className="h-10 w-auto object-contain dark:hidden"
              priority
            />
            <Image
              src="/logo-dark.png"
              alt="SimplAssist"
              width={180}
              height={48}
              className="hidden h-10 w-auto object-contain dark:block"
              priority
            />
          </Link>
          <p className={`mt-3 max-w-[320px] mx-auto text-sm leading-relaxed ${body}`}>
            AI-powered customer communication for small businesses
          </p>
          <Link
            href="/preview/home-v2"
            className={`mt-2 inline-block text-xs ${inlineLink}`}
          >
            Learn more
          </Link>
        </div>

        {/* Form card */}
        <div className={`p-8 sm:p-10 ${card}`}>
          {view === "signup" && (
            <SignupView
              onSwitchToLogin={() => setView("login")}
              onSent={() => setView("sent")}
            />
          )}
          {view === "sent" && <SentView onBack={() => setView("signup")} />}
          {view === "login" && (
            <LoginView onSwitchToSignup={() => setView("signup")} />
          )}
        </div>

        <p className={`mt-6 text-center text-xs ${body}`}>
          &copy; {new Date().getFullYear()} SimplAssist
        </p>
      </div>
    </div>
  );
}

export default function AuthV2Page() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <AuthV2Content />
    </Suspense>
  );
}
