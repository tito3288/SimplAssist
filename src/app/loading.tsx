import { PulsingDot } from "@/components/ui/pulsing-dot";

export default function Loading() {
  return (
    <div
      className="
        flex min-h-screen flex-col items-center justify-center gap-2
        bg-gradient-to-b from-slate-50 via-white to-slate-100
        dark:bg-none dark:bg-[#050505]
      "
    >
      <PulsingDot />
      <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">Loading…</p>
    </div>
  );
}
