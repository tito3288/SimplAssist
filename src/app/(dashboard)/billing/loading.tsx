import { card, cardRecommended } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading billing…
      </p>

      <div aria-hidden="true">
        <div className={`h-8 w-24 rounded-xl ${skeleton}`} />
        <div className={`mt-2 h-4 w-56 rounded-lg ${skeleton}`} />

        <section className={`${card} mt-8 p-6`}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <div className={`h-6 w-40 rounded-lg ${skeleton}`} />
              <div className="flex flex-wrap items-center gap-3">
                <div className={`h-6 w-16 rounded-full ${skeleton}`} />
                <div className={`h-4 w-48 rounded-lg ${skeleton}`} />
              </div>
            </div>
            <div className={`h-10 w-44 rounded-full ${skeleton}`} />
          </div>
        </section>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <PricingCardSkeleton />
          <PricingCardSkeleton recommended />
          <PricingCardSkeleton />
        </div>
      </div>
    </div>
  );
}

function PricingCardSkeleton({ recommended = false }: { recommended?: boolean }) {
  return (
    <section
      className={`relative rounded-[28px] p-6 ${recommended ? cardRecommended : card}`}
    >
      {recommended && (
        <div
          className={`absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rounded-full ${skeleton}`}
        />
      )}
      <div className={`h-6 w-28 rounded-lg ${skeleton}`} />
      <div className={`mt-3 h-9 w-24 rounded-xl ${skeleton}`} />
      <div className="mt-6 space-y-4">
        <FeatureSkeleton width="w-full" />
        <FeatureSkeleton width="w-11/12" />
        <FeatureSkeleton width="w-4/5" />
        <FeatureSkeleton width="w-5/6" />
      </div>
      <div className={`mt-7 h-10 w-full rounded-full ${skeleton}`} />
    </section>
  );
}

function FeatureSkeleton({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-4 w-4 shrink-0 rounded-full ${skeleton}`} />
      <div className={`h-4 ${width} rounded-lg ${skeleton}`} />
    </div>
  );
}
