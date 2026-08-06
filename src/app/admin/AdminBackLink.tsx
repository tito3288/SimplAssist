import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { btnSecondaryCompact } from "@/lib/theme-v2/theme";

export function AdminBackLink({
  href = "/admin",
  ariaLabel = "Back to admin",
}: {
  href?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`${btnSecondaryCompact} w-fit`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      Back
    </Link>
  );
}
