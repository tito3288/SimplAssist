import { card, tile } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export function AdminLoadingSkeleton({ status }: { status: string }) {
  return (
    <main className="space-y-6" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <div className="space-y-6" aria-hidden="true">
        <div className={`h-8 w-20 rounded-full ${skeleton}`} />

        <section className="space-y-2">
          <div className={`h-8 w-56 rounded-xl ${skeleton}`} />
          <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
        </section>

        <section className={`${card} p-5 sm:p-6`}>
          <div className={`h-6 w-36 rounded-lg ${skeleton}`} />
          <div className={`mt-2 h-4 w-80 max-w-full rounded-lg ${skeleton}`} />
          <div className="mt-5 flex flex-wrap gap-2">
            <div className={`h-7 w-24 rounded-full ${skeleton}`} />
            <div className={`h-7 w-28 rounded-full ${skeleton}`} />
            <div className={`h-7 w-20 rounded-full ${skeleton}`} />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <SkeletonTile />
            <SkeletonTile />
          </div>
        </section>

        <section className={`${card} p-5 sm:p-6`}>
          <div className={`h-6 w-40 rounded-lg ${skeleton}`} />
          <div className={`mt-2 h-4 w-96 max-w-full rounded-lg ${skeleton}`} />
          <div className="mt-5 flex flex-wrap gap-2">
            <div className={`h-7 w-12 rounded-full ${skeleton}`} />
            <div className={`h-7 w-20 rounded-full ${skeleton}`} />
            <div className={`h-7 w-28 rounded-full ${skeleton}`} />
          </div>
          <div className="mt-5 space-y-4">
            <div className={`h-4 w-48 rounded-lg ${skeleton}`} />
            <div className={`h-4 w-64 max-w-full rounded-lg ${skeleton}`} />
          </div>
        </section>
      </div>
    </main>
  );
}

function SkeletonTile() {
  return (
    <div className={`${tile} space-y-3 p-4`}>
      <div className={`h-4 w-28 rounded-lg ${skeleton}`} />
      <div className={`h-3 w-full rounded-lg ${skeleton}`} />
      <div className={`h-3 w-5/6 rounded-lg ${skeleton}`} />
      <div className={`h-3 w-2/3 rounded-lg ${skeleton}`} />
    </div>
  );
}
