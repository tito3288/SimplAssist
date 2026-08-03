import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  sendSupportTicketEmail: vi.fn(),
  getOptionalWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/email/supportTicket", () => ({
  sendSupportTicketEmail: mocks.sendSupportTicketEmail,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  getOptionalWorkspaceRouteAccess: mocks.getOptionalWorkspaceRouteAccess,
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";

// The route keeps a module-level rate-limit map keyed by IP, so every test
// uses a distinct IP (via the counter) except the dedicated rate-limit test.
let ipCounter = 0;
function request(body: unknown, ip?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("x-forwarded-for", ip ?? `10.0.0.${++ipCounter}`);
  return new NextRequest("http://localhost/api/support", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  category: "billing",
  message: "My invoice looks wrong, can you take a look?",
  name: "Jane Smith",
  email: "jane@example.com",
};

function stubAdmin({
  insertResult = { data: { id: "ticket-1" }, error: null } as {
    data: { id: string } | null;
    error: unknown;
  },
  business = null as { id: string; name: string } | null,
} = {}) {
  const single = vi.fn(async () => insertResult);
  const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  mocks.from.mockImplementation((table: string) => {
    if (table === "businesses") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: business })),
          })),
        })),
      };
    }
    return { insert, update };
  });
  return { insert, update, updateEq };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendSupportTicketEmail.mockResolvedValue(true);
  mocks.getOptionalWorkspaceRouteAccess.mockResolvedValue(null);
});

describe("POST /api/support", () => {
  it("returns 400 on invalid JSON", async () => {
    stubAdmin();
    const res = await POST(request("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("returns 400 with details on a bad category", async () => {
    stubAdmin();
    const res = await POST(request({ ...VALID, category: "nonsense" }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error).toBe("Invalid input");
    expect(payload.details).toBeDefined();
  });

  it("returns 400 when the message is too short", async () => {
    stubAdmin();
    const res = await POST(request({ ...VALID, message: "help" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on an invalid email", async () => {
    stubAdmin();
    const res = await POST(request({ ...VALID, email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("silently accepts honeypot submissions without inserting or emailing", async () => {
    const admin = stubAdmin();
    const res = await POST(request({ ...VALID, website: "https://spam.example" }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(admin.insert).not.toHaveBeenCalled();
    expect(mocks.sendSupportTicketEmail).not.toHaveBeenCalled();
  });

  it("stores a logged-out submission with null identity and emails the owner", async () => {
    const admin = stubAdmin();
    const res = await POST(request(VALID));
    expect(res.status).toBe(200);
    expect(admin.insert).toHaveBeenCalledWith({
      category: "billing",
      message: VALID.message,
      name: VALID.name,
      email: VALID.email,
      user_id: null,
      business_id: null,
    });
    expect(mocks.sendSupportTicketEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "ticket-1",
        category: "billing",
        email: VALID.email,
        userId: null,
        businessId: null,
        businessName: null,
      })
    );
    expect(admin.update).toHaveBeenCalledWith({ notified: true });
  });

  it("derives identity from the session and strips client-sent identity fields", async () => {
    mocks.getOptionalWorkspaceRouteAccess.mockResolvedValue({
      status: "resolved",
      user: { id: USER_ID, email: "owner@example.com" },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    });
    const admin = stubAdmin({
      business: { id: BUSINESS_ID, name: "Manny's Plumbing" },
    });

    const res = await POST(
      request({
        ...VALID,
        // Hostile extra fields — zod strips unknown keys; identity must come
        // from the session, never the payload.
        user_id: "evil-user",
        business_id: "evil-business",
      })
    );

    expect(res.status).toBe(200);
    expect(admin.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        business_id: BUSINESS_ID,
      })
    );
    expect(mocks.sendSupportTicketEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        businessId: BUSINESS_ID,
        businessName: "Manny's Plumbing",
      })
    );
  });

  it("treats every non-resolved workspace as anonymous without reading a business", async () => {
    mocks.getOptionalWorkspaceRouteAccess.mockResolvedValue(null);
    const admin = stubAdmin({
      business: { id: BUSINESS_ID, name: "Wrong Workspace" },
    });

    const res = await POST(request(VALID));

    expect(res.status).toBe(200);
    expect(admin.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null, business_id: null }),
    );
    expect(mocks.from).not.toHaveBeenCalledWith("businesses");
    expect(mocks.sendSupportTicketEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        businessId: null,
        businessName: null,
      }),
    );
  });

  it("returns 500 and skips the email when the insert fails", async () => {
    stubAdmin({ insertResult: { data: null, error: { message: "boom" } } });
    const res = await POST(request(VALID));
    expect(res.status).toBe(500);
    expect(mocks.sendSupportTicketEmail).not.toHaveBeenCalled();
  });

  it("still succeeds when the email fails, without setting notified", async () => {
    mocks.sendSupportTicketEmail.mockResolvedValue(false);
    const admin = stubAdmin();
    const res = await POST(request(VALID));
    expect(res.status).toBe(200);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it("rate limits the fourth rapid request from one IP", async () => {
    stubAdmin();
    const ip = "203.0.113.99";
    for (let i = 0; i < 3; i++) {
      const res = await POST(request(VALID, ip));
      expect(res.status).toBe(200);
    }
    const limited = await POST(request(VALID, ip));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toContain("Too many requests");
  });
});
