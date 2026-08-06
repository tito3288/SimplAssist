import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AISettings } from "@/types/database";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import AISettingsForm from "./AISettingsForm";

const SETTINGS: AISettings = {
  id: "settings-1",
  business_id: "business-1",
  tone: "friendly",
  business_voice: "we",
  language: "en",
  sms_response_delay_seconds: 0,
  guardrails: [],
  booking_enabled: false,
  booking_mode: "collect_info",
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
};

describe("AISettingsForm Google Calendar connection state", () => {
  it("presents booking as a dedicated card with the existing Google Calendar icon", () => {
    const html = renderToStaticMarkup(
      <AISettingsForm
        settings={SETTINGS}
        businessName="Example Business"
        businessId="business-1"
        calendarConnected={false}
        fullSuiteAvailable={false}
      />
    );

    const bookingCard = html.match(
      /<section[^>]*data-booking-card="true"[\s\S]*?<\/section>/
    )?.[0];

    expect(bookingCard).toBeDefined();
    expect(bookingCard).toContain('data-google-calendar-icon="true"');
    expect(bookingCard).toContain('role="img"');
    expect(bookingCard).toContain('aria-label="Google Calendar"');
    expect(bookingCard).toContain(
      "/marketing/technology/google-calendar.svg"
    );
    expect(bookingCard).toContain("Booking");
    expect(bookingCard).toContain("Let your AI handle appointment scheduling.");
    expect(bookingCard).toContain("Enable Appointment Booking");
    expect(bookingCard).toContain('aria-pressed="false"');
    expect(bookingCard).toContain("rounded-[22px]");
    expect(bookingCard).not.toContain("Guardrails");
  });

  it("shows the optional connection in collect-info mode when booking is enabled", () => {
    const html = renderToStaticMarkup(
      <AISettingsForm
        settings={{
          ...SETTINGS,
          booking_enabled: true,
          booking_mode: "collect_info",
        }}
        businessName="Example Business"
        businessId="business-1"
        calendarConnected={false}
        fullSuiteAvailable={false}
      />
    );

    expect(html).toContain("Google Calendar");
    expect(html).toContain(
      "optional — connect to enable direct scheduling"
    );
    expect(html).toContain("Connect Google Calendar");
  });

  it("keeps the current connection presentation in direct mode", () => {
    const html = renderToStaticMarkup(
      <AISettingsForm
        settings={{
          ...SETTINGS,
          booking_enabled: true,
          booking_mode: "schedule_direct",
        }}
        businessName="Example Business"
        businessId="business-1"
        calendarConnected={false}
        fullSuiteAvailable={false}
      />
    );

    expect(html).toContain("Direct scheduling");
    expect(html).toContain("Google Calendar");
    expect(html).toContain("Connect Google Calendar");
    expect(html).not.toContain(
      "optional — connect to enable direct scheduling"
    );
  });

  it("hides the connection when appointment booking is disabled", () => {
    const html = renderToStaticMarkup(
      <AISettingsForm
        settings={SETTINGS}
        businessName="Example Business"
        businessId="business-1"
        calendarConnected={false}
        fullSuiteAvailable={false}
      />
    );

    expect(html).not.toContain("Connect Google Calendar");
    expect(html).not.toContain(
      "optional — connect to enable direct scheduling"
    );
  });

  it("preserves disconnect for a saved token whose google_email is null", () => {
    const html = renderToStaticMarkup(
      <AISettingsForm
        settings={SETTINGS}
        businessName="Example Business"
        businessId="business-1"
        calendarEmail={null}
        calendarConnected
        canUseCalendar={false}
        fullSuiteAvailable={false}
      />
    );

    expect(html).toContain("Connected");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect Google Calendar");
  });
});

describe("AISettingsForm advanced guardrails plan notice", () => {
  function renderNotice({
    fullSuiteAvailable,
    planActive = true,
  }: {
    fullSuiteAvailable: boolean;
    planActive?: boolean;
  }) {
    return renderToStaticMarkup(
      <AISettingsForm
        settings={SETTINGS}
        businessName="Example Business"
        canUseGuardrails={false}
        planActive={planActive}
        fullSuiteAvailable={fullSuiteAvailable}
      />
    );
  }

  it("hides the active lower-tier Full Suite notice while the plan is unavailable", () => {
    const html = renderNotice({ fullSuiteAvailable: false });

    expect(html).not.toContain("Advanced guardrails require the");
    expect(html).not.toContain("Full Suite plan");
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it("restores the exact active lower-tier Full Suite notice when the plan is available", () => {
    const html = renderNotice({ fullSuiteAvailable: true });

    expect(html).toContain("Advanced guardrails require the");
    expect(html).toContain("Full Suite plan");
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it("preserves the neutral inactive-subscription notice while Full Suite is unavailable", () => {
    const html = renderNotice({
      fullSuiteAvailable: false,
      planActive: false,
    });

    expect(html).toContain("Your subscription is inactive. Reactivate it in");
    expect(html).toContain(">Billing</a>");
    expect(html).not.toContain("Full Suite plan");
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });
});
