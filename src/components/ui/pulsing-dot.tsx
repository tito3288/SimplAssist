import { cn } from "@/lib/utils";

type PulsingDotProps = {
  className?: string;
  /** Use inside buttons / inline rows (removes bottom margin) */
  inline?: boolean;
};

/**
 * Global loading indicator — matches `.dot` in globals.css (pulsing #ff8c42).
 */
export function PulsingDot({ className, inline }: PulsingDotProps) {
  return (
    <div
      className={cn("dot", inline && "dot--inline", className)}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    />
  );
}
