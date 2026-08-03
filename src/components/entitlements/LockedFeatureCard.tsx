import Link from "next/link";
import { Lock } from "lucide-react";
import { card } from "@/lib/theme-v2/theme";

interface LockedFeatureCardProps {
  title: string;
  description: string;
  requiredPlan?: "Growth" | "Full Suite" | null;
  preservedDetail?: string;
  compact?: boolean;
}

export function LockedFeatureCard({
  title,
  description,
  requiredPlan = "Growth",
  preservedDetail,
  compact = false,
}: LockedFeatureCardProps) {
  return (
    <div className={`${card} ${compact ? "p-5" : "p-6 sm:p-8"}`}>
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/.14)] dark:text-[var(--brand-accent-dark)]">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f5f5]">
              {title}
            </h2>
            {requiredPlan && (
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600 dark:bg-white/[0.08] dark:text-[#d2d2d4]">
                {requiredPlan}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-[#bdbdbf]">
            {description}
          </p>
          {preservedDetail && (
            <p className="mt-2 text-xs text-stone-500 dark:text-[#8f8f92]">
              {preservedDetail}
            </p>
          )}
          <Link
            href="/billing"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-active)] dark:bg-[var(--brand-primary-dark)] dark:text-[#16100b] dark:hover:bg-[var(--brand-primary-hover-dark)]"
          >
            Manage plan
          </Link>
        </div>
      </div>
    </div>
  );
}
