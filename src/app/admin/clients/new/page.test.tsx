import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  noStore: vi.fn(),
  requireAdminUser: vi.fn(),
  from: vi.fn(),
  result: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../CreateClientForm", () => ({
  CreateClientForm: ({
    activePartners,
  }: {
    activePartners: Array<{ name: string; customDomain: string }>;
  }) => (
    <div>
      {activePartners.map((partner) => (
        <span key={partner.customDomain}>
          {partner.name}:{partner.customDomain}
        </span>
      ))}
    </div>
  ),
}));

import NewPartnerClientPage from "./page";
import { parseActiveConnectedPartnerOptions } from "../partnerOptions";

function storedPartner(overrides: Record<string, unknown> = {}) {
  return {
    id: "20000000-0000-4000-a044-000000000001",
    name: "Example Partner",
    custom_domain: "partner.example.com",
    status: "active",
    domain_status: "connected",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.result = { data: [], error: null };
  mocks.from.mockImplementation(() => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      not: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    query.order.mockImplementation(async () => mocks.result);
    return query;
  });
});

describe("NewPartnerClientPage", () => {
  it("authorizes and disables caching before listing active connected partners", async () => {
    mocks.result = { data: [storedPartner()], error: null };

    const html = renderToStaticMarkup(await NewPartnerClientPage());

    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0],
    );
    expect(mocks.from).toHaveBeenCalledWith("partners");
    const query = mocks.from.mock.results[0]?.value;
    expect(query.select).toHaveBeenCalledWith(
      "id, name, custom_domain, status, domain_status",
    );
    expect(query.eq).toHaveBeenCalledWith("status", "active");
    expect(query.eq).toHaveBeenCalledWith("domain_status", "connected");
    expect(query.not).toHaveBeenCalledWith("custom_domain", "is", null);
    expect(query.order).toHaveBeenCalledWith("name", { ascending: true });
    expect(html).toContain("Example Partner:partner.example.com");
  });

  it("rejects malformed, unavailable, and duplicate partner reads", () => {
    const parsed = parseActiveConnectedPartnerOptions([
      storedPartner(),
      storedPartner(),
      storedPartner({
        id: "30000000-0000-4000-a044-000000000001",
        custom_domain: "https://evil.example.com",
      }),
      storedPartner({
        id: "40000000-0000-4000-a044-000000000001",
        status: "inactive",
      }),
      storedPartner({
        id: "50000000-0000-4000-a044-000000000001",
        domain_status: "pending",
      }),
    ]);

    expect(parsed.partners).toEqual([
      {
        id: "20000000-0000-4000-a044-000000000001",
        name: "Example Partner",
        customDomain: "partner.example.com",
      },
    ]);
    expect(parsed.invalidRecordCount).toBe(4);
  });
});
