import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each createServerClient call is captured with its options and auth spies.
// Customer getClaims and admin getUser behavior are scripted independently so
// a test cannot accidentally exercise or rotate the wrong auth channel.
const mocks = vi.hoisted(() => ({
  clients: [] as {
    url: string;
    key: string;
    options: Record<string, unknown>;
    getClaims: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  }[],
  script: [] as {
    user: { id: string } | null;
    claims: Record<string, unknown> | null;
    claimsError?: { message: string } | null;
    rotateOnClaims?: {
      name: string;
      value: string;
      options: Record<string, unknown>;
    }[];
    rotateOnUser?: {
      name: string;
      value: string;
      options: Record<string, unknown>;
    }[];
    signOutError?: { message: string } | null;
    signOutCalls: { scope?: string }[];
  }[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (url: string, key: string, options: Record<string, unknown>) => {
      const index = mocks.clients.length;
      const behavior = mocks.script[index];
      if (!behavior) throw new Error(`no scripted behavior for client ${index}`);
      const cookieHandlers = options.cookies as {
        setAll: (
          cookies: { name: string; value: string; options: Record<string, unknown> }[]
        ) => void;
      };
      const getClaims = vi.fn(async () => {
        if (behavior.rotateOnClaims) {
          cookieHandlers.setAll(behavior.rotateOnClaims);
        }
        return {
          data: behavior.claims ? { claims: behavior.claims } : null,
          error: behavior.claimsError ?? null,
        };
      });
      const getUser = vi.fn(async () => {
        if (behavior.rotateOnUser) cookieHandlers.setAll(behavior.rotateOnUser);
        return { data: { user: behavior.user }, error: null };
      });
      mocks.clients.push({ url, key, options, getClaims, getUser });
      return {
        auth: {
          getClaims,
          getUser,
          signOut: vi.fn(async (opts: { scope?: string }) => {
            behavior.signOutCalls.push(opts);
            return { error: behavior.signOutError ?? null };
          }),
        },
      };
    }
  ),
}));

import { updateSession } from "./middleware";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function scriptClient(
  user: { id: string } | null,
  extras: Partial<(typeof mocks.script)[number]> = {}
) {
  mocks.script.push({
    user,
    claims: user ? { sub: user.id } : null,
    signOutCalls: [],
    ...extras,
  });
}

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  mocks.clients.length = 0;
  mocks.script.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.local");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SIMPLASSIST_ADMIN_USER_IDS", ADMIN_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  it("uses getClaims only for the customer channel on non-admin paths", async () => {
    scriptClient({ id: OTHER_ID });
    await updateSession(makeRequest("/dashboard"));
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0].options.cookieOptions).toBeUndefined();
    expect(mocks.clients[0].getClaims).toHaveBeenCalledOnce();
    expect(mocks.clients[0].getUser).not.toHaveBeenCalled();
  });

  it("keeps authoritative getUser for the admin channel", async () => {
    scriptClient({ id: OTHER_ID });
    scriptClient({ id: ADMIN_ID });
    await updateSession(makeRequest("/admin/tickets"));
    expect(mocks.clients).toHaveLength(2);
    expect(mocks.clients[0].options.cookieOptions).toBeUndefined();
    expect(mocks.clients[1].options.cookieOptions).toMatchObject({
      name: "sa-admin-auth",
    });
    expect(mocks.clients[0].getClaims).toHaveBeenCalledOnce();
    expect(mocks.clients[0].getUser).not.toHaveBeenCalled();
    expect(mocks.clients[1].getClaims).not.toHaveBeenCalled();
    expect(mocks.clients[1].getUser).toHaveBeenCalledOnce();
  });

  it("applies BOTH clients' rotated cookies to the single response", async () => {
    scriptClient(
      { id: OTHER_ID },
      {
        rotateOnClaims: [
          {
            name: "sb-ref-auth-token",
            value: "customer-rotated",
            options: {},
          },
        ],
      }
    );
    scriptClient(
      { id: ADMIN_ID },
      {
        rotateOnUser: [
          { name: "sa-admin-auth", value: "admin-rotated", options: {} },
        ],
      }
    );
    const request = makeRequest("/admin");
    const response = await updateSession(request);
    const names = response.cookies.getAll().map((cookie) => cookie.name);
    expect(names).toContain("sb-ref-auth-token");
    expect(names).toContain("sa-admin-auth");
    expect(response.cookies.get("sb-ref-auth-token")?.value).toBe(
      "customer-rotated"
    );
    expect(response.cookies.get("sa-admin-auth")?.value).toBe("admin-rotated");
    expect(request.cookies.get("sb-ref-auth-token")?.value).toBe(
      "customer-rotated"
    );
    expect(request.cookies.get("sa-admin-auth")?.value).toBe("admin-rotated");
  });

  it("continues normally when the customer session is missing", async () => {
    scriptClient(null);

    await expect(
      updateSession(makeRequest("/dashboard"))
    ).resolves.toBeDefined();
    expect(mocks.clients[0].getClaims).toHaveBeenCalledOnce();
    expect(mocks.clients[0].getUser).not.toHaveBeenCalled();
  });

  it("leaves authorization to downstream gates when claims validation returns an error", async () => {
    scriptClient(null, {
      claimsError: { message: "invalid signature" },
    });

    await expect(
      updateSession(makeRequest("/dashboard"))
    ).resolves.toBeDefined();
    expect(mocks.clients[0].getUser).not.toHaveBeenCalled();
  });

  it("still performs the admin allowlist check when customer claims fail", async () => {
    scriptClient(null, {
      claimsError: { message: "JWKS unavailable" },
    });
    scriptClient({ id: ADMIN_ID });

    await expect(updateSession(makeRequest("/admin"))).resolves.toBeDefined();
    expect(mocks.clients[0].getClaims).toHaveBeenCalledOnce();
    expect(mocks.clients[1].getUser).toHaveBeenCalledOnce();
  });

  it("signs out a non-allowlisted admin-channel session with scope local", async () => {
    scriptClient(null);
    scriptClient({ id: OTHER_ID });
    await updateSession(makeRequest("/api/admin/business-flags"));
    expect(mocks.script[1].signOutCalls).toEqual([{ scope: "local" }]);
    expect(mocks.script[0].signOutCalls).toEqual([]);
  });

  it("never signs out an allowlisted admin-channel session", async () => {
    scriptClient(null);
    scriptClient({ id: ADMIN_ID });
    await updateSession(makeRequest("/admin"));
    expect(mocks.script[1].signOutCalls).toEqual([]);
  });

  it("logs and continues when revoking a non-allowlisted session fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    scriptClient(null);
    scriptClient({ id: OTHER_ID }, { signOutError: { message: "rate limited" } });
    const response = await updateSession(makeRequest("/admin"));
    expect(response).toBeDefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to revoke"),
      "rate limited"
    );
    consoleError.mockRestore();
  });

  it("does not run the admin client for lookalike customer paths", async () => {
    scriptClient({ id: OTHER_ID });
    await updateSession(makeRequest("/administrators"));
    expect(mocks.clients).toHaveLength(1);
  });
});
