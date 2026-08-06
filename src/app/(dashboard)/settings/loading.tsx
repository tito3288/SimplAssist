import { card, tile } from "@/lib/theme-v2/theme";

const skeleton =
  "animate-pulse bg-[#eee7dc] dark:bg-white/[0.10] motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading settings…
      </p>

      <div className="space-y-8" aria-hidden="true">
        <div className="space-y-2">
          <div className={`h-8 w-32 rounded-xl ${skeleton}`} />
          <div className={`h-4 w-80 max-w-full rounded-lg ${skeleton}`} />
        </div>

        <SettingsFormBlock fields={1} />
        <SettingsFormBlock fields={1} />
        <SettingsFormBlock fields={3} />

        <section className={`${card} space-y-7 p-6`}>
          <div className="space-y-2">
            <div className={`h-6 w-36 rounded-lg ${skeleton}`} />
            <div className={`h-4 w-72 max-w-full rounded-lg ${skeleton}`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${tile} h-20 p-4`}>
              <div className={`h-4 w-20 rounded-lg ${skeleton}`} />
              <div className={`mt-3 h-3 w-full rounded-lg ${skeleton}`} />
            </div>
            <div className={`${tile} h-20 p-4`}>
              <div className={`h-4 w-24 rounded-lg ${skeleton}`} />
              <div className={`mt-3 h-3 w-5/6 rounded-lg ${skeleton}`} />
            </div>
            <div className={`${tile} h-20 p-4`}>
              <div className={`h-4 w-16 rounded-lg ${skeleton}`} />
              <div className={`mt-3 h-3 w-4/5 rounded-lg ${skeleton}`} />
            </div>
          </div>
          <div className="space-y-5">
            <FormFieldSkeleton />
            <FormFieldSkeleton />
            <FormFieldSkeleton />
          </div>
        </section>

        <section className={`${card} space-y-5 p-6`}>
          <div className="space-y-2">
            <div className={`h-6 w-28 rounded-lg ${skeleton}`} />
            <div className={`h-4 w-96 max-w-full rounded-lg ${skeleton}`} />
          </div>
          <div className="space-y-3">
            <div className={`${tile} flex items-center gap-4 p-4`}>
              <div className={`h-10 w-10 shrink-0 rounded-full ${skeleton}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-4 w-40 rounded-lg ${skeleton}`} />
                <div className={`h-3 w-64 max-w-full rounded-lg ${skeleton}`} />
              </div>
            </div>
            <div className={`${tile} flex items-center gap-4 p-4`}>
              <div className={`h-10 w-10 shrink-0 rounded-full ${skeleton}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-4 w-48 rounded-lg ${skeleton}`} />
                <div className={`h-3 w-56 max-w-full rounded-lg ${skeleton}`} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsFormBlock({ fields }: { fields: number }) {
  return (
    <section className={`${card} space-y-5 p-6`}>
      <div className="space-y-2">
        <div className={`h-6 w-36 rounded-lg ${skeleton}`} />
        <div className={`h-4 w-80 max-w-full rounded-lg ${skeleton}`} />
      </div>
      <div className="space-y-5">
        {Array.from({ length: fields }, (_, index) => (
          <FormFieldSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

function FormFieldSkeleton() {
  return (
    <div className="space-y-2">
      <div className={`h-4 w-24 rounded-lg ${skeleton}`} />
      <div className={`h-11 w-full rounded-xl ${skeleton}`} />
    </div>
  );
}
