import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  body,
  bodyFaint,
  card,
  ink,
  statusNeutral,
  statusSuccess,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";
import {
  WaitlistLaunchControls,
  WaitlistSingleSendButton,
} from "./WaitlistSendControls";
import {
  waitlistClaimIndicator,
  waitlistStatus,
  type WaitlistRow,
  type WaitlistStatus,
} from "./waitlistView";
import { AdminBackLink } from "../AdminBackLink";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function assertQuerySucceeded(
  results: Array<{ error: { message?: string } | null }>
): void {
  if (results.some((result) => result.error)) {
    throw new Error("Could not load the Full Suite waitlist.");
  }
}

async function failClosed<T>(operation: PromiseLike<T>): Promise<T> {
  try {
    return await operation;
  } catch {
    throw new Error("Could not load the Full Suite waitlist.");
  }
}

function exactCount(result: {
  count: number | null;
  error: { message?: string } | null;
}): number {
  if (result.error || typeof result.count !== "number") {
    throw new Error("Could not load the Full Suite waitlist.");
  }
  return result.count;
}

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams?: { page?: string | string[] };
}) {
  const admin = await requireAdminUser();
  const cutoff = new Date().toISOString();

  const totalQuery = supabaseAdmin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true })
    .lte("created_at", cutoff);
  const pendingQuery = supabaseAdmin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true })
    .lte("created_at", cutoff)
    .is("notified_at", null)
    .is("unsubscribed_at", null);
  const notifiedQuery = supabaseAdmin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true })
    .lte("created_at", cutoff)
    .not("notified_at", "is", null)
    .is("unsubscribed_at", null);
  const unsubscribedQuery = supabaseAdmin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true })
    .lte("created_at", cutoff)
    .not("unsubscribed_at", "is", null);
  const pendingRecipientQuery = supabaseAdmin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true })
    .lte("created_at", cutoff)
    .is("notified_at", null)
    .is("unsubscribed_at", null)
    .is("launch_send_claim_token", null);

  const countResults = await failClosed(
    Promise.all([
      totalQuery,
      pendingQuery,
      notifiedQuery,
      unsubscribedQuery,
      pendingRecipientQuery,
    ])
  );
  assertQuerySucceeded(countResults);

  const [
    totalResult,
    pendingResult,
    notifiedResult,
    unsubscribedResult,
    pendingRecipientResult,
  ] = countResults;
  const total = exactCount(totalResult);
  const pending = exactCount(pendingResult);
  const notified = exactCount(notifiedResult);
  const unsubscribed = exactCount(unsubscribedResult);
  const pendingRecipientCount = exactCount(pendingRecipientResult);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = parsePage(searchParams?.page);
  const currentPage = Math.min(requestedPage, totalPages);
  const firstRow = (currentPage - 1) * PAGE_SIZE;

  const rowsResult = await failClosed(
    supabaseAdmin
      .from("waitlist_signups")
      .select(
        "id, email, created_at, notified_at, unsubscribed_at, launch_send_claimed_at"
      )
      .lte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(firstRow, firstRow + PAGE_SIZE - 1)
      .returns<WaitlistRow[]>()
  );

  assertQuerySucceeded([rowsResult]);
  const rows = rowsResult.data ?? [];
  const nowMs = Date.now();

  return (
    <main className="space-y-6">
      <AdminBackLink />

      <section>
        <h1 className={`text-2xl font-bold ${ink}`}>Full Suite waitlist</h1>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Review signups and send the manually approved launch announcement.
        </p>
      </section>

      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Waitlist totals"
      >
        <Metric label="Total" value={total} />
        <Metric label="Pending" value={pending} />
        <Metric label="Notified" value={notified} />
        <Metric label="Unsubscribed" value={unsubscribed} />
      </section>

      <section className={`p-5 sm:p-6 ${card}`}>
        <p className={`mb-5 text-sm ${body}`}>
          <strong>Before sending:</strong> follow{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs dark:bg-white/[0.08]">
            docs/full-suite-waitlist-delivery-review.md
          </code>{" "}
          and verify Railway has exactly one active replica.
        </p>
        <WaitlistLaunchControls
          adminEmailAvailable={Boolean(admin.email)}
          pendingRecipientCount={pendingRecipientCount}
          cutoff={cutoff}
        />
      </section>

      <section className={`overflow-hidden ${card}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#ece4d8] px-5 py-4 dark:border-white/[0.10]">
          <div>
            <h2 className={`font-semibold ${ink}`}>Signups</h2>
            <p className={`mt-1 text-xs ${bodyFaint}`}>
              Newest first · 100 per page
            </p>
          </div>
          <p className={`text-sm ${body}`}>
            Page {currentPage.toLocaleString()} of{" "}
            {totalPages.toLocaleString()}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className={`px-5 py-8 text-sm ${body}`}>
            No waitlist signups yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-[#faf7f2] text-xs uppercase tracking-wide text-stone-500 dark:bg-white/[0.04] dark:text-[#bdbdbf]">
                <tr>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Signup date</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Notified date</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = waitlistStatus(row);
                  const claimIndicator = waitlistClaimIndicator(row, nowMs);

                  return (
                    <tr
                      key={row.id}
                      className="border-t border-[#f0e9de] align-top first:border-t-0 dark:border-white/[0.08]"
                    >
                      <td className={`px-5 py-4 font-medium ${ink}`}>
                        <span className="select-all">{row.email}</span>
                      </td>
                      <td className={`whitespace-nowrap px-5 py-4 ${body}`}>
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={status} />
                        {claimIndicator && (
                          <p
                            className={`mt-1.5 text-xs font-medium ${
                              claimIndicator === "Delivery review needed"
                                ? "text-amber-700 dark:text-amber-300"
                                : bodyFaint
                            }`}
                          >
                            {claimIndicator}
                          </p>
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-5 py-4 ${body}`}>
                        {formatDate(row.notified_at)}
                      </td>
                      <td className="px-5 py-4">
                        {status === "Pending" && !claimIndicator ? (
                          <WaitlistSingleSendButton signupId={row.id} />
                        ) : (
                          <span className={`text-xs ${bodyFaint}`}>
                            {claimIndicator ?? "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <nav
          className="flex items-center justify-between border-t border-[#ece4d8] px-5 py-4 dark:border-white/[0.10]"
          aria-label="Waitlist pagination"
        >
          {currentPage > 1 ? (
            <Link
              href={`/admin/waitlist?page=${currentPage - 1}`}
              className="text-sm font-medium text-[#c2410c] hover:underline dark:text-[#ff914d]"
            >
              Previous
            </Link>
          ) : (
            <span className={`text-sm ${bodyFaint}`}>Previous</span>
          )}
          {currentPage < totalPages ? (
            <Link
              href={`/admin/waitlist?page=${currentPage + 1}`}
              className="text-sm font-medium text-[#c2410c] hover:underline dark:text-[#ff914d]"
            >
              Next
            </Link>
          ) : (
            <span className={`text-sm ${bodyFaint}`}>Next</span>
          )}
        </nav>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={`p-4 ${tile}`}>
      <p className={`text-sm ${bodyFaint}`}>{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${ink}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: WaitlistStatus }) {
  const tone =
    status === "Unsubscribed"
      ? statusNeutral
      : status === "Notified"
        ? statusSuccess
        : statusWarning;

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {status}
    </span>
  );
}
