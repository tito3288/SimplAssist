import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Contact } from "@/types/database";
import ContactStats from "./ContactStats";

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "contact-1",
    business_id: "business-1",
    name: null,
    phone_number: null,
    email: null,
    session_id: null,
    source_channel: "web_chat",
    lead_score: 0,
    lead_status: "normal",
    lead_status_updated_at: "2026-08-10T12:00:00.000Z",
    notes: null,
    created_at: "2026-07-01T12:00:00.000Z",
    last_contacted_at: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}

function renderedHotLeadCount(contacts: Contact[]): string {
  const markup = renderToStaticMarkup(<ContactStats contacts={contacts} />);
  const match = markup.match(/Hot Leads<\/p><p[^>]*>([^<]+)<\/p>/);
  if (!match) throw new Error("Hot Leads stat was not rendered");
  return match[1];
}

describe("ContactStats", () => {
  it("counts an authoritative hot lead even when its historical score is below seven", () => {
    expect(
      renderedHotLeadCount([
        contact({ lead_status: "hot", lead_score: 0 }),
      ])
    ).toBe("1");
  });

  it("does not count high-scoring contacts whose authoritative tier is not hot", () => {
    expect(
      renderedHotLeadCount([
        contact({ id: "normal", lead_status: "normal", lead_score: 12 }),
        contact({ id: "warm", lead_status: "warm", lead_score: 9 }),
      ])
    ).toBe("0");
  });
});
