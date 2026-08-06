import { card, tile } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading contacts…
      </p>

      <div className="space-y-6" aria-hidden="true">
        <header className="space-y-2" data-skeleton-section="contacts-header">
          <div className={`h-7 w-28 rounded-lg ${skeleton}`} />
          <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
        </header>

        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          data-skeleton-section="contact-stats"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className={`${card} flex items-center gap-3 p-5`}
              data-skeleton-stat="true"
            >
              <div className={`h-10 w-10 shrink-0 rounded-xl ${skeleton}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-4 w-24 rounded-lg ${skeleton}`} />
                <div className={`h-7 w-14 rounded-lg ${skeleton}`} />
              </div>
            </div>
          ))}
        </section>

        <section data-skeleton-section="contacts-table">
          <div
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            data-skeleton-section="contacts-toolbar"
          >
            <div className={`${tile} w-full max-w-sm p-2.5`}>
              <div className={`h-5 w-40 rounded-lg ${skeleton}`} />
            </div>
            <div className="flex items-center gap-2">
              <div className={`${tile} flex gap-2 p-2`} data-skeleton-section="contact-filters">
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className={`h-5 w-12 rounded-lg ${skeleton}`}
                    data-skeleton-filter="true"
                  />
                ))}
              </div>
              <div className={`${tile} p-2`}>
                <div className={`h-5 w-20 rounded-lg ${skeleton}`} />
              </div>
            </div>
          </div>

          <div className={`${card} mt-4 overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-[#ece4d8] bg-[#faf7f2] dark:border-white/[0.06] dark:bg-white/[0.03]">
                    {Array.from({ length: 7 }, (_, index) => (
                      <th key={index} className="px-6 py-3">
                        <div
                          className={`h-3 rounded-lg ${index === 2 ? "w-20" : "w-14"} ${skeleton}`}
                          data-skeleton-column="true"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ece4d8] dark:divide-white/[0.06]">
                  {Array.from({ length: 5 }, (_, rowIndex) => (
                    <tr key={rowIndex} data-skeleton-contact="true">
                      <td className="px-6 py-4">
                        <div className={`h-4 w-28 rounded-lg ${skeleton}`} />
                      </td>
                      <td className="px-6 py-4">
                        <div className={`h-4 w-24 rounded-lg ${skeleton}`} />
                      </td>
                      <td className="px-6 py-4">
                        <div className={`h-4 w-36 rounded-lg ${skeleton}`} />
                      </td>
                      <td className="px-6 py-4">
                        <div className={`h-5 w-5 rounded-full ${skeleton}`} />
                      </td>
                      <td className="px-6 py-4">
                        <div className={`h-6 w-16 rounded-full ${skeleton}`} />
                      </td>
                      <td className="px-6 py-4">
                        <div className={`h-4 w-8 rounded-lg ${skeleton}`} />
                      </td>
                      <td className="px-6 py-4">
                        <div className={`h-4 w-16 rounded-lg ${skeleton}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
