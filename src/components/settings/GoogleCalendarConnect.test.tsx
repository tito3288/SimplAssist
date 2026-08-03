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

  it("renders the canonical-host OAuth connect control", () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarConnect
        businessId="business-1"
        connectedEmail={null}
        oauthConnectSupported
      />
    );

    expect(html).toContain("Connect Google Calendar");
    expect(html).not.toContain("not available on this partner workspace");
  });

  it("removes connect and reconnect controls on a partner host", () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarConnect
        businessId="business-1"
        connectedEmail={null}
        oauthConnectSupported={false}
      />
    );

    expect(html).toContain("not available on this partner workspace");
    expect(html).not.toContain("Connect Google Calendar");
  });

  it("keeps existing partner-host connection data and disconnect available", () => {
    const html = renderToStaticMarkup(
      <GoogleCalendarConnect
        businessId="business-1"
        connectedEmail={null}
        isConnected
        oauthConnectSupported={false}
      />
    );

    expect(html).toContain("Connected");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect Google Calendar");
  });
});
