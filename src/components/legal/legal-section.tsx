import type { ReactNode } from "react";
import { textPrimary, textSecondary } from "@/lib/glass";

type LegalSectionProps = {
  title: string;
  children: ReactNode;
};

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section>
      <h2
        className={`mb-3 text-lg font-semibold tracking-tight sm:text-xl ${textPrimary}`}
      >
        {title}
      </h2>
      <div
        className={`space-y-3 text-[15px] leading-relaxed sm:text-base ${textSecondary}`}
      >
        {children}
      </div>
    </section>
  );
}
