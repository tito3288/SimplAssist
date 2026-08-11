import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Contact } from "@/types/database";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({ from: vi.fn() }),
}));

import ContactDetail from "./ContactDetail";

type LeadStatus = Contact["lead_status"];

function contact(status: LeadStatus, score: number): Contact {
  return {
    id: `contact-${status}`,
    business_id: "business-1",
    name: `${status} contact`,
    phone_number: null,
    email: null,
    session_id: null,
    source_channel: "web_chat",
    lead_score: score,
    lead_status: status,
    lead_status_updated_at: "2026-08-10T12:00:00.000Z",
    notes: null,
    created_at: "2026-08-01T12:00:00.000Z",
    last_contacted_at: "2026-08-10T12:00:00.000Z",
  };
}

function renderDetail(status: LeadStatus, score: number): string {
  return renderToStaticMarkup(
    <ContactDetail
      contact={contact(status, score)}
      conversations={[]}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
      onDeleted={vi.fn()}
    />
  );
}

describe("ContactDetail canonical lead status", () => {
  it.each([
    ["normal", "Normal", 987654],
    ["warm", "Warm", 876543],
    ["hot", "Hot", 765432],
  ] as const)("renders %s as exact label %s", (status, label, score) => {
    const html = renderDetail(status, score);

    expect(html).toContain("Lead status");
    expect(html).toContain(`>${label}</span>`);
    expect(html).not.toContain("Lead Score");
    expect(html).not.toContain("Cold");
    expect(html).not.toContain(String(score));
  });

  it("uses canonical Hot when a historical zero score disagrees", () => {
    const html = renderDetail("hot", 0);

    expect(html).toContain(">Hot</span>");
    expect(html).not.toContain("Cold");
    expect(html).not.toContain("Hot (0)");
  });
});
