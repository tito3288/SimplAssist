import { card, tile } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading calendar…
      </p>

      <div className="space-y-6" aria-hidden="true">
        <header className="space-y-2" data-skeleton-section="calendar-header">
          <div className={`h-8 w-32 rounded-xl ${skeleton}`} />
          <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
        </header>

        <section
          className={`${card} p-5 sm:p-6`}
          data-skeleton-section="calendar-view"
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div
                className="mb-5 flex items-center justify-between"
                data-skeleton-section="calendar-controls"
              >
                <div className="flex items-center gap-2">
                  <div className={`h-9 w-9 rounded-xl ${skeleton}`} />
                  <div className={`h-9 w-9 rounded-xl ${skeleton}`} />
                  <div className={`ml-2 h-6 w-36 rounded-lg ${skeleton}`} />
                </div>
                <div className={`h-8 w-16 rounded-full ${skeleton}`} />
              </div>

              <div className="mb-1 grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, index) => (
                  <div
                    key={index}
                    className={`mx-auto h-3 w-7 rounded-lg ${skeleton}`}
                    data-skeleton-weekday="true"
                  />
                ))}
              </div>

              <div
                className="grid grid-cols-7"
                data-skeleton-section="calendar-month-grid"
              >
                {Array.from({ length: 42 }, (_, index) => (
                  <div
                    key={index}
                    className="flex aspect-square items-center justify-center rounded-xl"
                    data-skeleton-day="true"
                  >
                    <div className={`h-7 w-7 rounded-full ${skeleton}`} />
                  </div>
                ))}
              </div>
            </div>

            <aside
              className={`${tile} h-full p-4 lg:col-span-1`}
              data-skeleton-section="calendar-day-panel"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className={`h-4 w-40 max-w-full rounded-lg ${skeleton}`} />
                <div className={`h-7 w-7 shrink-0 rounded-lg ${skeleton}`} />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-[22px] border border-[var(--brand-calendar-border)] p-3.5 dark:border-white/[0.10]"
                    data-skeleton-event="true"
                  >
                    <div className={`h-3 w-24 rounded-lg ${skeleton}`} />
                    <div className={`h-4 w-32 max-w-full rounded-lg ${skeleton}`} />
                    <div className={`h-3 w-4/5 rounded-lg ${skeleton}`} />
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
