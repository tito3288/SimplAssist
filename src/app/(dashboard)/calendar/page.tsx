import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ink, body } from "@/lib/theme-v2/theme";
import CalendarView from "@/components/calendar/CalendarView";

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

  const { data: calendarToken } = await supabase
    .from("google_calendar_tokens")
    .select("google_email")
    .eq("business_id", business.id)
    .single();

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
