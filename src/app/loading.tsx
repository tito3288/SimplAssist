import { PulsingDot } from "@/components/ui/pulsing-dot";
import { body, darkAmbient, lightAmbient, pageShell } from "@/lib/theme-v2/theme";

export default function Loading() {
  return (
    <div
      className={`${pageShell} isolate flex min-h-screen flex-col items-center justify-center gap-2`}
    >
      <div
        className="pointer-events-none fixed inset-0 -z-10 dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{ background: darkAmbient }}
      />
      <PulsingDot />
      <p className={`text-sm ${body}`}>Loading…</p>
    </div>
  );
}
