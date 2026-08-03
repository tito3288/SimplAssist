import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  isCanonicalAdminHostname: vi.fn(),
  approve: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
  isCanonicalAdminHostname: mocks.isCanonicalAdminHostname,
}));

vi.mock("@/lib/admin/a2pRiskReview", () => ({
  approveA2pRiskReview: mocks.approve,
}));

import { POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";
const TOKEN = "review-token-secret-value";

const validBody = {
  businessId: BUSINESS_ID,
  note: "manual review completed",
  acknowledgeFeeRisk: true,
};

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/admin/a2p-risk-review", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "localhost", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("A2P_REVIEW_ADMIN_TOKEN", TOKEN);
  mocks.isCanonicalAdminHostname.mockReturnValue(true);
  mocks.approve.mockResolvedValue({ status: "admin_approved", inputHash: "h" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/a2p-risk-review", () => {
  it("404s a token-authorized request on a noncanonical Host before approval", async () => {
    mocks.isCanonicalAdminHostname.mockReturnValue(false);

    const response = await POST(
      makeRequest(validBody, { authorization: `Bearer ${TOKEN}` })
    );

    expect(response.status).toBe(404);
    expect(mocks.isCanonicalAdminHostname).toHaveBeenCalledWith("localhost");
    expect(mocks.getAdminUser).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("authorizes a valid Bearer token without consulting the admin session", async () => {
    const response = await POST(
      makeRequest(validBody, { authorization: `Bearer ${TOKEN}` })
    );
    expect(response.status).toBe(200);
    expect(mocks.getAdminUser).not.toHaveBeenCalled();
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedBy: "token_admin" })
    );
  });

  it("strips the Bearer prefix case-insensitively", async () => {
    const response = await POST(
      makeRequest(validBody, { authorization: `bearer ${TOKEN}` })
    );
    expect(response.status).toBe(200);
  });

  it("authorizes via the x-a2p-review-admin-token header", async () => {
    const response = await POST(
      makeRequest(validBody, { "x-a2p-review-admin-token": TOKEN })
    );
    expect(response.status).toBe(200);
    expect(mocks.getAdminUser).not.toHaveBeenCalled();
  });

  it("falls back to the admin session when the token is invalid", async () => {
    mocks.getAdminUser.mockResolvedValue({
      id: "admin-id",
      email: "admin@simplassist.test",
    });
    const response = await POST(
      makeRequest(validBody, { authorization: "Bearer wrong-token" })
    );
    expect(response.status).toBe(200);
    expect(mocks.getAdminUser).toHaveBeenCalledOnce();
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedBy: "admin@simplassist.test" })
    );
  });

  it("404s with no valid token and no admin session, without approving", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(404);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("fails closed when the token env is unset — even a matching empty header never token-authorizes", async () => {
    vi.stubEnv("A2P_REVIEW_ADMIN_TOKEN", "");
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await POST(
      makeRequest(validBody, { authorization: "Bearer " })
    );
    expect(response.status).toBe(404);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
