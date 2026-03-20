"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type FadeInProps = {
  children: ReactNode;
  className?: string;
  /** Staggered delay before the transition runs (ms) */
  delayMs?: number;
  /** Animate in shortly after mount (nav, hero above the fold) */
  priority?: boolean;
  /** Vertical offset while hidden (Tailwind spacing scale) */
  offset?: "sm" | "md" | "lg";
};

const offsetClass = {
  sm: "translate-y-3",
  md: "translate-y-6",
  lg: "translate-y-8",
} as const;

/**
 * Fades and slides content up when it enters the viewport.
 * Respects `prefers-reduced-motion`.
 */
export function FadeIn({
  children,
  className,
  delayMs = 0,
  priority = false,
  offset = "md",
}: FadeInProps) {
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
      const id = window.requestAnimationFrame(() => {
        setVisible(true);
      });
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
      className={cn(
        "will-change-[opacity,transform]",
        "transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
        visible ? "opacity-100 translate-y-0" : cn("opacity-0", offsetClass[offset]),
        className
      )}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}
