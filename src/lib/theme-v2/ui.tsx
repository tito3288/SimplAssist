"use client";

/**
 * Interactive primitives for the /preview/*-v2 design exploration.
 * Local copies — intentionally not shared with production components.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { fieldLabel, inputField } from "./theme";

/* ── Scroll reveal ── */

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Staggered delay before the transition runs (ms). */
  delayMs?: number;
  /** Animate shortly after mount instead of waiting for the viewport (hero). */
  priority?: boolean;
};

/**
 * Fade + slide-up when the element enters the viewport.
 * Respects `prefers-reduced-motion`.
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
  priority = false,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setVisible(true);
      return;
    }

    if (priority) {
      const id = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(id);
    }

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [reduceMotion, priority]);

  return (
    <div
      ref={ref}
      className={`
        will-change-[opacity,transform]
        transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"}
        ${className}
      `}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* ── Theme toggle ── */

/** Same behavior as the production toggle, restyled for the v2 surfaces. */
export function ThemeToggleV2() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-10 w-10" />;
  }

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="
        relative inline-flex h-10 w-10 items-center justify-center rounded-full
        bg-white text-stone-500 border border-[#e7e0d4]
        hover:text-[#c2410c] hover:bg-[#faf6ef]
        dark:bg-white/[0.07] dark:text-[#bdbdbf] dark:border-white/[0.12]
        dark:hover:text-[#ffb07a] dark:hover:bg-white/[0.11]
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/60
        dark:focus-visible:ring-[#ff914d]/60 focus-visible:ring-offset-2
        focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
      "
      aria-label="Toggle theme"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  );
}

/* ── Password field (react-hook-form aware, mirrors AuthPasswordField) ── */

type AuthPasswordFieldV2Props = {
  id: string;
  label: string;
  autoComplete?: string;
  placeholder?: string;
  error?: string;
  registration: UseFormRegisterReturn;
};

export function AuthPasswordFieldV2({
  id,
  label,
  autoComplete,
  placeholder = "••••••••",
  error,
  registration,
}: AuthPasswordFieldV2Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          {...registration}
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
      {error && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

/* ── Loading dot (matte, no glow) ── */

export function LoadingDot() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-current opacity-80"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    />
  );
}

/* ── Switch (on/off toggle) ── */

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  /** Accessible name when there is no visible <label htmlFor>. */
  label?: string;
};

/** Matte on/off switch. Track fills with the accent when on — no glow. */
export function Switch({ checked, onCheckedChange, id, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent
        transition-colors duration-150 motion-reduce:transition-none
        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        focus-visible:ring-[#ea580c]/60 dark:focus-visible:ring-[#ff914d]/60
        focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${checked ? "bg-[#ea580c] dark:bg-[#ff914d]" : "bg-stone-200 dark:bg-white/[0.12]"}
      `}
    >
      <span
        className={`
          inline-block h-5 w-5 rounded-full bg-white shadow-sm
          transition-transform duration-150 motion-reduce:transition-none
          ${checked ? "translate-x-[22px]" : "translate-x-0.5"}
        `}
      />
    </button>
  );
}

/* ── Option card (selectable radio-card) ── */

type OptionCardProps = {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
};

/** Selectable card. Selected = accent outline + warm tint; rest = neutral tile. */
export function OptionCard({
  selected,
  onSelect,
  children,
  className = "",
  disabled,
}: OptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`
        w-full text-left rounded-[18px] p-4
        transition-[border-color,box-shadow,background-color] duration-150 motion-reduce:transition-none
        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        focus-visible:ring-[#ea580c]/60 dark:focus-visible:ring-[#ff914d]/60
        focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${
          selected
            ? `border border-[#ea580c] ring-2 ring-[#ea580c]/25 bg-[#fdf1e7]
               dark:border-[#ff914d] dark:ring-[#ff914d]/25 dark:bg-[rgba(255,145,77,0.10)]`
            : `border border-[#ede5d9] bg-[#faf7f2] hover:border-[#d9d0c1]
               dark:border-white/[0.10] dark:bg-white/[0.04] dark:hover:border-white/[0.16]`
        }
        ${className}
      `}
    >
      {children}
    </button>
  );
}
