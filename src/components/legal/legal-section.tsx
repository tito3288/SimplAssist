import type { ReactNode } from "react";
import { body, ink } from "@/lib/theme-v2/theme";

type LegalSectionProps = {
  title: string;
  children: ReactNode;
};

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section>
      <h2
        className={`mb-3 text-lg font-semibold tracking-tight sm:text-xl ${ink}`}
      >
        {title}
      </h2>
      <div
        className={`space-y-3 text-[15px] leading-relaxed sm:text-base ${body}`}
      >
        {children}
      </div>
    </section>
  );
}
