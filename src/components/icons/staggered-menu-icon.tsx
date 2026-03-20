import { cn } from "@/lib/utils";

const ease = "ease-[cubic-bezier(0.22,1,0.36,1)]";
const barBase =
  "absolute h-[3px] rounded-full bg-[#FF8533] shadow-[0_0_10px_rgba(255,133,51,0.45)] transition-all duration-300 " +
  ease;

/**
 * Staggered orange bars that morph into an X when `open` is true.
 */
export function StaggeredMenuIcon({
  open = false,
  className,
}: {
  open?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-block w-[22px] h-[19px] shrink-0", className)}
      aria-hidden
    >
      {/* Top — short right; opens to \ */}
      <span
        className={cn(
          barBase,
          "origin-center",
          open
            ? "left-0 top-1/2 w-full -translate-y-1/2 rotate-45 shadow-[0_0_14px_rgba(255,133,51,0.55)]"
            : "top-0 right-0 w-[72%] translate-y-0 rotate-0"
        )}
      />
      {/* Middle — full width; fades out when open */}
      <span
        className={cn(
          barBase,
          "left-0 top-2 w-full origin-center",
          open
            ? "scale-x-0 opacity-0"
            : "translate-y-0 rotate-0 scale-x-100 opacity-100"
        )}
      />
      {/* Bottom — short right; opens to / */}
      <span
        className={cn(
          barBase,
          "origin-center",
          open
            ? "left-0 top-1/2 w-full -translate-y-1/2 -rotate-45 shadow-[0_0_14px_rgba(255,133,51,0.55)]"
            : "bottom-0 right-0 w-[46%] translate-y-0 rotate-0"
        )}
      />
    </span>
  );
}
