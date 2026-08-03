import { redirect } from "next/navigation";
import { ink, body } from "@/lib/theme-v2/theme";
import CalendarView from "@/components/calendar/CalendarView";
import GoogleCalendarConnect from "@/components/settings/GoogleCalendarConnect";
import { LockedFeatureCard } from "@/components/entitlements/LockedFeatureCard";
import { canUseFeature } from "@/lib/billing/entitlements";
import { getDashboardEntitledContext } from "@/lib/dashboard/context";
import { requireWorkspacePageAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { getRequestBrand } from "@/lib/branding/requestBrand.server";

export default async function CalendarPage() {
  const workspace = await requireWorkspacePageAccess();
  const requestBrand = await getRequestBrand();
  const context = await getDashboardEntitledContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status !== "resolved") redirect("/onboarding");

  const { supabase, business, entitlements } = context;
  const planActive = entitlements.active;

  const { data: calendarToken } = await supabase
    .from("google_calendar_tokens")
    .select("google_email")
    .eq("business_id", business.id)
    .single();

  if (!canUseFeature(entitlements, "calendar")) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className={`text-2xl font-bold ${ink}`}>Calendar</h1>
          <p className={`mt-1 ${body}`}>
            Connect Google Calendar and let your assistant book appointments.
          </p>
        </div>
        <LockedFeatureCard
          title={planActive ? "Google Calendar is available on Growth" : "Google Calendar is paused"}
          description={
            planActive
              ? `Upgrade to view Google Calendar events in ${requestBrand.brand.name} and let your AI check availability and book appointments.`
              : "Reactivate your subscription to view events and use your saved Calendar connection."
          }
          requiredPlan={planActive ? "Growth" : null}
          preservedDetail="Your saved connection is not deleted when this feature is paused."
        />
        {calendarToken && (
          <div className="rounded-2xl border border-[#ece4d8] bg-white p-5 dark:border-white/[0.10] dark:bg-white/[0.04]">
            <p className="mb-3 text-sm text-stone-600 dark:text-[#bdbdbf]">
              You can disconnect the saved Google account at any time.
            </p>
            <GoogleCalendarConnect
              businessId={business.id}
              connectedEmail={calendarToken.google_email ?? null}
              isConnected
              canConnect={false}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={`text-2xl font-bold ${ink}`}>Calendar</h1>
        <p className={`mt-1 ${body}`}>
          View your upcoming appointments and events
        </p>
      </div>
      <CalendarView
        isConnected={!!calendarToken}
        googleEmail={calendarToken?.google_email ?? null}
        oauthConnectSupported={workspace.hostKind === "canonical"}
      />
    </div>
  );
}
