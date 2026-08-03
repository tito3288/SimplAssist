import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  insertSelect: vi.fn(),
  single: vi.fn(),
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

const colors = {
  primary: "#EA580C",
  primaryHover: "#C2410C",
  primaryActive: "#9A3412",
  accent: "#C2410C",
  primaryDark: "#FF914D",
  primaryHoverDark: "#F57F33",
  primaryActiveDark: "#E8752C",
  accentDark: "#FF914D",
};

const profile = {
  name: " Alpha Dog Agency ",
  slug: "ALPHA-DOG",
  customDomain: "APP.ALPHADOGAGENCY.AI",
  logoLightUrl: "https://cdn.example.com/logo-light.svg",
  logoDarkUrl: "https://cdn.example.com/logo-dark.svg",
  faviconUrl: "https://cdn.example.com/favicon.png",
  emailFrom: "NOTIFICATIONS@ALPHADOGAGENCY.AI",
  status: "active",
  colors,
};

const row = {
  id: PARTNER_ID,
  name: "Alpha Dog Agency",
  slug: "alpha-dog",
  custom_domain: "app.alphadogagency.ai",
  domain_status: "pending",
  logo_light_url: profile.logoLightUrl,
  logo_dark_url: profile.logoDarkUrl,
  favicon_url: profile.faviconUrl,
  brand_primary: "#ea580c",
  brand_primary_hover: "#c2410c",
  brand_primary_active: "#9a3412",
  brand_accent: "#c2410c",
  brand_primary_dark: "#ff914d",
  brand_primary_hover_dark: "#f57f33",
  brand_primary_active_dark: "#e8752c",
  brand_accent_dark: "#ff914d",
  email_from: "notifications@alphadogagency.ai",
  email_from_status: "pending",
  email_from_verified_at: null,
  email_from_verified_by: null,
  status: "active",
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T01:00:00.000Z",
};

function postRequest(body: unknown, raw = false) {
  return new NextRequest("http://localhost/api/admin/partners", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.from.mockReturnValue({
    select: mocks.select,
    insert: mocks.insert,
  });
  mocks.select.mockReturnValue({ order: mocks.order });
  mocks.order.mockResolvedValue({ data: [row], error: null });
  mocks.insert.mockReturnValue({ select: mocks.insertSelect });
  mocks.insertSelect.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: row, error: null });
});

describe("/api/admin/partners", () => {
  it("exports no destructive DELETE handler", () => {
    expect(route).not.toHaveProperty("DELETE");
  });

  it.each(["GET", "POST"] as const)(
    "returns a non-disclosing 404 before database or body work for unauthorized %s",
    async (method) => {
      mocks.getAdminUser.mockResolvedValue(null);

      const response =
        method === "GET"
          ? await route.GET()
          : await route.POST(postRequest("{", true));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Not found" });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it("lists only validated admin DTOs", async () => {
    const response = await route.GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      partners: [
        {
          id: PARTNER_ID,
          slug: "alpha-dog",
          customDomain: "app.alphadogagency.ai",
          domainStatus: "pending",
          emailFrom: "notifications@alphadogagency.ai",
          emailFromStatus: "pending",
          colors: { primaryDark: "#ff914d" },
        },
      ],
    });
    expect(mocks.from).toHaveBeenCalledWith("partners");
    expect(mocks.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("fails closed when a listed database row is malformed", async () => {
    mocks.order.mockResolvedValue({
      data: [{ ...row, logo_light_url: "http://localhost/logo.svg" }],
      error: null,
    });

    const response = await route.GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load partners",
    });
  });

  it("creates a normalized partner pending and validates the returned row", async () => {
    const response = await route.POST(postRequest(profile));

    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alpha Dog Agency",
        slug: "alpha-dog",
        custom_domain: "app.alphadogagency.ai",
        domain_status: "pending",
        email_from: "notifications@alphadogagency.ai",
        email_from_status: "pending",
        email_from_verified_at: null,
        email_from_verified_by: null,
        brand_primary: "#ea580c",
        brand_primary_dark: "#ff914d",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      partner: { id: PARTNER_ID, domainStatus: "pending" },
    });
  });

  it("creates an empty sender as Unconfigured with no verification audit", async () => {
    mocks.single.mockResolvedValue({
      data: {
        ...row,
        email_from: null,
        email_from_status: "unconfigured",
      },
      error: null,
    });

    const response = await route.POST(
      postRequest({ ...profile, emailFrom: null }),
    );

    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email_from: null,
        email_from_status: "unconfigured",
        email_from_verified_at: null,
        email_from_verified_by: null,
      }),
    );
  });

  it("rejects an attempted connected create instead of mass-assigning status", async () => {
    const response = await route.POST(
      postRequest({ ...profile, domainStatus: "connected" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("maps duplicate slug or domain writes to a stable 409", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "private database details" },
    });

    const response = await route.POST(postRequest(profile));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A partner with that slug or domain already exists",
      code: "partner_conflict",
    });
  });

  it("returns 500 instead of exposing a malformed inserted row", async () => {
    mocks.single.mockResolvedValue({
      data: { ...row, brand_accent_dark: "not-a-color" },
      error: null,
    });

    const response = await route.POST(postRequest(profile));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create partner",
    });
  });
});
