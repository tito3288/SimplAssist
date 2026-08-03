"use client";

import type { ReactNode } from "react";
import { useBrand } from "@/components/branding/BrandProvider";
import { body, ink, inlineLink } from "@/lib/theme-v2/theme";

export function SignupConfirmation({
  icon,
  onGoBack,
}: {
  icon: ReactNode;
  onGoBack: () => void;
}) {
  const brand = useBrand();

  return (
    <div className="text-center">
      {icon}
      <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>
        Check your email
      </h1>
      <p className={`mt-2 text-sm leading-relaxed ${body}`}>
        We sent you a confirmation link. Open it to activate your account and
        start using {brand.name}.
      </p>
      <p className={`mt-6 text-sm ${body}`}>
        Wrong address?{" "}
        <button type="button" onClick={onGoBack} className={inlineLink}>
          Go back
        </button>
      </p>
    </div>
  );
}
