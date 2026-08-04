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
  it("preserves disconnect for a saved token whose google_email is null", () => {
    const html = renderToStaticMarkup(
      <AISettingsForm
        settings={SETTINGS}
        businessName="Example Business"
        businessId="business-1"
        calendarEmail={null}
        calendarConnected
        canUseCalendar={false}
      />
    );

    expect(html).toContain("Connected");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect Google Calendar");
  });
});
