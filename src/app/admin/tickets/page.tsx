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
  supportCategoryLabel,
  type SupportCategory,
} from "@/lib/support/constants";
import { AdminBackLink } from "../AdminBackLink";

export const dynamic = "force-dynamic";

/**
 * Support tickets submitted from /support. The durable archive: the owner
 * notification email is fire-and-forget, so rows with notified=false only
 * exist here — flagged loudly below.
 */

type SupportRequestRow = {
  id: string;
  created_at: string;
  category: SupportCategory;
  message: string;
  name: string;
  email: string;
  user_id: string | null;
  business_id: string | null;
  status: "new" | "in_progress" | "closed";
  notified: boolean;
};

const STATUS_TONES: Record<SupportRequestRow["status"], string> = {
  new: statusWarning,
  in_progress: statusNeutral,
  closed: statusSuccess,
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function AdminTicketsPage() {
  await requireAdminUser();

  const { data: tickets } = await supabaseAdmin
    .from("support_requests")
    .select(
      "id, created_at, category, message, name, email, user_id, business_id, status, notified"
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<SupportRequestRow[]>();

  const businessIds = Array.from(
    new Set((tickets ?? []).flatMap((t) => (t.business_id ? [t.business_id] : [])))
  );
  const { data: businesses } =
    businessIds.length > 0
      ? await supabaseAdmin
          .from("businesses")
          .select("id, name")
          .in("id", businessIds)
          .returns<{ id: string; name: string }[]>()
      : { data: [] as { id: string; name: string }[] };

  const businessNameById = new Map(
    (businesses ?? []).map((business) => [business.id, business.name])
  );

  return (
    <main className="space-y-6">
      <AdminBackLink />
      <div className={`p-6 ${card}`}>
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <h1 className={`text-xl font-semibold ${ink}`}>Support tickets</h1>
          <p className={`text-xs ${bodyFaint}`}>Latest 100</p>
        </div>

        {(tickets ?? []).length === 0 ? (
          <p className={`text-sm ${body}`}>No tickets yet.</p>
        ) : (
          <div className="space-y-4">
            {(tickets ?? []).map((ticket) => (
              <div key={ticket.id} className={`p-4 ${tile}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[ticket.status]}`}
                  >
                    {ticket.status.replace("_", " ")}
                  </span>
                  <span className={`text-sm font-semibold ${ink}`}>
                    {supportCategoryLabel(ticket.category)}
                  </span>
                  <span className={`text-xs ${bodyFaint}`}>
                    {formatDate(ticket.created_at)}
                  </span>
                </div>

                <p className={`mt-2 text-sm ${body}`}>
                  <span className={`font-medium ${ink}`}>{ticket.name}</span>{" "}
                  <span className="select-all">&lt;{ticket.email}&gt;</span>
                  {ticket.business_id && (
                    <>
                      {" · "}
                      {businessNameById.get(ticket.business_id) ??
                        ticket.business_id}
                    </>
                  )}
                  {!ticket.user_id && " · logged out"}
                </p>

                <p className={`mt-3 whitespace-pre-wrap text-sm ${ink}`}>
                  {ticket.message}
                </p>

                {!ticket.notified && (
                  <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">
                    Email notification failed — this ticket only exists here.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
