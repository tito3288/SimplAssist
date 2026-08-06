import { card, tile } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading dashboard…
      </p>

      <div className="space-y-6" aria-hidden="true">
        <header className="space-y-2" data-skeleton-section="dashboard-header">
          <div className={`h-9 w-64 max-w-full rounded-xl ${skeleton}`} />
          <div className={`h-7 w-32 rounded-lg ${skeleton}`} />
          <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
        </header>

        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          data-skeleton-section="dashboard-stats"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={`${card} p-5`} data-skeleton-stat="true">
              <div className="mb-3 flex items-center justify-between">
                <div className={`h-9 w-9 rounded-xl ${skeleton}`} />
                <div className={`h-6 w-16 rounded-full ${skeleton}`} />
              </div>
              <div className={`h-4 w-28 rounded-lg ${skeleton}`} />
              <div className={`mt-2 h-8 w-14 rounded-lg ${skeleton}`} />
            </div>
          ))}
        </section>

        <section
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          data-skeleton-section="dashboard-lists"
        >
          {Array.from({ length: 2 }, (_, panelIndex) => (
            <div
              key={panelIndex}
              className={`${card} overflow-hidden`}
              data-skeleton-list="true"
            >
              <div className="flex items-center justify-between border-b border-[#ece4d8] p-4 dark:border-white/[0.10]">
                <div className={`h-5 w-40 rounded-lg ${skeleton}`} />
                <div className={`h-4 w-14 rounded-lg ${skeleton}`} />
              </div>
              <div className="space-y-3 p-4">
                {Array.from({ length: 3 }, (_, rowIndex) => (
                  <div
                    key={rowIndex}
                    className={`${tile} flex items-center justify-between gap-4 p-4`}
                    data-skeleton-row="true"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className={`h-4 w-32 max-w-full rounded-lg ${skeleton}`} />
                      <div className={`h-3 w-48 max-w-full rounded-lg ${skeleton}`} />
                    </div>
                    <div className={`h-6 w-12 shrink-0 rounded-full ${skeleton}`} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className={`${card} p-5 sm:p-6`} data-skeleton-section="quick-actions">
          <div className={`h-6 w-32 rounded-lg ${skeleton}`} />
          <div className={`mt-2 h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={`${tile} space-y-3 p-5`}>
                <div className={`ml-auto h-9 w-9 rounded-xl ${skeleton}`} />
                <div className={`h-5 w-32 rounded-lg ${skeleton}`} />
                <div className={`h-3 w-full rounded-lg ${skeleton}`} />
                <div className={`h-3 w-4/5 rounded-lg ${skeleton}`} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
