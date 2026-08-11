import { redirect } from "next/navigation";
import { ink, body } from "@/lib/theme-v2/theme";
import CalendarView, {
  type CalendarEventCreationState,
} from "@/components/calendar/CalendarView";
import BookingRequestsSection, {
  type BookingRequestListItem,
} from "@/components/calendar/BookingRequestsSection";
import GoogleCalendarConnect from "@/components/settings/GoogleCalendarConnect";
import { LockedFeatureCard } from "@/components/entitlements/LockedFeatureCard";
import { canUseFeature } from "@/lib/billing/entitlements";
import { getDashboardEntitledContext } from "@/lib/dashboard/context";
import { requireWorkspacePageAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { getRequestBrand } from "@/lib/branding/requestBrand.server";
import {
  assertBookingOperationallyAllowed,
  isBookingOperationalBlockedError,
  isBookingOperationalStateError,
} from "@/lib/google/bookingOperational.server";
import { isOperationalControlsResolutionError } from "@/lib/account/operationalControls.server";

const BOOKING_REQUEST_LIST_LIMIT = 200;

const BOOKING_REQUEST_SELECT = `
  id,
  conversation_id,
  requested_service,
  requested_time_text,
  customer_name,
  customer_phone,
  customer_email,
  status,
  handled_at,
  created_at,
  contact:contacts!booking_requests_contact_id_fkey (
    name,
    phone_number,
    email
  )
`;

export default async function CalendarPage() {
  await requireWorkspacePageAccess();
  const requestBrand = await getRequestBrand();
  const context = await getDashboardEntitledContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status !== "resolved") redirect("/onboarding");

  const { supabase, business, entitlements } = context;
  if (business.primary_goal === "signup") redirect("/dashboard");

  const planActive = entitlements.active;

  const [
    { data: calendarToken },
    { data: aiSettings },
    bookingRequestListResult,
    bookingRequestCountResult,
  ] = await Promise.all([
    supabase
      .from("google_calendar_tokens")
      .select("google_email")
      .eq("business_id", business.id)
      .single(),
    supabase
      .from("ai_settings")
      .select("booking_enabled,booking_mode")
      .eq("business_id", business.id)
      .single(),
    supabase
      .from("booking_requests")
      .select(BOOKING_REQUEST_SELECT)
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(BOOKING_REQUEST_LIST_LIMIT),
    supabase
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("status", "new"),
  ]);

  const requestListError = bookingRequestListResult.error;
  const requestCountError = bookingRequestCountResult.error;
  const bookingRequests = (bookingRequestListResult.data ?? []) as unknown as
    BookingRequestListItem[];
  const requestCountKnown =
    !requestCountError &&
    typeof bookingRequestCountResult.count === "number";
  const newRequestCount = requestCountKnown
    ? bookingRequestCountResult.count
    : null;
  const collectModeActive =
    aiSettings?.booking_enabled === true &&
    aiSettings.booking_mode === "collect_info";
  const showBookingRequests =
    collectModeActive ||
    bookingRequests.length > 0 ||
    Boolean(requestListError) ||
    !requestCountKnown ||
    (newRequestCount ?? 0) > 0;

  if (requestListError) {
    console.error(
      `[calendar:page] Could not load appointment requests for business=${business.id}:`,
      requestListError
    );
  }
  if (requestCountError) {
    console.error(
      `[calendar:page] Could not count new appointment requests for business=${business.id}:`,
      requestCountError
    );
  }

  const requestSection = showBookingRequests ? (
    <BookingRequestsSection
      initialRequests={requestListError ? [] : bookingRequests}
      initialNewCount={newRequestCount}
      listLoadFailed={Boolean(requestListError)}
      timeZone={business.timezone ?? "UTC"}
    />
  ) : null;

  if (!canUseFeature(entitlements, "calendar")) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className={`text-2xl font-bold ${ink}`}>Calendar</h1>
          <p className={`mt-1 ${body}`}>
            Connect Google Calendar and let your assistant book appointments.
          </p>
        </div>
        {requestSection}
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

  const eventCreationState = await resolveEventCreationState(business.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className={`text-2xl font-bold ${ink}`}>Calendar</h1>
        <p className={`mt-1 ${body}`}>
          View your upcoming appointments and events
        </p>
      </div>
      {requestSection}
      {aiSettings?.booking_enabled && !calendarToken && (
        <div className="rounded-2xl border border-[#ece4d8] bg-white p-5 dark:border-white/[0.10] dark:bg-white/[0.04]">
          <p className="mb-4 text-sm text-stone-600 dark:text-[#bdbdbf]">
            Connect Google Calendar to make direct scheduling available for your assistant.
          </p>
          <GoogleCalendarConnect
            businessId={business.id}
            connectedEmail={null}
            isConnected={false}
            canConnect={true}
          />
        </div>
      )}
      <CalendarView
        isConnected={!!calendarToken}
        googleEmail={calendarToken?.google_email ?? null}
        eventCreationState={eventCreationState}
      />
    </div>
  );
}

async function resolveEventCreationState(
  businessId: string
): Promise<CalendarEventCreationState> {
  try {
    await assertBookingOperationallyAllowed(businessId);
    return "available";
  } catch (error) {
    if (isBookingOperationalBlockedError(error)) return error.reason;
    if (
      isOperationalControlsResolutionError(error) ||
      isBookingOperationalStateError(error)
    ) {
      console.error(
        "[calendar] Booking operational controls lookup failed:",
        error
      );
      return "state_unavailable";
    }
    throw error;
  }
}
