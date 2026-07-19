import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ink, body } from "@/lib/theme-v2/theme";
import CalendarView from "@/components/calendar/CalendarView";
import GoogleCalendarConnect from "@/components/settings/GoogleCalendarConnect";
import { LockedFeatureCard } from "@/components/entitlements/LockedFeatureCard";
import { canUseFeature, resolveBusinessEntitlements } from "@/lib/billing/entitlements";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) redirect("/onboarding");

  const entitlements = await resolveBusinessEntitlements(business.id);
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
              ? "Upgrade to view Google Calendar events in SimplAssist and let your AI check availability and book appointments."
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
      />
    </div>
  );
}
