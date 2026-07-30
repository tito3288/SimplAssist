import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { card } from "@/lib/theme-v2/theme";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Unsubscribed | SimplAssist",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function WaitlistUnsubscribedPage({
  searchParams,
}: {
  searchParams?: { preview?: string | string[] };
}) {
  noStore();
  const preview = searchParams?.preview === "1";

  return (
    <main className="min-h-screen bg-[#faf7f2] px-4 py-16 text-stone-900 dark:bg-[#11100f] dark:text-[#f5f5f5] sm:py-24">
      <div className={`mx-auto max-w-lg p-7 sm:p-9 ${card}`}>
        <h1 className="text-2xl font-bold tracking-[-0.025em]">
          {preview ? "Unsubscribe preview" : "You’ve been unsubscribed"}
        </h1>
        <p className="mt-4 leading-7 text-stone-600 dark:text-[#bdbdbf]">
          {preview
            ? "This is the test-only unsubscribe confirmation. No waitlist preferences were changed."
            : "You will not receive Full Suite waitlist or launch emails from us."}
        </p>
        <Link
          href="/home"
          className="mt-7 inline-block text-sm font-medium text-[#c2410c] underline underline-offset-4 dark:text-[#ff914d]"
        >
          Return to SimplAssist
        </Link>
      </div>
    </main>
  );
}
