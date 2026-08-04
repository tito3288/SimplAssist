import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import GoogleCalendarConnect from "./GoogleCalendarConnect";

describe("GoogleCalendarConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the OAuth connect control for every resolved workspace", () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarConnect
        businessId="business-1"
        connectedEmail={null}
      />
    );

    expect(html).toContain("Connect Google Calendar");
  });

  it("keeps existing connection data and disconnect available", () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarConnect
        businessId="business-1"
        connectedEmail={null}
        isConnected
      />
    );

    expect(html).toContain("Connected");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect Google Calendar");
  });
});
