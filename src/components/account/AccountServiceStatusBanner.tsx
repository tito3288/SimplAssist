import { AlertTriangle } from "lucide-react";
import { statusWarning } from "@/lib/theme-v2/theme";

export interface AccountServiceStatusBannerProps {
  operationsSuspendedAt: string | null;
  aiRepliesPausedAt: string | null;
  textingPausedAt: string | null;
  bookingsPausedAt: string | null;
}

const INDEPENDENT_SERVICES = [
  ["AI replies", "aiRepliesPausedAt"],
  ["texting", "textingPausedAt"],
  ["bookings", "bookingsPausedAt"],
] as const;

export function AccountServiceStatusBanner({
  operationsSuspendedAt,
  aiRepliesPausedAt,
  textingPausedAt,
  bookingsPausedAt,
}: AccountServiceStatusBannerProps) {
  const controls = {
    aiRepliesPausedAt,
    textingPausedAt,
    bookingsPausedAt,
  };
  const independentlyPausedServices = INDEPENDENT_SERVICES.flatMap(
    ([label, timestampKey]) => (controls[timestampKey] === null ? [] : [label]),
  );

  if (
    operationsSuspendedAt === null &&
    independentlyPausedServices.length === 0
  ) {
    return null;
  }

  const suspended = operationsSuspendedAt !== null;

  return (
    <section
      aria-labelledby="account-service-status-title"
      className={`mb-5 rounded-2xl p-4 ${statusWarning}`}
      role="status"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <div className="min-w-0">
          <h2
            className="text-sm font-semibold"
            id="account-service-status-title"
          >
            {suspended
              ? "Account services are suspended"
              : "Some account services are paused"}
          </h2>

          {suspended ? (
            <>
              <p className="mt-1 text-sm leading-relaxed">
                Your dashboard remains available and your stored data is
                preserved. AI replies, texting, new bookings, call forwarding,
                and missed-call texts are paused.
              </p>
              {independentlyPausedServices.length > 0 ? (
                <p className="mt-2 text-sm leading-relaxed">
                  After reactivation, {formatList(independentlyPausedServices)}{" "}
                  will remain paused until an administrator resumes each
                  service.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-sm leading-relaxed">
              The following services are paused:{" "}
              {formatList(independentlyPausedServices)}. All other account
              services remain available.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function formatList(items: readonly string[]): string {
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
