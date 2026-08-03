import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  from: vi.fn(),
  readSelect: vi.fn(),
  readEq: vi.fn(),
  readMaybeSingle: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  updateIs: vi.fn(),
  updateSelect: vi.fn(),
  updateMaybeSingle: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import * as route from "./route";

const PARTNER_ID = "10000000-0000-4000-a000-000000000043";
const ADMIN_ID = "10000000-0000-4000-a000-000000000099";
const context = { params: { partnerId: PARTNER_ID } };

const colors = {
  primary: "#ea580c",
  primaryHover: "#c2410c",
  primaryActive: "#9a3412",
  accent: "#c2410c",
  primaryDark: "#ff914d",
  primaryHoverDark: "#f57f33",
  primaryActiveDark: "#e8752c",
  accentDark: "#ff914d",
};

const profile = {
  name: "Alpha Dog Agency",
  slug: "alpha-dog",
  customDomain: "app.alphadogagency.ai",
  logoLightUrl: "https://cdn.example.com/logo-light.svg",
  logoDarkUrl: "https://cdn.example.com/logo-dark.svg",
  faviconUrl: "https://cdn.example.com/favicon.png",
  emailFrom: "notifications@alphadogagency.ai",
  status: "active",
  colors,
};

const row = {
  id: PARTNER_ID,
  name: profile.name,
  slug: profile.slug,
  custom_domain: profile.customDomain,
  domain_status: "connected",
  logo_light_url: profile.logoLightUrl,
  logo_dark_url: profile.logoDarkUrl,
  favicon_url: profile.faviconUrl,
  brand_primary: colors.primary,
  brand_primary_hover: colors.primaryHover,
  brand_primary_active: colors.primaryActive,
  brand_accent: colors.accent,
  brand_primary_dark: colors.primaryDark,
  brand_primary_hover_dark: colors.primaryHoverDark,
  brand_primary_active_dark: colors.primaryActiveDark,
  brand_accent_dark: colors.accentDark,
  email_from: profile.emailFrom,
  email_from_status: "pending",
  email_from_verified_at: null,
  email_from_verified_by: null,
  status: "active",
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T01:00:00.000Z",
};

function makeRequest(body: unknown, raw = false) {
  return new NextRequest(`http://localhost/api/admin/partners/${PARTNER_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function getRequest() {
  return new NextRequest(`http://localhost/api/admin/partners/${PARTNER_ID}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });

  const readChain = {
    eq: mocks.readEq,
    maybeSingle: mocks.readMaybeSingle,
  };
  mocks.readSelect.mockReturnValue(readChain);
  mocks.readEq.mockReturnValue(readChain);
  mocks.readMaybeSingle.mockResolvedValue({ data: row, error: null });

  const updateChain = {
    eq: mocks.updateEq,
    is: mocks.updateIs,
    select: mocks.updateSelect,
    maybeSingle: mocks.updateMaybeSingle,
  };
  mocks.update.mockReturnValue(updateChain);
  mocks.updateEq.mockReturnValue(updateChain);
  mocks.updateIs.mockReturnValue(updateChain);
  mocks.updateSelect.mockReturnValue(updateChain);
  mocks.updateMaybeSingle.mockResolvedValue({ data: row, error: null });

  mocks.from.mockReturnValue({
    select: mocks.readSelect,
    update: mocks.update,
  });
});

describe("/api/admin/partners/[partnerId]", () => {
  it("exports no destructive DELETE handler", () => {
    expect(route).not.toHaveProperty("DELETE");
  });

  it.each(["GET", "PATCH"] as const)(
    "returns a non-disclosing 404 before database or body work for unauthorized %s",
    async (method) => {
      mocks.getAdminUser.mockResolvedValue(null);

      const response =
        method === "GET"
          ? await route.GET(getRequest(), context)
          : await route.PATCH(makeRequest("{", true), context);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Not found" });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it("returns a validated partner DTO", async () => {
    const response = await route.GET(getRequest(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      partner: {
        id: PARTNER_ID,
        customDomain: profile.customDomain,
        domainStatus: "connected",
      },
    });
  });

  it("forces pending when a profile update changes the custom domain", async () => {
    const changedDomain = "new.alphadogagency.ai";
    mocks.updateMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        custom_domain: changedDomain,
        domain_status: "pending",
      },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({ action: "update", ...profile, customDomain: changedDomain }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_domain: changedDomain,
        domain_status: "pending",
      }),
    );
    expect(mocks.updateEq).toHaveBeenCalledWith("id", PARTNER_ID);
    expect(mocks.updateEq).toHaveBeenCalledWith("updated_at", row.updated_at);
  });

  it("preserves connected status for an ordinary same-domain profile update", async () => {
    const verifiedRow = {
      ...row,
      email_from_status: "verified",
      email_from_verified_at: "2026-08-03T00:30:00.000Z",
      email_from_verified_by: ADMIN_ID,
    };
    mocks.readMaybeSingle.mockResolvedValue({
      data: verifiedRow,
      error: null,
    });
    mocks.updateMaybeSingle.mockResolvedValue({
      data: { ...verifiedRow, name: "Updated Agency" },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({ action: "update", ...profile, name: "Updated Agency" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Updated Agency",
        custom_domain: profile.customDomain,
        domain_status: "connected",
        email_from: profile.emailFrom,
      }),
    );
    expect(mocks.update.mock.calls[0]?.[0]).not.toHaveProperty(
      "email_from_status",
    );
    await expect(response.json()).resolves.toMatchObject({
      partner: {
        emailFromStatus: "verified",
        emailFromVerifiedAt: verifiedRow.email_from_verified_at,
        emailFromVerifiedBy: ADMIN_ID,
      },
    });
  });

  it("resets sender verification when the profile address changes", async () => {
    const changedEmail = "hello@alphadogagency.ai";
    mocks.readMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        email_from_status: "verified",
        email_from_verified_at: "2026-08-03T00:30:00.000Z",
        email_from_verified_by: ADMIN_ID,
      },
      error: null,
    });
    mocks.updateMaybeSingle.mockResolvedValue({
      data: { ...row, email_from: changedEmail },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({ action: "update", ...profile, emailFrom: changedEmail }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        email_from: changedEmail,
        email_from_status: "pending",
        email_from_verified_at: null,
        email_from_verified_by: null,
      }),
    );
  });

  it("sets a cleared sender to Unconfigured and clears verification audit", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        email_from: null,
        email_from_status: "unconfigured",
      },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({ action: "update", ...profile, emailFrom: null }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        email_from: null,
        email_from_status: "unconfigured",
        email_from_verified_at: null,
        email_from_verified_by: null,
      }),
    );
  });

  it("marks only the unchanged saved sender verified with admin audit fields", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        email_from_status: "verified",
        email_from_verified_at: "2026-08-03T02:00:00.000Z",
        email_from_verified_by: ADMIN_ID,
      },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({
        action: "verify_email_from",
        expectedEmailFrom: profile.emailFrom,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      email_from_status: "verified",
      email_from_verified_at: expect.any(String),
      email_from_verified_by: ADMIN_ID,
    });
    expect(mocks.updateEq).toHaveBeenCalledWith("id", PARTNER_ID);
    expect(mocks.updateEq).toHaveBeenCalledWith("updated_at", row.updated_at);
    expect(mocks.updateEq).toHaveBeenCalledWith(
      "email_from",
      profile.emailFrom,
    );
    await expect(response.json()).resolves.toMatchObject({
      partner: {
        emailFrom: profile.emailFrom,
        emailFromStatus: "verified",
        emailFromVerifiedBy: ADMIN_ID,
      },
    });
  });

  it("rejects sender verification when no address is saved", async () => {
    mocks.readMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        email_from: null,
        email_from_status: "unconfigured",
      },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({
        action: "verify_email_from",
        expectedEmailFrom: profile.emailFrom,
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "partner_email_from_required",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects sender verification when the expected address is stale", async () => {
    mocks.readMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        email_from: "new@alphadogagency.ai",
      },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({
        action: "verify_email_from",
        expectedEmailFrom: profile.emailFrom,
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "partner_email_from_changed",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns the optimistic conflict when sender verification loses an update race", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await route.PATCH(
      makeRequest({
        action: "verify_email_from",
        expectedEmailFrom: profile.emailFrom,
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "partner_update_conflict",
    });
    expect(mocks.updateEq).toHaveBeenCalledWith("updated_at", row.updated_at);
    expect(mocks.updateEq).toHaveBeenCalledWith(
      "email_from",
      profile.emailFrom,
    );
  });

  it("requires a stored custom domain before marking connected", async () => {
    mocks.readMaybeSingle.mockResolvedValue({
      data: { ...row, custom_domain: null, domain_status: "pending" },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({
        action: "set_domain_status",
        domainStatus: "connected",
        expectedCustomDomain: null,
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "domain_required",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates domain status as a distinct status-only action", async () => {
    mocks.readMaybeSingle.mockResolvedValue({
      data: { ...row, domain_status: "pending" },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({
        action: "set_domain_status",
        domainStatus: "connected",
        expectedCustomDomain: profile.customDomain,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ domain_status: "connected" });
    expect(mocks.updateEq).toHaveBeenCalledWith(
      "custom_domain",
      profile.customDomain,
    );
  });

  it("rejects a stale status action when the displayed domain changed", async () => {
    mocks.readMaybeSingle.mockResolvedValue({
      data: {
        ...row,
        custom_domain: "new.alphadogagency.ai",
        domain_status: "pending",
      },
      error: null,
    });

    const response = await route.PATCH(
      makeRequest({
        action: "set_domain_status",
        domainStatus: "connected",
        expectedCustomDomain: profile.customDomain,
      }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "partner_domain_changed",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects combining a domain edit with a connected-status action", async () => {
    const response = await route.PATCH(
      makeRequest({
        action: "set_domain_status",
        domainStatus: "connected",
        expectedCustomDomain: profile.customDomain,
        customDomain: "new.example.com",
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns a stable 409 when optimistic concurrency matches no row", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await route.PATCH(
      makeRequest({ action: "update", ...profile, name: "Concurrent Edit" }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "partner_update_conflict",
    });
  });

  it("maps duplicate slug or domain updates to a stable 409", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "private database details" },
    });

    const response = await route.PATCH(
      makeRequest({ action: "update", ...profile, slug: "duplicate" }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "partner_conflict",
    });
  });

  it("fails closed when an existing or returned database row is malformed", async () => {
    mocks.readMaybeSingle.mockResolvedValueOnce({
      data: { ...row, brand_primary: "orange" },
      error: null,
    });

    const existingResponse = await route.PATCH(
      makeRequest({ action: "update", ...profile }),
      context,
    );
    expect(existingResponse.status).toBe(500);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.readMaybeSingle.mockResolvedValue({ data: row, error: null });
    mocks.updateMaybeSingle.mockResolvedValue({
      data: { ...row, logo_dark_url: "http://localhost/logo.svg" },
      error: null,
    });

    const returnedResponse = await route.PATCH(
      makeRequest({ action: "update", ...profile, name: "New Name" }),
      context,
    );
    expect(returnedResponse.status).toBe(500);
  });

  it("returns 404 for an invalid id before touching the database", async () => {
    const response = await route.GET(getRequest(), {
      params: { partnerId: "not-a-uuid" },
    });

    expect(response.status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
