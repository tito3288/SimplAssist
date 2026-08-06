import { card } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

const filterWidths = ["w-14", "w-12", "w-20", "w-24"];

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading knowledge gaps…
      </p>

      <div className="space-y-6" aria-hidden="true">
        <header className="space-y-2" data-skeleton-section="knowledge-gaps-header">
          <div className={`h-8 w-52 max-w-full rounded-xl ${skeleton}`} />
          <div className={`h-4 w-96 max-w-full rounded-lg ${skeleton}`} />
          <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
        </header>

        <section
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          data-skeleton-section="knowledge-gaps-summary"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className={`${card} p-5`}
              data-skeleton-summary-card="true"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className={`h-4 w-20 rounded-lg ${skeleton}`} />
                  <div className={`h-8 w-12 rounded-lg ${skeleton}`} />
                </div>
                <div className={`h-7 w-7 rounded-full ${skeleton}`} />
              </div>
            </div>
          ))}
        </section>

        <section
          className={`${card} overflow-hidden`}
          data-skeleton-section="knowledge-gaps-list"
        >
          <div
            className="flex flex-col gap-3 border-b border-[#ece4d8] p-4 dark:border-white/[0.10] sm:flex-row sm:items-center sm:justify-between"
            data-skeleton-section="knowledge-gaps-filters"
          >
            <div className="flex flex-wrap gap-2">
              {filterWidths.map((width) => (
                <div
                  key={width}
                  className={`h-8 ${width} rounded-full ${skeleton}`}
                  data-skeleton-filter="true"
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className={`h-4 w-8 rounded-lg ${skeleton}`} />
              <div className={`h-9 w-32 rounded-lg ${skeleton}`} />
            </div>
          </div>

          <div className="divide-y divide-[#ece4d8] dark:divide-white/[0.10]">
            {Array.from({ length: 4 }, (_, index) => (
              <article
                key={index}
                className="p-4 sm:p-5"
                data-skeleton-gap-row="true"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2">
                      <div className={`h-6 w-14 rounded-full ${skeleton}`} />
                      <div className={`h-6 w-12 rounded-full ${skeleton}`} />
                    </div>
                    <div className={`mt-3 h-5 w-3/4 rounded-lg ${skeleton}`} />
                    <div className="mt-2 flex gap-4">
                      <div className={`h-3 w-20 rounded-lg ${skeleton}`} />
                      <div className={`h-3 w-28 rounded-lg ${skeleton}`} />
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <div className={`h-8 w-24 rounded-full ${skeleton}`} />
                    <div className={`h-8 w-20 rounded-full ${skeleton}`} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
