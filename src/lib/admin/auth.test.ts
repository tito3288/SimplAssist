import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  headers: vi.fn(),
  createAdminSessionClient: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/admin/session", () => ({
  createAdminSessionClient: mocks.createAdminSessionClient,
}));

import { getAdminGateState, getAdminUser, requireAdminUser } from "./auth";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function sessionUser(id: string, email: string | null = "admin@example.com") {
  mocks.getUser.mockResolvedValue({ data: { user: { id, email } }, error: null });
}

function noSession() {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { message: "Auth session missing!" },
  });
}

function requestHeaders(
  host: string | null,
  extras: Record<string, string> = {},
) {
  mocks.headers.mockResolvedValue(
    new Headers({ ...(host === null ? {} : { host }), ...extras }),
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  requestHeaders("localhost:3000");
  mocks.createAdminSessionClient.mockImplementation(async () => ({
    auth: { getUser: mocks.getUser },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.getUser.mockReset();
  mocks.headers.mockReset();
  mocks.createAdminSessionClient.mockReset();
  mocks.notFound.mockClear();
});

describe("canonical host enforcement", () => {
  it.each([
    ["a partner host", "app.alphadogagency.ai"],
    ["an unknown host", "unknown.example"],
    ["a suffix lookalike", "localhost.evil.example"],
    ["a malformed Host", "https://localhost:3000/path"],
    ["a missing Host", null],
  ])("fails closed before reading the admin session for %s", async (_, host) => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    requestHeaders(host);
    sessionUser(ADMIN_ID);

    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
    expect(mocks.createAdminSessionClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("accepts canonical Host normalization for case, port, and a final DNS dot", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    requestHeaders("LOCALHOST.:8443");
    sessionUser(ADMIN_ID);

    expect((await getAdminGateState()).state).toBe("admin");
    expect(mocks.createAdminSessionClient).toHaveBeenCalledOnce();
  });

  it("ignores X-Forwarded-Host when the actual Host is canonical", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    requestHeaders("localhost:3000", {
      "x-forwarded-host": "app.alphadogagency.ai",
      forwarded: "host=app.alphadogagency.ai",
    });
    sessionUser(ADMIN_ID);

    expect((await getAdminGateState()).state).toBe("admin");
  });

  it("does not let a forwarded canonical host rescue a noncanonical Host", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    requestHeaders("app.alphadogagency.ai", {
      "x-forwarded-host": "localhost:3000",
      forwarded: "host=localhost:3000",
    });
    sessionUser(ADMIN_ID);

    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
    expect(mocks.createAdminSessionClient).not.toHaveBeenCalled();
  });

  it("maps a noncanonical Host to null/404 through the public admin helpers", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    requestHeaders("app.alphadogagency.ai");
    sessionUser(ADMIN_ID);

    await expect(getAdminUser()).resolves.toBeNull();
    await expect(requireAdminUser()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.createAdminSessionClient).not.toHaveBeenCalled();
  });

  it.each(["", "not a URL", "ftp://localhost"])(
    "fails closed for invalid canonical configuration %j",
    async (configuredOrigin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", configuredOrigin);
      vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
      sessionUser(ADMIN_ID);

      expect(await getAdminGateState()).toEqual({ state: "forbidden" });
      expect(mocks.createAdminSessionClient).not.toHaveBeenCalled();
    },
  );
});

describe("allowlist parsing (fail-closed)", () => {
  it("forbids everyone when the env var is unset, even with a valid session", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", "");
    delete process.env.SIMPLASSIST_ADMIN_USER_IDS;
    sessionUser(ADMIN_ID);
    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
    expect(await getAdminUser()).toBeNull();
  });

  it("forbids everyone when the env var is empty", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", "");
    sessionUser(ADMIN_ID);
    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
  });

  it("forbids everyone when the env var is whitespace-only", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", "   ");
    sessionUser(ADMIN_ID);
    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
  });

  it("never renders the login path on an unconfigured deploy: forbidden even with no session", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", "");
    noSession();
    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
  });

  it("trims whitespace around comma-separated entries", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", `  ${OTHER_ID} ,  ${ADMIN_ID}  `);
    sessionUser(ADMIN_ID);
    const gate = await getAdminGateState();
    expect(gate.state).toBe("admin");
  });

  it("ignores empty entries from stray commas", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", `,${ADMIN_ID},,`);
    sessionUser(ADMIN_ID);
    expect((await getAdminGateState()).state).toBe("admin");
  });
});

describe("gate states", () => {
  it("returns unauthenticated when there is no admin-channel session", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    noSession();
    expect(await getAdminGateState()).toEqual({ state: "unauthenticated" });
    expect(await getAdminUser()).toBeNull();
  });

  it("returns forbidden for an authenticated user not in the allowlist", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    sessionUser(OTHER_ID);
    expect(await getAdminGateState()).toEqual({ state: "forbidden" });
    expect(await getAdminUser()).toBeNull();
  });

  it("returns the admin identity for an allowlisted session", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    sessionUser(ADMIN_ID, "admin@simplassist.test");
    expect(await getAdminGateState()).toEqual({
      state: "admin",
      admin: { id: ADMIN_ID, email: "admin@simplassist.test" },
    });
    expect(await getAdminUser()).toEqual({
      id: ADMIN_ID,
      email: "admin@simplassist.test",
    });
  });

  it("normalizes a missing email to null", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    mocks.getUser.mockResolvedValue({
      data: { user: { id: ADMIN_ID } },
      error: null,
    });
    expect(await getAdminUser()).toEqual({ id: ADMIN_ID, email: null });
  });
});

describe("requireAdminUser", () => {
  it("throws notFound for non-admins", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    sessionUser(OTHER_ID);
    await expect(requireAdminUser()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("returns the admin for allowlisted sessions", async () => {
    vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
    sessionUser(ADMIN_ID);
    await expect(requireAdminUser()).resolves.toMatchObject({ id: ADMIN_ID });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
