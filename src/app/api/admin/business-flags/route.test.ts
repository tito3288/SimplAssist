import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ update: mocks.update })),
  },
}));

import { POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";
const ADMIN_ID = "00000000-0000-4000-8000-000000000999";

const validBody = {
  businessId: BUSINESS_ID,
  billing_pilot: false,
  billing_comped: false,
  billing_exempt: true,
  telnyx_submission_disabled: true,
  sms_overage_opt_in: false,
  billing_admin_notes: "internal placeholder",
};

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/business-flags", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ select: mocks.select });
  mocks.select.mockResolvedValue({ data: [{ id: BUSINESS_ID }], error: null });
});

describe("POST /api/admin/business-flags", () => {
  it("returns 404 for non-admins without touching the database", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the business id matches zero rows", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
    mocks.select.mockResolvedValue({ data: [], error: null });
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Business not found",
    });
  });

  it("stamps attribution from the session-derived admin id, never the payload", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
    const response = await POST(
      makeRequest({ ...validBody, sms_overage_opt_in: true })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });

    const written = mocks.update.mock.calls[0][0];
    expect(written.billing_flags_updated_by).toBe(ADMIN_ID);
    expect(written.sms_overage_opted_in_by).toBe(ADMIN_ID);
    expect(mocks.eq).toHaveBeenCalledWith("id", BUSINESS_ID);
    expect(mocks.select).toHaveBeenCalledWith("id");
  });

  it("strips payload-supplied attribution and unknown columns (mass-assignment guard)", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
    const response = await POST(
      makeRequest({
        ...validBody,
        billing_flags_updated_by: "attacker-id",
        sms_overage_opted_in_by: "attacker-id",
        slug: "hijacked-slug",
        stripe_customer_id: "cus_attacker",
      })
    );
    expect(response.status).toBe(200);

    const written = mocks.update.mock.calls[0][0];
    expect(written.billing_flags_updated_by).toBe(ADMIN_ID);
    expect(written.sms_overage_opted_in_by).toBeNull();
    expect(written).not.toHaveProperty("slug");
    expect(written).not.toHaveProperty("stripe_customer_id");
  });

  it("clears overage attribution when opt-in is false", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
    await POST(makeRequest(validBody));
    const written = mocks.update.mock.calls[0][0];
    expect(written.sms_overage_opted_in_at).toBeNull();
    expect(written.sms_overage_opted_in_by).toBeNull();
  });

  it("rejects an invalid payload with 400 before any write", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
    const response = await POST(
      makeRequest({ businessId: "not-a-uuid", billing_pilot: false })
    );
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns 500 when the database write fails", async () => {
    mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
    mocks.select.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(500);
  });
});
