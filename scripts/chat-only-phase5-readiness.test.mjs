import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeLaunchReadiness,
  buildLaunchReadinessAudit,
  loadPhase5DatabaseState,
  parseArguments,
  sanitizeLaunchReadinessError,
  validateEnvironment,
} from "./chat-only-phase5-readiness.mjs";

const PROJECT_REF = "example-project";
const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-a000-000000000002";
const SECOND_ATTEMPT_ID = "30000000-0000-4000-a000-000000000003";
const RAW_SESSION_ID = "cs_live_phase5_private";
const NOW = new Date("2026-08-20T12:00:00.000Z");

function environment(overrides = {}) {
  return {
    STRIPE_SECRET_KEY: "sk_test_phase5_secret",
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-phase5-secret",
    STRIPE_PRICE_SMS_ONLY: "price_starter",
    STRIPE_PRICE_SMS_AND_CHAT: "price_growth",
    STRIPE_PRICE_FULL: "price_full",
    STRIPE_PRICE_CHAT_ONLY: "price_chat",
    STRIPE_PRICE_SETUP_FEE: "price_setup",
    STRIPE_PRICE_SMS_OVERAGE_PART: "price_overage",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_phase5",
    WIDGET_TOKEN_SECRET: "w".repeat(32),
    WIDGET_EDGE_ORIGIN_SECRET: "e".repeat(64),
    CHAT_ONLY_DIRECT_SALES_ENABLED: "0",
    CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: "0",
    TELNYX_REMOTE_RELEASE_ENABLED: "0",
    ...overrides,
  };
}

function liveEnvironment(overrides = {}) {
  return environment({
    STRIPE_SECRET_KEY: "sk_live_phase5_secret",
    ...overrides,
  });
}

function target(overrides = {}) {
  return {
    help: false,
    stripeMode: "test",
    projectRef: PROJECT_REF,
    chatPriceState: "required",
    widgetSecretState: "required",
    canaryState: "absent",
    launchState: "off",
    blockerInventoriesClear: true,
    wafVerified: true,
    schedulerVerified: true,
    homepageCacheVerified: true,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    stripeMode: "test",
    projectRef: PROJECT_REF,
    launchState: "off",
    directSalesSwitchValue: "0",
    partnerAssignmentSwitchValue: "0",
    blockerInventoriesClear: true,
    wafVerified: true,
    schedulerVerified: true,
    homepageCacheVerified: true,
    chatOnlyDirectSalesEnabled: false,
    chatOnlyPartnerAssignmentEnabled: false,
    directCanaryBusinessId: null,
    widgetEdgeOriginSecretConfigured: true,
    ...overrides,
  };
}

function issue(code = "inherited_blocker") {
  return {
    code,
    message: "Sanitized inherited blocker",
    count: 1,
    refs: ["business_0123456789ab"],
  };
}

function phase4Report(overrides = {}) {
  const report = {
    schema_version: 1,
    operation: "chat_only_phase4_readiness",
    generated_at: NOW.toISOString(),
    verdict: "pass",
    targets: {
      stripe_mode: "test",
      stripe_account_ref: "stripe_account_0123456789ab",
      supabase_project_ref: PROJECT_REF,
    },
    environment: {
      chat_price_state: "required",
      widget_secret_state: "required",
      widget_token_secret_configured: true,
      direct_canary: {
        expected_state: "absent",
        configured: false,
        ref: null,
        eligible: null,
      },
    },
    chat_only_price: {
      ref: "price_0123456789ab",
      configured: true,
      mode_matches: true,
      active: true,
      recurring: true,
      usd_1000: true,
      monthly_interval: true,
      licensed: true,
      contract_satisfied: true,
    },
    open_checkout_sessions: {
      total_open: 0,
      by_base_plan: {},
      open_chat_only: 0,
      chat_session_refs: [],
    },
    chat_only_subscriptions: {
      total_matching: 0,
      nonterminal: 0,
      refs: [],
    },
    stripe_portal: {
      configuration_pinned: true,
      phase4_contract_complete: true,
    },
    blockers: [],
    warnings: [],
  };
  return { ...report, ...overrides };
}

function database(attempts = []) {
  return { chatOnlyCheckoutAttempts: attempts };
}

function analyze(overrides = {}) {
  return analyzeLaunchReadiness({
    phase4Report: phase4Report(),
    database: database(),
    config: config(),
    now: NOW,
    ...overrides,
  });
}

describe("Phase 5 launch-readiness CLI contract", () => {
  it("requires explicit target, launch state, and external booleans", () => {
    expect(
      parseArguments([
        "--launch-state=off",
        "--stripe-mode",
        "test",
        "--supabase-project-ref",
        PROJECT_REF,
        "--blocker-inventories-clear=true",
        "--waf-verified",
        "true",
        "--scheduler-verified=false",
        "--homepage-cache-verified=true",
      ]),
    ).toEqual({
      help: false,
      stripeMode: "test",
      projectRef: PROJECT_REF,
      chatPriceState: "required",
      widgetSecretState: "required",
      canaryState: "absent",
      launchState: "off",
      blockerInventoriesClear: true,
      wafVerified: true,
      schedulerVerified: false,
      homepageCacheVerified: true,
    });

    const common = [
      "--launch-state=off",
      "--stripe-mode=test",
      `--supabase-project-ref=${PROJECT_REF}`,
      "--blocker-inventories-clear=true",
      "--waf-verified=true",
      "--scheduler-verified=true",
      "--homepage-cache-verified=true",
    ];
    for (const flag of [
      "--launch-state",
      "--blocker-inventories-clear",
      "--waf-verified",
      "--scheduler-verified",
      "--homepage-cache-verified",
    ]) {
      const filtered = common.filter((value) => !value.startsWith(`${flag}=`));
      expect(() => parseArguments(filtered)).toThrow(
        flag === "--launch-state"
          ? "--launch-state must be exactly off or ready"
          : `${flag} is required`,
      );
    }
  });

  it("rejects malformed, duplicated, or mutation-shaped CLI input", () => {
    const base = [
      "--launch-state=off",
      "--stripe-mode=test",
      `--supabase-project-ref=${PROJECT_REF}`,
      "--blocker-inventories-clear=true",
      "--waf-verified=true",
      "--scheduler-verified=true",
      "--homepage-cache-verified=true",
    ];
    expect(() =>
      parseArguments([
        ...base,
        "--waf-verified=false",
      ]),
    ).toThrow("--waf-verified may be supplied only once");
    expect(() =>
      parseArguments(
        base.map((value) =>
          value === "--waf-verified=true" ? "--waf-verified=yes" : value,
        ),
      ),
    ).toThrow("--waf-verified must be exactly true or false");
    expect(() =>
      parseArguments(
        base.map((value) =>
          value === "--homepage-cache-verified=true"
            ? "--homepage-cache-verified=confirmed"
            : value,
        ),
      ),
    ).toThrow("--homepage-cache-verified must be exactly true or false");
    expect(() =>
      parseArguments([
        ...base,
        "--apply",
      ]),
    ).toThrow("Unknown argument");
    expect(() =>
      parseArguments(
        base.map((value) =>
          value === "--launch-state=off" ? "--launch-state=canary" : value,
        ),
      ),
    ).toThrow("--launch-state must be exactly off or ready");
  });

  it("validates an exact off state through the Phase 4 required contracts", () => {
    const result = validateEnvironment(target(), environment());

    expect(result).toMatchObject({
      stripeMode: "test",
      projectRef: PROJECT_REF,
      launchState: "off",
      chatPriceState: "required",
      widgetSecretState: "required",
      canaryState: "absent",
      directSalesSwitchValue: "0",
      partnerAssignmentSwitchValue: "0",
      chatOnlyPriceId: "price_chat",
      widgetTokenSecretConfigured: true,
      widgetEdgeOriginSecretConfigured: true,
    });
  });

  it("requires explicit exact rollout switches and an absent canary", () => {
    for (const direct of [undefined, "", "true", " 0", "1"]) {
      expect(() =>
        validateEnvironment(
          target(),
          environment({ CHAT_ONLY_DIRECT_SALES_ENABLED: direct }),
        ),
      ).toThrow(/CHAT_ONLY_DIRECT_SALES_ENABLED/);
    }
    for (const partner of [undefined, "", "true", " 0", "1"]) {
      expect(() =>
        validateEnvironment(
          target(),
          environment({ CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: partner }),
        ),
      ).toThrow(/CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED/);
    }
    expect(() =>
      validateEnvironment(
        target(),
        environment({ CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: BUSINESS_ID }),
      ),
    ).toThrow("must be unset or empty for Phase 5");
  });

  it("allows ready only against live evidence with exact broad 0 or 1", () => {
    for (const direct of ["0", "1"]) {
      const result = validateEnvironment(
        target({ stripeMode: "live", launchState: "ready" }),
        liveEnvironment({ CHAT_ONLY_DIRECT_SALES_ENABLED: direct }),
      );
      expect(result).toMatchObject({
        stripeMode: "live",
        launchState: "ready",
        directSalesSwitchValue: direct,
        partnerAssignmentSwitchValue: "0",
      });
    }
    expect(() =>
      validateEnvironment(
        target({ launchState: "ready" }),
        environment(),
      ),
    ).toThrow("--launch-state ready requires --stripe-mode live");
  });

  it("inherits Price, widget-token, Portal, mode, and server-only validation", () => {
    expect(() =>
      validateEnvironment(
        target(),
        environment({ STRIPE_PRICE_CHAT_ONLY: undefined }),
      ),
    ).toThrow("STRIPE_PRICE_CHAT_ONLY is required");
    expect(() =>
      validateEnvironment(
        target(),
        environment({ WIDGET_TOKEN_SECRET: "short" }),
      ),
    ).toThrow("at least 32 bytes");
    expect(() =>
      validateEnvironment(
        target(),
        environment({ NEXT_PUBLIC_WIDGET_TOKEN_SECRET: "exposed" }),
      ),
    ).toThrow("must remain server-only");
    expect(() =>
      validateEnvironment(
        target(),
        environment({ WIDGET_EDGE_ORIGIN_SECRET: undefined }),
      ),
    ).toThrow("WIDGET_EDGE_ORIGIN_SECRET must contain 43-128 base64url-safe characters");
    expect(() =>
      validateEnvironment(
        target(),
        environment({ WIDGET_EDGE_ORIGIN_SECRET: "short" }),
      ),
    ).toThrow("WIDGET_EDGE_ORIGIN_SECRET must contain 43-128 base64url-safe characters");
    for (const publicCopy of ["", "exposed"]) {
      expect(() =>
        validateEnvironment(
          target(),
          environment({ NEXT_PUBLIC_WIDGET_EDGE_ORIGIN_SECRET: publicCopy }),
        ),
      ).toThrow("WIDGET_EDGE_ORIGIN_SECRET must remain server-only");
    }
    expect(() =>
      validateEnvironment(
        target(),
        environment({
          WIDGET_EDGE_ORIGIN_SECRET: "w".repeat(64),
          WIDGET_TOKEN_SECRET: "w".repeat(64),
        }),
      ),
    ).toThrow("must be distinct from WIDGET_TOKEN_SECRET");
    expect(() =>
      validateEnvironment(
        target(),
        environment({ STRIPE_BILLING_PORTAL_CONFIGURATION_ID: undefined }),
      ),
    ).not.toThrow();
  });

  it("contains no mutation path and wires only a read-only package command", async () => {
    const [source, packageSource] = await Promise.all([
      readFile(
        new URL("./chat-only-phase5-readiness.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    expect(source).toContain(
      'from "./chat-only-phase4-readiness.mjs"',
    );
    expect(source).toContain('.from("chat_only_checkout_attempts")');
    expect(source).toContain(
      '.select("id,business_id,state", { count: "exact" })',
    );
    expect(source).not.toMatch(
      /\.(?:insert|upsert|update|delete|rpc|cancel|create|expire)\s*\(/,
    );
    expect(source).not.toContain("checkout_url");
    expect(source).not.toContain("stripe_customer_id");
    expect(source).not.toContain("--apply");
    expect(source).toContain("both the\napex and www versions of /");
    expect(source).toContain("HTTP 200, Cache-Control private");
    expect(source).toContain("with no-store and max-age=0");
    expect(source).toContain("CF-Cache-Status DYNAMIC");
    expect(source).toContain("no positive Age");
    expect(source).toContain("Whenever CHAT_ONLY_DIRECT_SALES_ENABLED=0");
    expect(source).toContain("including --launch-state ready");
    expect(source).toContain("response body, metadata, and JSON-LD");
    expect(source).toContain("Chat Only sale");
    expect(source).toContain("WIDGET_EDGE_ORIGIN_SECRET");
    expect(source).toContain("Railway's generated or custom-domain");
    expect(JSON.parse(packageSource).scripts["audit:chat-only-phase5"]).toBe(
      "node scripts/chat-only-phase5-readiness.mjs",
    );
  });

  it("sanitizes provider identifiers, UUIDs, credentials, URLs, and email", () => {
    const error = new Error(
      `sub_private cus_private price_private ${RAW_SESSION_ID} ${BUSINESS_ID} ` +
        "sk_live_private https://secret.example.test/path jane@example.test " +
        "Bearer bearer-private api_key=plain-private",
    );
    const sanitized = sanitizeLaunchReadinessError(error);

    for (const raw of [
      "sub_private",
      "cus_private",
      "price_private",
      RAW_SESSION_ID,
      BUSINESS_ID,
      "sk_live_private",
      "secret.example.test",
      "jane@example.test",
      "bearer-private",
      "plain-private",
    ]) {
      expect(sanitized).not.toContain(raw);
    }
  });
});

describe("Phase 5 additional read-only database inventory", () => {
  it("paginates only content-free Chat Checkout attempt identity and state", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `${String(index).padStart(8, "0")}-0000-4000-a000-000000000001`,
      business_id: BUSINESS_ID,
      state: "expired",
    }));
    const range = vi.fn(async (start, end) => ({
      data: rows.slice(start, end + 1),
      error: null,
      count: rows.length,
    }));
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range,
    };
    const supabase = { from: vi.fn(() => query) };
    const inherited = { businesses: [], subscriptions: [] };
    const loadPhase4 = vi.fn(async () => inherited);

    const result = await loadPhase5DatabaseState(supabase, config(), {
      loadPhase4,
    });

    expect(result).toEqual({
      ...inherited,
      chatOnlyCheckoutAttempts: rows,
    });
    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(supabase.from).toHaveBeenNthCalledWith(
      1,
      "chat_only_checkout_attempts",
    );
    expect(query.select).toHaveBeenCalledWith("id,business_id,state", {
      count: "exact",
    });
    expect(query.select).toHaveBeenCalledTimes(2);
    expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(query.order).toHaveBeenCalledTimes(2);
    expect(range.mock.calls).toEqual([
      [0, 99],
      [100, 199],
    ]);
  });

  it("fails incomplete on query error or non-array evidence", async () => {
    for (const response of [
      {
        data: null,
        error: { message: "database unavailable" },
        count: null,
      },
      { data: null, error: null, count: 0 },
      { data: [], error: null, count: null },
    ]) {
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(async () => response),
      };
      const supabase = { from: vi.fn(() => query) };
      await expect(
        loadPhase5DatabaseState(supabase, config(), {
          loadPhase4: vi.fn(async () => ({})),
        }),
      ).rejects.toThrow("Failed to read Chat Checkout attempt inventory");
    }
  });

  it("rejects a capped short page or count drift instead of omitting attempts", async () => {
    const oneRow = {
      id: ATTEMPT_ID,
      business_id: BUSINESS_ID,
      state: "open",
    };
    for (const pages of [
      [{ data: [oneRow], error: null, count: 2 }],
      [
        {
          data: Array.from({ length: 100 }, () => oneRow),
          error: null,
          count: 101,
        },
        { data: [oneRow], error: null, count: 102 },
      ],
    ]) {
      let page = 0;
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(async () => pages[page++]),
      };
      const supabase = { from: vi.fn(() => query) };

      await expect(
        loadPhase5DatabaseState(supabase, config(), {
          loadPhase4: vi.fn(async () => ({})),
        }),
      ).rejects.toThrow(
        /(?:page length did not match the exact count|exact count changed)/,
      );
    }
  });
});

describe("Phase 5 launch-readiness analysis", () => {
  it("passes a clean explicit off state with sanitized evidence", () => {
    const report = analyze();

    expect(report).toMatchObject({
      operation: "chat_only_phase5_launch_readiness",
      verdict: "pass",
      launch: {
        requested_state: "off",
        direct_sales_switch: "0",
        direct_sales_enabled: false,
        partner_assignment_switch: "0",
        partner_assignment_enabled: false,
        direct_canary_configured: false,
      },
      contracts: {
        inherited_phase4_inventory_clear: true,
        widget_token_secret_configured: true,
        widget_edge_origin_secret_configured: true,
        pinned_portal_contract_complete: true,
      },
      external_evidence: {
        blocker_inventories_clear: true,
        managed_widget_waf_verified: true,
        cleanup_scheduler_verified: true,
        public_homepage_cache_verified: true,
      },
    });
    expect(report.blockers).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("price_chat");
  });

  it("passes live ready evidence with the broad switch either pre-open or open", () => {
    for (const directSalesSwitchValue of ["0", "1"]) {
      const report = analyze({
        phase4Report: phase4Report({
          targets: {
            stripe_mode: "live",
            stripe_account_ref: "stripe_account_abcdef012345",
            supabase_project_ref: PROJECT_REF,
          },
        }),
        config: config({
          stripeMode: "live",
          launchState: "ready",
          directSalesSwitchValue,
          chatOnlyDirectSalesEnabled: directSalesSwitchValue === "1",
        }),
      });

      expect(report.verdict).toBe("pass");
      expect(report.launch).toMatchObject({
        requested_state: "ready",
        direct_sales_switch: directSalesSwitchValue,
        direct_sales_enabled: directSalesSwitchValue === "1",
      });
    }
  });

  it("turns every explicit negative external attestation into a blocker", () => {
    const report = analyze({
      config: config({
        blockerInventoriesClear: false,
        wafVerified: false,
        schedulerVerified: false,
        homepageCacheVerified: false,
      }),
    });

    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "postmigration_blocker_inventories_not_clear",
        "managed_widget_waf_not_verified",
        "cleanup_scheduler_not_verified",
        "public_homepage_cache_not_verified",
      ]),
    );
    expect(
      report.blockers.find(
        ({ code }) => code === "public_homepage_cache_not_verified",
      )?.message,
    ).toContain("requested-state presentation contract");
  });

  it("blocks creating and open attempts without printing their IDs", () => {
    const report = analyze({
      database: database([
        { id: ATTEMPT_ID, business_id: BUSINESS_ID, state: "creating" },
        {
          id: SECOND_ATTEMPT_ID,
          business_id: BUSINESS_ID,
          state: "open",
        },
        {
          id: "40000000-0000-4000-a000-000000000004",
          business_id: BUSINESS_ID,
          state: "completed",
        },
        {
          id: "50000000-0000-4000-a000-000000000005",
          business_id: BUSINESS_ID,
          state: "expired",
        },
      ]),
    });

    expect(report.verdict).toBe("blocked");
    expect(report.checkout.attempts).toMatchObject({
      total: 4,
      by_state: { creating: 1, open: 1, completed: 1, expired: 1 },
      unresolved: 2,
      malformed: 0,
    });
    expect(report.blockers.map(({ code }) => code)).toContain(
      "chat_checkout_attempts_unresolved",
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(ATTEMPT_ID);
    expect(serialized).not.toContain(SECOND_ATTEMPT_ID);
    expect(serialized).not.toContain(BUSINESS_ID);
  });

  it("fails closed on malformed attempt evidence through stable references", () => {
    const report = analyze({
      database: database([
        {
          id: "malformed-sensitive-attempt",
          business_id: BUSINESS_ID,
          state: "open",
        },
        { id: ATTEMPT_ID, business_id: "bad-business", state: "unknown" },
      ]),
    });

    expect(report.verdict).toBe("blocked");
    expect(report.checkout.attempts).toMatchObject({
      malformed: 2,
      unresolved: 0,
    });
    expect(report.blockers.map(({ code }) => code)).toContain(
      "chat_checkout_attempt_inventory_invalid",
    );
    expect(JSON.stringify(report)).not.toContain(
      "malformed-sensitive-attempt",
    );
  });

  it("independently blocks an inherited open Chat Session", () => {
    const report = analyze({
      phase4Report: phase4Report({
        open_checkout_sessions: {
          total_open: 1,
          by_base_plan: { chat_only: 1 },
          open_chat_only: 1,
          chat_session_refs: ["checkout_0123456789ab"],
        },
      }),
    });

    expect(report.verdict).toBe("blocked");
    expect(report.checkout.open_chat_only_sessions).toBe(1);
    expect(report.blockers.map(({ code }) => code)).toContain(
      "open_chat_checkout_sessions_unresolved",
    );
  });

  it("preserves every inherited blocker and independently verifies contracts", () => {
    const inheritedBlocker = issue();
    const report = analyze({
      phase4Report: phase4Report({
        verdict: "blocked",
        blockers: [inheritedBlocker],
        environment: {
          ...phase4Report().environment,
          widget_token_secret_configured: false,
        },
        chat_only_price: {
          ...phase4Report().chat_only_price,
          contract_satisfied: false,
        },
        stripe_portal: {
          configuration_pinned: true,
          phase4_contract_complete: false,
        },
      }),
      config: config({ widgetEdgeOriginSecretConfigured: false }),
    });

    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "inherited_blocker",
        "chat_only_price_launch_contract_not_verified",
        "widget_secret_launch_contract_not_verified",
        "widget_edge_origin_secret_launch_contract_not_verified",
        "billing_portal_launch_contract_not_verified",
      ]),
    );
  });

  it("treats target, verdict, report shape, or ready-mode contradiction as incomplete", () => {
    expect(() =>
      analyze({
        phase4Report: phase4Report({
          targets: {
            stripe_mode: "live",
            stripe_account_ref: "stripe_account_abcdef012345",
            supabase_project_ref: "other-project",
          },
        }),
      }),
    ).toThrow("target does not match");
    expect(() =>
      analyze({
        phase4Report: phase4Report({ verdict: "blocked" }),
      }),
    ).toThrow("verdict is inconsistent");
    expect(() =>
      analyze({ phase4Report: { operation: "wrong" } }),
    ).toThrow("evidence is incomplete");
    expect(() =>
      analyze({ config: config({ launchState: "ready" }) }),
    ).toThrow("requires live Stripe evidence");
  });

  it("normalizes only the inherited pre-enable direct flag during build", async () => {
    const actualConfig = config({
      stripeMode: "live",
      launchState: "ready",
      directSalesSwitchValue: "1",
      chatOnlyDirectSalesEnabled: true,
    });
    const loaded = database();
    const loadDatabase = vi.fn(async () => loaded);
    const buildPhase4 = vi.fn(async (input) => {
      expect(input.config).toMatchObject({
        chatOnlyDirectSalesEnabled: false,
        chatOnlyPartnerAssignmentEnabled: false,
        chatPriceState: "required",
        widgetSecretState: "required",
        canaryState: "absent",
      });
      await input.loadDatabase();
      return phase4Report({
        targets: {
          stripe_mode: "live",
          stripe_account_ref: "stripe_account_abcdef012345",
          supabase_project_ref: PROJECT_REF,
        },
      });
    });

    const report = await buildLaunchReadinessAudit({
      stripe: {},
      supabase: {},
      config: actualConfig,
      now: NOW,
      loadDatabase,
      buildPhase4,
    });

    expect(report.verdict).toBe("pass");
    expect(report.launch.direct_sales_enabled).toBe(true);
    expect(loadDatabase).toHaveBeenCalledOnce();
    expect(buildPhase4).toHaveBeenCalledOnce();
  });
});
