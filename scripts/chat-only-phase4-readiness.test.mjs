import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeReadiness,
  buildReadinessAudit,
  loadPhase4DatabaseState,
  parseArguments,
  sanitizeReadinessError,
  validateEnvironment,
} from "./chat-only-phase4-readiness.mjs";

const BRYAN_ID = "aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb";
const CAMP_ID = "20000000-0000-4000-a000-000000000002";
const PARTNER_ID = "30000000-0000-4000-a000-000000000003";
const CHAT_BUSINESS_ID = "94000000-0000-4000-a000-000000000004";
const NOW = new Date("2026-08-19T12:00:00.000Z");

function environment(overrides = {}) {
  return {
    STRIPE_SECRET_KEY: "sk_test_secret",
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co/",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    STRIPE_PRICE_SMS_ONLY: "price_starter",
    STRIPE_PRICE_SMS_AND_CHAT: "price_growth",
    STRIPE_PRICE_FULL: "price_full",
    STRIPE_PRICE_CHAT_ONLY: "price_chat",
    STRIPE_PRICE_SETUP_FEE: "price_setup",
    STRIPE_PRICE_SMS_OVERAGE_PART: "price_overage",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_default",
    WIDGET_TOKEN_SECRET: "w".repeat(32),
    CHAT_ONLY_DIRECT_SALES_ENABLED: "0",
    CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: "0",
    TELNYX_REMOTE_RELEASE_ENABLED: "0",
    ...overrides,
  };
}

function target(canaryState = "absent", chatPriceState = "required") {
  return {
    stripeMode: "test",
    projectRef: "example-project",
    chatPriceState,
    canaryState,
  };
}

function configuration(overrides = {}) {
  return {
    stripeMode: "test",
    projectRef: "example-project",
    planPriceIds: {
      sms_only: "price_starter",
      sms_and_chat: "price_growth",
      full: "price_full",
      chat_only: "price_chat",
    },
    chatOnlyPriceId: "price_chat",
    chatPriceState: "required",
    canaryState: "absent",
    directCanaryBusinessId: null,
    portalConfigurationId: "bpc_default",
    widgetTokenSecretConfigured: true,
    chatOnlyDirectSalesEnabled: false,
    chatOnlyPartnerAssignmentEnabled: false,
    telnyxRemoteReleaseEnabled: false,
    ...overrides,
  };
}

function prePriceConfiguration(overrides = {}) {
  return configuration({
    planPriceIds: {
      sms_only: "price_starter",
      sms_and_chat: "price_growth",
      full: "price_full",
    },
    chatOnlyPriceId: null,
    chatPriceState: "absent",
    ...overrides,
  });
}

function cleanDatabase(overrides = {}) {
  return {
    businesses: [
      {
        id: BRYAN_ID,
        partner_id: null,
        billing_mode: "stripe",
        partner_plan: null,
        deleted_at: null,
        telnyx_resource_state: "protected_hold",
      },
      {
        id: CAMP_ID,
        partner_id: PARTNER_ID,
        billing_mode: "comped",
        partner_plan: "sms_and_chat",
        deleted_at: null,
        telnyx_resource_state: "active",
      },
    ],
    subscriptions: [
      {
        business_id: BRYAN_ID,
        stripe_customer_id: "cus_bryan",
        stripe_subscription_id: "sub_bryan",
        plan: "sms_only",
        status: "active",
        current_period_start: "2026-08-01T00:00:00.000Z",
        current_period_end: "2026-09-01T00:00:00.000Z",
      },
    ],
    accountDeletionStripeActions: [],
    partners: [
      {
        id: PARTNER_ID,
        name: "Alpha Dog Agency",
        slug: "alpha-dog-agency",
        custom_domain: "portal.example.com",
        domain_status: "connected",
        status: "active",
      },
    ],
    phoneNumbers: [
      {
        id: "60000000-0000-4000-a000-000000000006",
        business_id: BRYAN_ID,
        telnyx_phone_number_id: "123456789",
        is_active: true,
        resource_status: "protected_hold",
      },
    ],
    managedResources: [
      {
        id: "70000000-0000-4000-a000-000000000007",
        business_id: BRYAN_ID,
        phone_number_id: "60000000-0000-4000-a000-000000000006",
        resource_type: "phone_number",
        provider_id: "123456789",
        provider_origin: "created_by_simplassist",
        ownership_state: "unverified_hold",
        local_claim_active: true,
      },
    ],
    protections: [
      {
        protection_key: "bryan_develops_retain_all",
        scope: "business_all",
        business_id: BRYAN_ID,
        resource_type: null,
      },
      {
        protection_key: "simplassist_live_phone",
        scope: "resource",
        business_id: null,
        resource_type: "phone_number",
      },
      {
        protection_key: "simplassist_live_campaign",
        scope: "resource",
        business_id: null,
        resource_type: "campaign",
      },
      {
        protection_key: "simplassist_shared_brand",
        scope: "resource",
        business_id: null,
        resource_type: "brand",
      },
    ],
    releaseRuns: [],
    releaseReasons: [],
    releaseActions: [],
    releaseConfig: [
      {
        id: 1,
        mode: "disabled",
        single_business_id: null,
        protection_manifest_verified_at: null,
        dry_run_completed_at: null,
      },
    ],
    businessPlanFamilyLocks: [],
    chatOnlyCheckoutAttempts: [],
    ...overrides,
  };
}

function starterSubscription() {
  return {
    id: "sub_bryan",
    customer: "cus_bryan",
    status: "active",
    livemode: false,
    metadata: { business_id: BRYAN_ID, plan: "sms_only" },
    items: {
      data: [{ id: "si_starter", price: { id: "price_starter" }, quantity: 1 }],
    },
  };
}

function chatSubscription(overrides = {}) {
  return {
    id: "sub_chat_canary",
    customer: "cus_chat_canary",
    status: "active",
    livemode: false,
    metadata: { business_id: CHAT_BUSINESS_ID, plan: "chat_only" },
    items: {
      data: [{ id: "si_chat", price: { id: "price_chat" }, quantity: 1 }],
    },
    ...overrides,
  };
}

function chatOnlyPrice(overrides = {}) {
  return {
    id: "price_chat",
    livemode: false,
    active: true,
    type: "recurring",
    currency: "usd",
    unit_amount: 1_000,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
    ...overrides,
  };
}

function portalConfigurations(overrides = {}) {
  return [
    {
      id: "bpc_default",
      active: true,
      is_default: true,
      features: {
        subscription_update: { enabled: false, products: [] },
        subscription_cancel: { enabled: false },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
      },
      ...overrides,
    },
  ];
}

function disposableBusiness(overrides = {}) {
  return {
    id: CHAT_BUSINESS_ID,
    owner_id: "95000000-0000-4000-a000-000000000005",
    partner_id: null,
    billing_mode: "stripe",
    partner_plan: null,
    billing_pilot: false,
    billing_comped: false,
    billing_exempt: false,
    deleted_at: null,
    operations_suspended_at: null,
    telnyx_brand_id: null,
    telnyx_campaign_id: null,
    telnyx_messaging_profile_id: null,
    telnyx_voice_application_id: null,
    active_telnyx_release_run_id: null,
    telnyx_resource_state: "provisioning",
    ...overrides,
  };
}

function chatDatabase() {
  const database = cleanDatabase();
  database.businesses.push(disposableBusiness());
  database.subscriptions.push({
    business_id: CHAT_BUSINESS_ID,
    stripe_customer_id: "cus_chat_canary",
    stripe_subscription_id: "sub_chat_canary",
    plan: "chat_only",
    status: "active",
    current_period_start: "2026-08-01T00:00:00.000Z",
    current_period_end: "2026-09-01T00:00:00.000Z",
  });
  return database;
}

function analyze(overrides = {}) {
  return analyzeReadiness({
    account: { id: "acct_test" },
    stripeSubscriptions: [starterSubscription()],
    portalConfigurations: portalConfigurations(),
    chatOnlyPrice: chatOnlyPrice(),
    openCheckoutSessions: [],
    database: cleanDatabase(),
    config: configuration(),
    now: NOW,
    ...overrides,
  });
}

describe("Phase 4 readiness CLI safety", () => {
  it("requires explicit targets, four distinct Prices, and exact pre-enable switches", () => {
    expect(
      parseArguments([
        "--stripe-mode=test",
        "--supabase-project-ref",
        "example-project",
        "--chat-price-state=required",
        "--canary-state=absent",
      ])
    ).toEqual({
      help: false,
      stripeMode: "test",
      projectRef: "example-project",
      chatPriceState: "required",
      canaryState: "absent",
    });
    expect(() =>
      parseArguments([
        "--stripe-mode=test",
        "--supabase-project-ref=example-project",
        "--chat-price-state=required",
      ])
    ).toThrow("--canary-state must be exactly absent or required");
    expect(() =>
      parseArguments([
        "--stripe-mode=test",
        "--supabase-project-ref=example-project",
        "--canary-state=absent",
      ])
    ).toThrow("--chat-price-state must be exactly absent or required");
    expect(() =>
      parseArguments([
        "--stripe-mode=test",
        "--supabase-project-ref=example-project",
        "--chat-price-state=required",
        "--canary-state=optional",
      ])
    ).toThrow("--canary-state must be exactly absent or required");
    expect(() => parseArguments(["--apply", "anything"])).toThrow(
      "Unknown argument"
    );

    const result = validateEnvironment(target(), environment());
    expect(result).toMatchObject({
      planPriceIds: { chat_only: "price_chat" },
      chatOnlyDirectSalesEnabled: false,
      chatOnlyPartnerAssignmentEnabled: false,
      telnyxRemoteReleaseEnabled: false,
      widgetTokenSecretConfigured: true,
    });
    expect(result).not.toHaveProperty("widgetTokenSecret");
  });

  it("requires an exact independent Chat Price state", () => {
    const absent = validateEnvironment(
      target("absent", "absent"),
      environment({ STRIPE_PRICE_CHAT_ONLY: undefined })
    );
    expect(absent).toMatchObject({
      chatPriceState: "absent",
      chatOnlyPriceId: null,
      planPriceIds: {
        sms_only: "price_starter",
        sms_and_chat: "price_growth",
        full: "price_full",
      },
    });
    expect(absent.planPriceIds).not.toHaveProperty("chat_only");

    expect(() =>
      validateEnvironment(
        target("absent", "absent"),
        environment({ STRIPE_PRICE_CHAT_ONLY: "price_chat" })
      )
    ).toThrow("must be unset or empty");
    expect(() =>
      validateEnvironment(
        target("absent", "absent"),
        environment({ STRIPE_PRICE_CHAT_ONLY: " " })
      )
    ).toThrow("must be unset or empty");
    expect(() =>
      validateEnvironment(
        { ...target(), chatPriceState: "optional" },
        environment()
      )
    ).toThrow("--chat-price-state must be exactly absent or required");
    expect(() =>
      validateEnvironment(
        target("required", "absent"),
        environment({ STRIPE_PRICE_CHAT_ONLY: undefined })
      )
    ).toThrow("--canary-state required requires --chat-price-state required");
  });

  it("distinguishes an open switch from malformed fail-closed spelling", () => {
    const enabled = validateEnvironment(
      target(),
      environment({ CHAT_ONLY_DIRECT_SALES_ENABLED: "1" })
    );
    expect(enabled.chatOnlyDirectSalesEnabled).toBe(true);

    expect(() =>
      validateEnvironment(
        target(),
        environment({ CHAT_ONLY_DIRECT_SALES_ENABLED: "true" })
      )
    ).toThrow("must be unset, exact 0, or exact 1");
    expect(() =>
      validateEnvironment(
        target(),
        environment({ CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: " 0" })
      )
    ).toThrow("must be unset, exact 0, or exact 1");
  });

  it("rejects missing, colliding, public, or short canary configuration", () => {
    const arguments_ = target();
    expect(() =>
      validateEnvironment(arguments_, environment({ STRIPE_PRICE_CHAT_ONLY: "" }))
    ).toThrow("STRIPE_PRICE_CHAT_ONLY is required");
    expect(() =>
      validateEnvironment(
        arguments_,
        environment({ STRIPE_PRICE_CHAT_ONLY: "price_starter" })
      )
    ).toThrow("four Stripe base-plan Price IDs must be unique");
    expect(() =>
      validateEnvironment(
        arguments_,
        environment({ STRIPE_PRICE_CHAT_ONLY: "price_setup" })
      )
    ).toThrow("must not match another configured Stripe Price ID");
    expect(() =>
      validateEnvironment(
        arguments_,
        environment({ NEXT_PUBLIC_WIDGET_TOKEN_SECRET: "exposed" })
      )
    ).toThrow("must remain server-only");
    expect(() =>
      validateEnvironment(
        arguments_,
        environment({
          NEXT_PUBLIC_CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: CHAT_BUSINESS_ID,
        })
      )
    ).toThrow("must remain server-only");
    expect(() =>
      validateEnvironment(arguments_, environment({ WIDGET_TOKEN_SECRET: "short" }))
    ).toThrow("at least 32 bytes");
  });

  it("accepts one exact stage-required canary and rejects padded or multi-value input", () => {
    const arguments_ = target("required");
    expect(
      validateEnvironment(
        arguments_,
        environment({ CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: CHAT_BUSINESS_ID })
      ).directCanaryBusinessId
    ).toBe(CHAT_BUSINESS_ID);
    expect(
      validateEnvironment(
        arguments_,
        environment({ CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: "" })
      ).directCanaryBusinessId
    ).toBeNull();
    for (const malformed of [
      ` ${CHAT_BUSINESS_ID}`,
      `${CHAT_BUSINESS_ID} `,
      `${CHAT_BUSINESS_ID},${BRYAN_ID}`,
      "business-1",
    ]) {
      expect(() =>
        validateEnvironment(
          arguments_,
          environment({ CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID: malformed })
        )
      ).toThrow("one exact canonical UUID");
    }
  });

  it("contains no database, Stripe, Checkout, or Telnyx mutation call sites", async () => {
    const phase0Source = await readFile(
      new URL("./chat-only-phase0-inventory.mjs", import.meta.url),
      "utf8"
    );
    const phase4Source = await readFile(
      new URL("./chat-only-phase4-readiness.mjs", import.meta.url),
      "utf8"
    );
    const combined = `${phase0Source}\n${phase4Source}`;

    expect(combined).not.toMatch(
      /\.(?:insert|upsert|delete|rpc|cancel|create|expire)\s*\(/
    );
    expect(phase0Source.match(/\.update\s*\(/g)).toHaveLength(1);
    expect(phase4Source).not.toMatch(/\.update\s*\(/);
    expect(phase0Source).toContain('.from(table)\n      .select(columns)');
    expect(phase4Source).toContain("stripe.prices.retrieve");
    expect(phase4Source).toContain("stripe.checkout.sessions.list");
    expect(phase4Source).toContain("listLineItems");
    expect(combined).not.toContain("--apply");
    expect(combined).not.toContain("Telnyx(");
  });
});

describe("Phase 4 readiness analysis", () => {
  it("passes an explicit clean Stage A pre-Price baseline", () => {
    const report = analyze({
      chatOnlyPrice: null,
      config: prePriceConfiguration(),
    });

    expect(report.verdict).toBe("pass");
    expect(report.environment.chat_price_state).toBe("absent");
    expect(report.chat_only_price).toEqual({
      ref: null,
      configured: false,
      mode_matches: null,
      active: null,
      recurring: null,
      usd_1000: null,
      monthly_interval: null,
      licensed: null,
      contract_satisfied: null,
    });
  });

  it("blocks any Chat-shaped subscription in the pre-Price baseline", () => {
    const report = analyze({
      chatOnlyPrice: null,
      config: prePriceConfiguration(),
      stripeSubscriptions: [
        starterSubscription(),
        chatSubscription({ status: "canceled" }),
      ],
    });

    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(
      "pre_price_chat_subscription_evidence_present"
    );
    expect(report.chat_only_subscriptions).toMatchObject({
      total_matching: 1,
      nonterminal: 0,
    });
  });

  it("blocks a marker-shaped open Checkout in the pre-Price baseline", () => {
    const report = analyze({
      chatOnlyPrice: null,
      config: prePriceConfiguration(),
      openCheckoutSessions: [
        {
          id: "cs_test_pre_price_marker",
          status: "open",
          mode: "subscription",
          livemode: false,
          metadata: {
            business_id: CHAT_BUSINESS_ID,
            checkout_attempt_id: "97000000-0000-4000-a000-000000000007",
          },
          lineItems: [
            { id: "li_unknown", price: { id: "price_unknown" }, quantity: 1 },
          ],
        },
      ],
    });

    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(
      "pre_price_chat_checkout_evidence_present"
    );
    expect(report.open_checkout_sessions.open_chat_only).toBe(1);
    expect(JSON.stringify(report)).not.toContain("cs_test_pre_price_marker");
  });

  it("passes a clean pre-enable baseline and exposes only sanitized evidence", () => {
    const report = analyze();

    expect(report.verdict).toBe("pass");
    expect(report.blockers).toEqual([]);
    expect(report.operation).toBe("chat_only_phase4_readiness");
    expect(report.chat_only_price).toMatchObject({
      configured: true,
      contract_satisfied: true,
    });
    expect(report.open_checkout_sessions).toEqual({
      total_open: 0,
      by_base_plan: {},
      open_chat_only: 0,
      chat_session_refs: [],
    });

    const serialized = JSON.stringify(report);
    for (const raw of [
      BRYAN_ID,
      CAMP_ID,
      "sub_bryan",
      "cus_bryan",
      "price_chat",
      "123456789",
    ]) {
      expect(serialized).not.toContain(raw);
    }
  });

  it("recognizes and reconciles an existing direct Chat Only canary", () => {
    const report = analyze({
      stripeSubscriptions: [starterSubscription(), chatSubscription()],
      database: chatDatabase(),
    });

    expect(report.verdict).toBe("pass");
    expect(report.authority.database_subscription_plans).toEqual({
      chat_only: 1,
      sms_only: 1,
    });
    expect(report.authority.stripe_nonterminal_plans).toEqual({
      chat_only: 1,
      sms_only: 1,
    });
    expect(report.chat_only_subscriptions).toMatchObject({ nonterminal: 1 });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(CHAT_BUSINESS_ID);
    expect(serialized).not.toContain("sub_chat_canary");
    expect(serialized).not.toContain("cus_chat_canary");
  });

  it("reports an exact eligible canary only through a stable reference", () => {
    const database = cleanDatabase();
    database.businesses.push(disposableBusiness());
    const report = analyze({
      database,
      config: configuration({
        canaryState: "required",
        directCanaryBusinessId: CHAT_BUSINESS_ID,
      }),
    });

    expect(report.verdict).toBe("pass");
    expect(report.environment.direct_canary).toMatchObject({
      configured: true,
      eligible: true,
      expected_state: "required",
      ref: expect.stringMatching(/^business_[0-9a-f]{12}$/),
    });
    expect(JSON.stringify(report)).not.toContain(CHAT_BUSINESS_ID);
  });

  it("rejects a required canary with any existing local subscription", () => {
    for (const subscription of [
      { plan: "sms_only", status: "active" },
      { plan: "chat_only", status: "active" },
      { plan: "chat_only", status: "canceled" },
    ]) {
      const database = cleanDatabase();
      database.businesses.push(disposableBusiness());
      database.subscriptions.push({
        business_id: CHAT_BUSINESS_ID,
        stripe_customer_id: "cus_canary_history",
        stripe_subscription_id: "sub_canary_history",
        current_period_start: null,
        current_period_end: null,
        ...subscription,
      });
      const report = analyze({
        database,
        config: configuration({
          canaryState: "required",
          directCanaryBusinessId: CHAT_BUSINESS_ID,
        }),
      });
      expect(report.environment.direct_canary.eligible).toBe(false);
      expect(report.blockers.map(({ code }) => code)).toContain(
        "direct_canary_business_ineligible"
      );
    }
  });

  it("accepts no family lock or a Chat lock but rejects an SMS lock", () => {
    for (const [family, expected] of [
      [null, true],
      ["chat_only", true],
      ["sms", false],
    ]) {
      const database = cleanDatabase();
      database.businesses.push(disposableBusiness());
      if (family) {
        database.businessPlanFamilyLocks.push({
          business_id: CHAT_BUSINESS_ID,
          family,
        });
      }
      const report = analyze({
        database,
        config: configuration({
          canaryState: "required",
          directCanaryBusinessId: CHAT_BUSINESS_ID,
        }),
      });
      expect(report.environment.direct_canary.eligible).toBe(expected);
    }
  });

  it("allows only pure expired unbound Checkout history for a required canary", () => {
    for (const [attempt, expected] of [
      [{ state: "expired", stripe_subscription_id: null }, true],
      [{ state: "creating", stripe_subscription_id: null }, false],
      [{ state: "open", stripe_subscription_id: null }, false],
      [{ state: "completed", stripe_subscription_id: "sub_paid" }, false],
      [{ state: "expired", stripe_subscription_id: "sub_bound" }, false],
      [{ state: "expired" }, false],
      [{ state: "unknown", stripe_subscription_id: null }, false],
    ]) {
      const database = cleanDatabase();
      database.businesses.push(disposableBusiness());
      database.chatOnlyCheckoutAttempts.push({
        business_id: CHAT_BUSINESS_ID,
        ...attempt,
      });
      const report = analyze({
        database,
        config: configuration({
          canaryState: "required",
          directCanaryBusinessId: CHAT_BUSINESS_ID,
        }),
      });
      expect(report.environment.direct_canary.eligible).toBe(expected);
    }
  });

  it("fails incomplete when required-canary durable evidence was not loaded", () => {
    const database = cleanDatabase();
    database.businesses.push(disposableBusiness());
    delete database.businessPlanFamilyLocks;
    delete database.chatOnlyCheckoutAttempts;
    expect(() =>
      analyze({
        database,
        config: configuration({
          canaryState: "required",
          directCanaryBusinessId: CHAT_BUSINESS_ID,
        }),
      })
    ).toThrow("family-lock or Checkout-attempt evidence was not loaded");
  });

  it("enforces the explicit absent and required canary stages", () => {
    const database = cleanDatabase();
    database.businesses.push(disposableBusiness());

    const unexpected = analyze({
      database,
      config: configuration({ directCanaryBusinessId: CHAT_BUSINESS_ID }),
    });
    expect(unexpected.verdict).toBe("blocked");
    expect(unexpected.environment.direct_canary).toMatchObject({
      expected_state: "absent",
      configured: true,
      eligible: null,
    });
    expect(unexpected.blockers.map(({ code }) => code)).toContain(
      "direct_canary_unexpected_for_absent_stage"
    );

    const missing = analyze({
      config: configuration({ canaryState: "required" }),
    });
    expect(missing.verdict).toBe("blocked");
    expect(missing.environment.direct_canary).toEqual({
      expected_state: "required",
      configured: false,
      ref: null,
      eligible: null,
    });
    expect(missing.blockers.map(({ code }) => code)).toContain(
      "direct_canary_configuration_missing"
    );

    expect(JSON.stringify(unexpected)).not.toContain(CHAT_BUSINESS_ID);
  });

  it.each([
    ["missing", cleanDatabase()],
    [
      "partner-linked",
      (() => {
        const database = cleanDatabase();
        database.businesses.push(disposableBusiness({
          partner_id: PARTNER_ID,
          billing_mode: "comped",
          partner_plan: "chat_only",
        }));
        return database;
      })(),
    ],
    [
      "SMS-bearing",
      (() => {
        const database = cleanDatabase();
        database.businesses.push(disposableBusiness({
          telnyx_resource_state: "active",
        }));
        database.phoneNumbers.push({
          id: "96000000-0000-4000-a000-000000000006",
          business_id: CHAT_BUSINESS_ID,
          resource_status: "active",
        });
        return database;
      })(),
    ],
    [
      "active Telnyx state",
      (() => {
        const database = cleanDatabase();
        database.businesses.push(
          disposableBusiness({ telnyx_resource_state: "active" })
        );
        return database;
      })(),
    ],
    [
      "billing-override",
      (() => {
        const database = cleanDatabase();
        database.businesses.push(disposableBusiness({ billing_exempt: true }));
        return database;
      })(),
    ],
  ])("blocks a %s configured canary", (_label, database) => {
    const report = analyze({
      database,
      config: configuration({
        canaryState: "required",
        directCanaryBusinessId: CHAT_BUSINESS_ID,
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.environment.direct_canary.eligible).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^direct_canary_business_(?:missing|ineligible)$/),
      ])
    );
    expect(JSON.stringify(report)).not.toContain(CHAT_BUSINESS_ID);
  });

  it.each([
    ["inactive", { active: false }],
    ["wrong mode", { livemode: true }],
    ["wrong amount", { unit_amount: 999 }],
    ["wrong currency", { currency: "cad" }],
    ["not recurring", { type: "one_time", recurring: null }],
    [
      "wrong interval",
      {
        recurring: {
          interval: "year",
          interval_count: 1,
          usage_type: "licensed",
        },
      },
    ],
    [
      "metered",
      {
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "metered",
        },
      },
    ],
  ])("blocks a %s Chat Only Price", (_label, priceOverrides) => {
    const report = analyze({ chatOnlyPrice: chatOnlyPrice(priceOverrides) });
    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(
      "chat_only_price_contract_invalid"
    );
    expect(report.chat_only_price.contract_satisfied).toBe(false);
  });

  it("blocks pinned Portal switching or cancellation", () => {
    const report = analyze({
      portalConfigurations: portalConfigurations({
        features: {
          subscription_update: {
            enabled: true,
            products: [{ product: "prod_chat", prices: ["price_chat"] }],
          },
          subscription_cancel: { enabled: true },
        },
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.stripe_portal.phase4_contract_complete).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "pinned_portal_plan_switching_enabled",
        "pinned_portal_cancellation_enabled",
      ])
    );
  });

  it("blocks incomplete pinned Portal feature evidence", () => {
    const report = analyze({
      portalConfigurations: portalConfigurations({ features: {} }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.stripe_portal.phase4_contract_complete).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toContain(
      "pinned_portal_contract_incomplete"
    );
  });

  it.each([
    ["invoice history", "invoice_history"],
    ["payment-method updates", "payment_method_update"],
  ])("blocks a pinned Portal with disabled %s", (_label, feature) => {
    const features = portalConfigurations()[0].features;
    const report = analyze({
      portalConfigurations: portalConfigurations({
        features: {
          ...features,
          [feature]: { enabled: false },
        },
      }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.stripe_portal.phase4_contract_complete).toBe(false);
    expect(report.blockers.map(({ code }) => code)).toContain(
      "pinned_portal_required_access_invalid"
    );
  });

  it("sanitizes and blocks every open Chat Only Checkout", () => {
    const report = analyze({
      openCheckoutSessions: [
        {
          id: "cs_test_open_chat_secret",
          status: "open",
          mode: "subscription",
          livemode: false,
          metadata: {
            business_id: CHAT_BUSINESS_ID,
            plan: "chat_only",
          },
          lineItems: [
            { id: "li_chat", price: { id: "price_chat" }, quantity: 1 },
          ],
        },
      ],
    });

    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(
      "open_chat_checkout_sessions"
    );
    expect(report.open_checkout_sessions).toMatchObject({
      total_open: 1,
      by_base_plan: { chat_only: 1 },
      open_chat_only: 1,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("cs_test_open_chat_secret");
    expect(serialized).not.toContain(CHAT_BUSINESS_ID);
  });

  it("allows a well-formed non-Chat open Checkout but blocks unknown evidence", () => {
    const smsSession = {
      id: "cs_test_open_sms",
      status: "open",
      mode: "subscription",
      livemode: false,
      metadata: { business_id: BRYAN_ID, plan: "sms_only" },
      lineItems: [
        { id: "li_sms", price: { id: "price_starter" }, quantity: 1 },
        { id: "li_setup", price: { id: "price_setup" }, quantity: 1 },
      ],
    };
    expect(analyze({ openCheckoutSessions: [smsSession] }).verdict).toBe(
      "pass"
    );

    const unknown = analyze({
      openCheckoutSessions: [
        {
          ...smsSession,
          id: "cs_test_unknown",
          lineItems: [{ id: "li_unknown", price: null, quantity: 1 }],
        },
      ],
    });
    expect(unknown.verdict).toBe("blocked");
    expect(unknown.blockers.map(({ code }) => code)).toContain(
      "open_checkout_line_items_incomplete"
    );
  });

  it("still inventories metadata-declared Chat Checkout with incomplete items", () => {
    const report = analyze({
      openCheckoutSessions: [
        {
          id: "cs_test_incomplete_chat",
          status: "open",
          mode: "subscription",
          livemode: false,
          metadata: { business_id: CHAT_BUSINESS_ID, plan: "chat_only" },
          lineItems: [],
        },
      ],
    });
    expect(report.verdict).toBe("blocked");
    expect(report.open_checkout_sessions.open_chat_only).toBe(1);
    expect(report.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "open_checkout_line_items_incomplete",
        "open_chat_checkout_sessions",
      ])
    );
  });

  it("blocks malformed Chat subscription item or metadata evidence", () => {
    const malformed = chatSubscription({
      metadata: { business_id: CHAT_BUSINESS_ID, plan: "chat_only" },
      items: {
        data: [
          { id: "si_chat", price: { id: "price_chat" }, quantity: 2 },
        ],
      },
    });
    const report = analyze({
      stripeSubscriptions: [starterSubscription(), malformed],
      database: chatDatabase(),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(
      "chat_only_subscription_item_shape_invalid"
    );
  });

  it("blocks an exact open broad switch in the completed report", () => {
    const report = analyze({
      config: configuration({ chatOnlyDirectSalesEnabled: true }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(
      "chat_only_direct_rollout_open"
    );
  });

  it("still inventories Price-proven Chat Checkout with malformed session evidence", () => {
    const report = analyze({
      openCheckoutSessions: [
        {
          id: "cs_test_wrong_mode_chat",
          status: "open",
          mode: "payment",
          livemode: false,
          metadata: {},
          lineItems: [
            { id: "li_chat", price: { id: "price_chat" }, quantity: 1 },
          ],
        },
      ],
    });
    expect(report.verdict).toBe("blocked");
    expect(report.open_checkout_sessions.open_chat_only).toBe(1);
    expect(report.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "open_checkout_shape_invalid",
        "open_chat_checkout_sessions",
      ])
    );
    expect(JSON.stringify(report)).not.toContain("cs_test_wrong_mode_chat");
  });

  it.each([
    ["chatOnlyPartnerAssignmentEnabled", "chat_only_partner_rollout_open"],
    ["telnyxRemoteReleaseEnabled", "telnyx_remote_release_open"],
  ])("blocks exact open %s", (configKey, blockerCode) => {
    const report = analyze({
      config: configuration({ [configKey]: true }),
    });
    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map(({ code }) => code)).toContain(blockerCode);
  });

  it("treats malformed aggregate input as incomplete rather than a pass", () => {
    expect(() => analyze({ openCheckoutSessions: null })).toThrow(
      "was not an array"
    );
    expect(() =>
      analyze({ config: configuration({ canaryState: undefined }) })
    ).toThrow("Canary readiness state is missing or invalid");
  });
});

describe("Phase 4 readiness provider reads", () => {
  it("does not query migration-064 evidence for pre-canary stages", async () => {
    const baseline = cleanDatabase();
    const supabase = { from: vi.fn() };
    const result = await loadPhase4DatabaseState(
      supabase,
      configuration({
        chatPriceState: "absent",
        chatOnlyPriceId: null,
        canaryState: "absent",
      }),
      { loadBaseline: vi.fn().mockResolvedValue(baseline) }
    );

    expect(result).toBe(baseline);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("reads exact family-lock and attempt evidence for the required canary", async () => {
    const calls = [];
    const rows = {
      business_plan_family_locks: [
        { business_id: CHAT_BUSINESS_ID, family: "chat_only" },
      ],
      chat_only_checkout_attempts: [
        {
          business_id: CHAT_BUSINESS_ID,
          state: "expired",
          stripe_subscription_id: null,
        },
      ],
    };
    const supabase = {
      from: vi.fn((table) => {
        const call = { table };
        calls.push(call);
        const query = {
          select: vi.fn((columns) => {
            call.columns = columns;
            return query;
          }),
          eq: vi.fn((column, value) => {
            call.eq = [column, value];
            return query;
          }),
          order: vi.fn((column, options) => {
            call.order = [column, options];
            return query;
          }),
          range: vi.fn(async (from, to) => {
            call.range = [from, to];
            return { data: rows[table], error: null };
          }),
        };
        return query;
      }),
    };
    const result = await loadPhase4DatabaseState(
      supabase,
      configuration({
        canaryState: "required",
        directCanaryBusinessId: CHAT_BUSINESS_ID,
      }),
      { loadBaseline: vi.fn().mockResolvedValue(cleanDatabase()) }
    );

    expect(calls).toEqual([
      {
        table: "business_plan_family_locks",
        columns: "business_id, family",
        eq: ["business_id", CHAT_BUSINESS_ID],
        order: ["business_id", { ascending: true }],
        range: [0, 99],
      },
      {
        table: "chat_only_checkout_attempts",
        columns: "business_id, state, stripe_subscription_id",
        eq: ["business_id", CHAT_BUSINESS_ID],
        order: ["id", { ascending: true }],
        range: [0, 99],
      },
    ]);
    expect(result.businessPlanFamilyLocks).toEqual(
      rows.business_plan_family_locks
    );
    expect(result.chatOnlyCheckoutAttempts).toEqual(
      rows.chat_only_checkout_attempts
    );
  });

  it("skips the exact Chat Price retrieve in absent state", async () => {
    const stripe = {
      accounts: { retrieve: vi.fn().mockResolvedValue({ id: "acct_test" }) },
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [starterSubscription()],
          has_more: false,
        }),
      },
      billingPortal: {
        configurations: {
          list: vi.fn().mockResolvedValue({
            data: portalConfigurations(),
            has_more: false,
          }),
        },
      },
      prices: { retrieve: vi.fn() },
      checkout: {
        sessions: {
          list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
          listLineItems: vi.fn(),
        },
      },
    };
    const report = await buildReadinessAudit({
      stripe,
      supabase: {},
      config: prePriceConfiguration(),
      now: NOW,
      loadDatabase: vi.fn().mockResolvedValue(cleanDatabase()),
    });

    expect(report.verdict).toBe("pass");
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
  });

  it("uses only paginated reads and retrieves the exact Chat Price", async () => {
    const stripe = {
      accounts: { retrieve: vi.fn().mockResolvedValue({ id: "acct_test" }) },
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [starterSubscription()],
          has_more: false,
        }),
      },
      billingPortal: {
        configurations: {
          list: vi.fn().mockResolvedValue({
            data: portalConfigurations(),
            has_more: false,
          }),
        },
      },
      prices: { retrieve: vi.fn().mockResolvedValue(chatOnlyPrice()) },
      checkout: {
        sessions: {
          list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
          listLineItems: vi.fn(),
        },
      },
    };
    const report = await buildReadinessAudit({
      stripe,
      supabase: {},
      config: configuration(),
      now: NOW,
      loadDatabase: vi.fn().mockResolvedValue(cleanDatabase()),
    });

    expect(report.verdict).toBe("pass");
    expect(stripe.prices.retrieve).toHaveBeenCalledWith("price_chat");
    expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
      status: "open",
      limit: 100,
    });
    expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
  });

  it("reads line items for every open Session before classifying Chat", async () => {
    const openSession = {
      id: "cs_test_provider_chat",
      status: "open",
      mode: "subscription",
      livemode: false,
      metadata: { business_id: CHAT_BUSINESS_ID, plan: "chat_only" },
    };
    const stripe = {
      accounts: { retrieve: vi.fn().mockResolvedValue({ id: "acct_test" }) },
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [starterSubscription()],
          has_more: false,
        }),
      },
      billingPortal: {
        configurations: {
          list: vi.fn().mockResolvedValue({
            data: portalConfigurations(),
            has_more: false,
          }),
        },
      },
      prices: { retrieve: vi.fn().mockResolvedValue(chatOnlyPrice()) },
      checkout: {
        sessions: {
          list: vi.fn().mockResolvedValue({
            data: [openSession],
            has_more: false,
          }),
          listLineItems: vi.fn().mockResolvedValue({
            data: [
              { id: "li_chat", price: { id: "price_chat" }, quantity: 1 },
            ],
            has_more: false,
          }),
        },
      },
    };
    const report = await buildReadinessAudit({
      stripe,
      supabase: {},
      config: configuration(),
      now: NOW,
      loadDatabase: vi.fn().mockResolvedValue(cleanDatabase()),
    });

    expect(report.verdict).toBe("blocked");
    expect(report.open_checkout_sessions.open_chat_only).toBe(1);
    expect(stripe.checkout.sessions.listLineItems).toHaveBeenCalledWith(
      "cs_test_provider_chat",
      { limit: 100 }
    );
    expect(JSON.stringify(report)).not.toContain("cs_test_provider_chat");
  });

  it("fails incomplete when Stripe pagination cannot prove completeness", async () => {
    const stripe = {
      accounts: { retrieve: vi.fn().mockResolvedValue({ id: "acct_test" }) },
      subscriptions: {
        list: vi.fn().mockResolvedValue({ data: [], has_more: undefined }),
      },
      billingPortal: {
        configurations: {
          list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
        },
      },
      prices: { retrieve: vi.fn().mockResolvedValue(chatOnlyPrice()) },
      checkout: {
        sessions: {
          list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
          listLineItems: vi.fn(),
        },
      },
    };
    await expect(
      buildReadinessAudit({
        stripe,
        supabase: {},
        config: configuration(),
        now: NOW,
        loadDatabase: vi.fn().mockResolvedValue(cleanDatabase()),
      })
    ).rejects.toThrow("invalid page");
  });
});

describe("Phase 4 readiness sanitization", () => {
  it("removes provider references, credentials, tenants, phones, and email", () => {
    expect(
      sanitizeReadinessError(
        new Error(
          "failed cs_test_secret acct_secret sk_test_abc sub_secret " +
            `${CHAT_BUSINESS_ID} +15742133931 owner@example.com ` +
            "https://checkout.stripe.com/c/pay/session-secret"
        )
      )
    ).toBe(
      "failed [provider_ref] [provider_ref] [secret] [stripe_ref] " +
        "[uuid] [phone] [email] [url]"
    );
  });
});
