import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { verifyWaitlistUnsubscribeToken } from "@/lib/waitlist/unsubscribeToken";
import { card } from "@/lib/theme-v2/theme";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Unsubscribe from Full Suite updates | SimplAssist",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface UnsubscribePageProps {
  searchParams?: {
    token?: string | string[];
  };
}

export default function WaitlistUnsubscribePage({
  searchParams,
}: UnsubscribePageProps) {
  noStore();

  const token =
    typeof searchParams?.token === "string" ? searchParams.token : "";
  let isValid = false;

  if (token) {
    try {
      isValid = Boolean(verifyWaitlistUnsubscribeToken(token));
    } catch {
      console.error("[waitlist:unsubscribe] confirmation unavailable");
    }
  }

  return (
    <main className="min-h-screen bg-[#faf7f2] px-4 py-16 text-stone-900 dark:bg-[#11100f] dark:text-[#f5f5f5] sm:py-24">
      <div className={`mx-auto max-w-lg p-7 sm:p-9 ${card}`}>
        {isValid ? (
          <>
            <h1 className="text-2xl font-bold tracking-[-0.025em]">
              Unsubscribe from Full Suite updates?
            </h1>
            <p className="mt-4 leading-7 text-stone-600 dark:text-[#bdbdbf]">
              Confirm below and we will stop sending Full Suite waitlist and
              launch emails to this address.
            </p>
            <form
              action="/api/waitlist/unsubscribe"
              method="post"
              className="mt-7"
            >
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-full bg-[#ea580c] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#c2410c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/60 focus-visible:ring-offset-2 dark:bg-[#ff914d] dark:text-[#16100b] dark:hover:bg-[#f57f33] dark:focus-visible:ring-[#ff914d]/60 dark:focus-visible:ring-offset-[#11100f]"
              >
                Confirm unsubscribe
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-[-0.025em]">
              This unsubscribe link is not valid
            </h1>
            <p className="mt-4 leading-7 text-stone-600 dark:text-[#bdbdbf]">
              The link may be incomplete. No waitlist preferences were
              changed.
            </p>
          </>
        )}

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
