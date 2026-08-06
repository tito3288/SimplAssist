import { card, tile } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading widget settings…
      </p>

      <div className="space-y-6" aria-hidden="true">
        <div className="space-y-2">
          <div className={`h-8 w-64 max-w-full rounded-xl ${skeleton}`} />
          <div className={`h-4 w-96 max-w-full rounded-lg ${skeleton}`} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className={`${card} space-y-6 p-6 lg:col-span-3`}>
            <div className="space-y-2">
              <div className={`h-6 w-44 rounded-lg ${skeleton}`} />
              <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <WidgetFieldSkeleton />
              <WidgetFieldSkeleton />
            </div>
            <WidgetFieldSkeleton />
            <div className={`${tile} space-y-4 p-4`}>
              <div className={`h-4 w-32 rounded-lg ${skeleton}`} />
              <div className={`h-16 w-full rounded-xl ${skeleton}`} />
              <div className="flex gap-3">
                <div className={`h-8 w-24 rounded-full ${skeleton}`} />
                <div className={`h-8 w-28 rounded-full ${skeleton}`} />
              </div>
            </div>
            <div className={`h-10 w-32 rounded-full ${skeleton}`} />
          </section>

          <div className="space-y-6 lg:col-span-2">
            <section className={`${card} space-y-4 p-6`}>
              <div className={`h-6 w-24 rounded-lg ${skeleton}`} />
              <div className={`${tile} h-72 p-5`}>
                <div className="flex h-full flex-col justify-end gap-3">
                  <div className={`h-9 w-4/5 self-end rounded-2xl ${skeleton}`} />
                  <div className={`h-12 w-5/6 rounded-2xl ${skeleton}`} />
                  <div className={`h-10 w-full rounded-full ${skeleton}`} />
                </div>
              </div>
            </section>

            <section className={`${card} space-y-4 p-6`}>
              <div className={`h-6 w-32 rounded-lg ${skeleton}`} />
              <div className={`h-4 w-full rounded-lg ${skeleton}`} />
              <div className={`${tile} space-y-2 p-4`}>
                <div className={`h-3 w-full rounded-lg ${skeleton}`} />
                <div className={`h-3 w-11/12 rounded-lg ${skeleton}`} />
                <div className={`h-3 w-2/3 rounded-lg ${skeleton}`} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function WidgetFieldSkeleton() {
  return (
    <div className="space-y-2">
      <div className={`h-4 w-28 rounded-lg ${skeleton}`} />
      <div className={`h-11 w-full rounded-xl ${skeleton}`} />
    </div>
  );
}
