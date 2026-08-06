import { card } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="h-[calc(100vh-4rem)]" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading conversations…
      </p>

      <div
        className={`flex h-full overflow-hidden ${card}`}
        aria-hidden="true"
        data-skeleton-section="conversation-inbox"
      >
        <div className="flex h-full w-full flex-shrink-0 flex-col border-r border-[#ece4d8] bg-white dark:border-white/[0.10] dark:bg-transparent md:w-[350px]">
          <div
            className="border-b border-[#ece4d8] p-3 dark:border-white/[0.10]"
            data-skeleton-section="conversation-search"
          >
            <div className={`h-10 w-full rounded-lg ${skeleton}`} />
          </div>

          <div
            className="flex gap-3 border-b border-[#ece4d8] px-3 py-2 dark:border-white/[0.10]"
            data-skeleton-section="conversation-filters"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className={`h-5 flex-1 rounded-lg ${skeleton}`}
                data-skeleton-filter="true"
              />
            ))}
          </div>

          <div className="flex-1 overflow-hidden" data-skeleton-section="conversation-list">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="flex items-start gap-3 border-b border-[#f0e9de] px-4 py-3 dark:border-white/[0.06]"
                data-skeleton-conversation="true"
              >
                <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full ${skeleton}`} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`h-4 w-28 rounded-lg ${skeleton}`} />
                    <div className={`h-3 w-12 rounded-lg ${skeleton}`} />
                  </div>
                  <div className={`h-3 w-full rounded-lg ${skeleton}`} />
                  <div className={`h-5 w-14 rounded-full ${skeleton}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="hidden flex-1 flex-col md:flex"
          data-skeleton-section="conversation-preview"
        >
          <div className="flex items-center gap-3 border-b border-[#ece4d8] p-4 dark:border-white/[0.10]">
            <div className={`h-10 w-10 rounded-full ${skeleton}`} />
            <div className="space-y-2">
              <div className={`h-4 w-36 rounded-lg ${skeleton}`} />
              <div className={`h-3 w-24 rounded-lg ${skeleton}`} />
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-4 p-6">
            <div className={`h-16 w-3/5 rounded-[22px] ${skeleton}`} />
            <div className={`ml-auto h-20 w-2/3 rounded-[22px] ${skeleton}`} />
            <div className={`h-14 w-1/2 rounded-[22px] ${skeleton}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
