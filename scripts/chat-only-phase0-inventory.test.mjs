import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  analyzeInventory,
  parseArguments,
  sanitizeError,
  stableRef,
  validateEnvironment,
} from "./chat-only-phase0-inventory.mjs";

const BRYAN_ID = "aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb";
const CAMP_ID = "20000000-0000-4000-a000-000000000002";
const PARTNER_ID = "30000000-0000-4000-a000-000000000003";
const NOW = new Date("2026-08-18T12:00:00.000Z");

function configuration(overrides = {}) {
  return {
    stripeMode: "test",
    projectRef: "example-project",
    planPriceIds: {
      sms_only: "price_starter",
      sms_and_chat: "price_growth",
      full: "price_full",
    },
    portalConfigurationId: "bpc_default",
    chatOnlyDirectSalesEnabled: false,
    chatOnlyPartnerAssignmentEnabled: false,
    telnyxRemoteReleaseEnabled: false,
    ...overrides,
  };
}

function cleanDatabase(overrides = {}) {
  return {
    businesses: [
      {
        id: BRYAN_ID,
        owner_id: "40000000-0000-4000-a000-000000000004",
        name: "Protected business",
        partner_id: null,
        billing_mode: "stripe",
        partner_plan: null,
        deleted_at: null,
        telnyx_resource_state: "protected_hold",
      },
      {
        id: CAMP_ID,
        owner_id: "50000000-0000-4000-a000-000000000005",
        name: "Camp client",
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
        logo_light_url: null,
        logo_dark_url: null,
        favicon_url: null,
        email_from_status: "unconfigured",
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
        id: "80000000-0000-4000-a000-000000000008",
        protection_key: "bryan_develops_retain_all",
        scope: "business_all",
        business_id: BRYAN_ID,
        resource_type: null,
        reason_code: "known_live_production_resource_relationship",
      },
      {
        id: "81000000-0000-4000-a000-000000000008",
        protection_key: "simplassist_live_phone",
        scope: "resource",
        business_id: null,
        resource_type: "phone_number",
        reason_code: "known_live_production_number",
      },
      {
        id: "82000000-0000-4000-a000-000000000008",
        protection_key: "simplassist_live_campaign",
        scope: "resource",
        business_id: null,
        resource_type: "campaign",
        reason_code: "known_live_production_campaign",
      },
      {
        id: "83000000-0000-4000-a000-000000000008",
        protection_key: "simplassist_shared_brand",
        scope: "resource",
        business_id: null,
        resource_type: "brand",
        reason_code: "known_shared_production_brand",
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
        expected_shared_messaging_profile_id: null,
        expected_shared_voice_application_id: null,
        protection_manifest_fingerprint: null,
        protection_manifest_verified_at: null,
        dry_run_completed_at: null,
        single_business_test_completed_at: null,
        authorization_epoch: 1,
      },
    ],
    ...overrides,
  };
}

function stripeSubscriptions() {
  return [
    {
      id: "sub_bryan",
      customer: "cus_bryan",
      status: "active",
      livemode: false,
      metadata: { business_id: BRYAN_ID },
      items: { data: [{ price: { id: "price_starter" } }] },
    },
  ];
}

function portalConfigurations() {
  return [
    {
      id: "bpc_default",
      active: true,
      is_default: true,
      features: {
        subscription_update: { enabled: false, products: [] },
        subscription_cancel: { enabled: false },
      },
    },
  ];
}

describe("Phase 0 inventory CLI safety", () => {
  it("accepts only the two explicit targeting arguments", () => {
    expect(
      parseArguments([
        "--stripe-mode=test",
        "--supabase-project-ref",
        "example-project",
      ])
    ).toEqual({
      help: false,
      stripeMode: "test",
      projectRef: "example-project",
    });
    expect(() => parseArguments(["--apply", "anything"])).toThrow(
      "Unknown argument"
    );
    expect(() => parseArguments(["--stripe-mode", "test"])).toThrow(
      "--supabase-project-ref is required"
    );
  });

  it("validates target/key mode and reads rollout values exact-1 only", () => {
    const result = validateEnvironment(
      { stripeMode: "test", projectRef: "example-project" },
      {
        STRIPE_SECRET_KEY: "sk_test_secret",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://example-project.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
        STRIPE_PRICE_SMS_ONLY: "price_starter",
        STRIPE_PRICE_SMS_AND_CHAT: "price_growth",
        STRIPE_PRICE_FULL: "price_full",
        CHAT_ONLY_DIRECT_SALES_ENABLED: "true",
        CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED: "1",
        TELNYX_REMOTE_RELEASE_ENABLED: "01",
      }
    );

    expect(result).toMatchObject({
      projectRef: "example-project",
      chatOnlyDirectSalesEnabled: false,
      chatOnlyPartnerAssignmentEnabled: true,
      telnyxRemoteReleaseEnabled: false,
    });
    expect(result).not.toHaveProperty("reportSecrets");
  });

  it("contains no database or Stripe mutation call sites", async () => {
    const source = await readFile(
      new URL("./chat-only-phase0-inventory.mjs", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(
      /\.(?:insert|upsert|delete|rpc|cancel|create)\s*\(/
    );
    expect(source.match(/\.update\s*\(/g)).toHaveLength(1);
    expect(source).toContain('createHash("sha256")\n    .update(');
    expect(source).not.toContain("--apply");
    expect(source).not.toContain("Telnyx(");
  });
});

describe("Phase 0 inventory analysis", () => {
  it("passes a reconciled direct/partner/protected baseline without exposing raw IDs", () => {
    const report = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: stripeSubscriptions(),
      portalConfigurations: portalConfigurations(),
      database: cleanDatabase(),
      config: configuration(),
      now: NOW,
    });

    expect(report.verdict).toBe("pass");
    expect(report.blockers).toEqual([]);
    expect(report.authority).toMatchObject({
      businesses: 2,
      by_billing_mode: { comped: 1, stripe: 1 },
      partner_plans: { sms_and_chat: 1 },
      database_subscriptions: 1,
      database_subscription_plans: { sms_only: 1 },
      database_subscription_statuses: { active: 1 },
      stripe_total_subscriptions: 1,
      stripe_subscription_statuses: { active: 1 },
      stripe_nonterminal_subscriptions: 1,
    });
    expect(report.branding.alpha_dog).toMatchObject({
      found: true,
      active_and_connected: true,
      assigned_businesses: 1,
      valid_partner_authority: 1,
    });
    expect(report.telnyx_ledger.phone_provider_namespaces).toEqual({
      numeric_owned_resource: 1,
      legacy_uuid_hold: 0,
      missing: 0,
      invalid: 0,
    });
    expect(report.telnyx_ledger.phone_actions_missing_previous_status).toBe(0);
    expect(report.stripe_portal).toMatchObject({
      configuration_pinned: true,
      active_configurations: 1,
      active_default_configurations: 1,
      configurations: [{ pinned: true }],
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(BRYAN_ID);
    expect(serialized).not.toContain(CAMP_ID);
    expect(serialized).not.toContain("sub_bryan");
    expect(serialized).not.toContain("cus_bryan");
    expect(serialized).not.toContain("123456789");
  });

  it("requires an explicit active Portal configuration pin", () => {
    const missing = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: stripeSubscriptions(),
      portalConfigurations: portalConfigurations(),
      database: cleanDatabase(),
      config: configuration({ portalConfigurationId: null }),
      now: NOW,
    });
    expect(missing.verdict).toBe("blocked");
    expect(missing.blockers.map((blocker) => blocker.code)).toContain(
      "portal_configuration_pin_missing"
    );

    const inactive = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: stripeSubscriptions(),
      portalConfigurations: [
        { ...portalConfigurations()[0], active: false },
      ],
      database: cleanDatabase(),
      config: configuration(),
      now: NOW,
    });
    expect(inactive.verdict).toBe("blocked");
    expect(inactive.blockers.map((blocker) => blocker.code)).toContain(
      "portal_pin_invalid"
    );
    expect(inactive.stripe_portal.configuration_pinned).toBe(false);
  });

  it("blocks cancellation or plan switching on the pinned Portal configuration", () => {
    const report = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: stripeSubscriptions(),
      portalConfigurations: [
        {
          ...portalConfigurations()[0],
          features: {
            subscription_update: {
              enabled: true,
              products: [
                { product: "prod_current", prices: ["price_growth"] },
              ],
            },
            subscription_cancel: { enabled: true },
          },
        },
      ],
      database: cleanDatabase(),
      config: configuration(),
      now: NOW,
    });

    expect(report.verdict).toBe("blocked");
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "pinned_portal_cancellation_enabled",
        "pinned_portal_plan_switching_enabled",
      ])
    );
  });

  it("blocks open rollout, duplicate billing, and due release work", () => {
    const duplicate = {
      ...stripeSubscriptions()[0],
      id: "sub_duplicate",
    };
    const database = cleanDatabase({
      releaseRuns: [
        {
          id: "90000000-0000-4000-a000-000000000009",
          business_id: CAMP_ID,
          status: "release_pending",
          effective_release_at: "2026-08-17T00:00:00.000Z",
          point_of_no_return_at: null,
          last_error_code: null,
        },
      ],
      releaseReasons: [
        {
          run_id: "90000000-0000-4000-a000-000000000009",
          business_id: CAMP_ID,
          reason_type: "subscription_ended",
          status: "active",
          release_at: "2026-08-17T00:00:00.000Z",
        },
      ],
      releaseActions: [
        {
          id: "91000000-0000-4000-a000-000000000009",
          run_id: "90000000-0000-4000-a000-000000000009",
          business_id: CAMP_ID,
          managed_resource_id: null,
          protection_id: null,
          resource_type: "campaign",
          classification: "unverified_hold",
          desired_action: "hold",
          state: "blocked",
          next_retry_at: null,
          last_error_code: "review_required",
        },
      ],
    });

    const report = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: [...stripeSubscriptions(), duplicate],
      portalConfigurations: portalConfigurations(),
      database,
      config: configuration({ chatOnlyDirectSalesEnabled: true }),
      now: NOW,
    });
    const codes = report.blockers.map((blocker) => blocker.code);

    expect(report.verdict).toBe("blocked");
    expect(codes).toEqual(
      expect.arrayContaining([
        "chat_only_direct_rollout_open",
        "duplicate_stripe_business",
        "duplicate_stripe_customer",
        "due_telnyx_release_reasons",
        "due_telnyx_release_actions",
      ])
    );
  });

  it("reports legacy UUID phone identifiers only while held unverified", () => {
    const database = cleanDatabase();
    database.managedResources[0] = {
      ...database.managedResources[0],
      provider_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ownership_state: "unverified_hold",
    };

    const report = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: stripeSubscriptions(),
      portalConfigurations: portalConfigurations(),
      database,
      config: configuration(),
      now: NOW,
    });

    expect(report.verdict).toBe("pass");
    expect(report.telnyx_ledger.phone_provider_namespaces).toMatchObject({
      legacy_uuid_hold: 1,
      invalid: 0,
    });
  });

  it("recognizes a canceled deleted-business subscription as deletion-grace state", () => {
    const database = cleanDatabase();
    database.businesses[0] = {
      ...database.businesses[0],
      deleted_at: "2026-08-01T00:00:00.000Z",
    };
    database.accountDeletionStripeActions = [
      {
        business_id: BRYAN_ID,
        stripe_subscription_id: "sub_bryan",
        desired_action: "pause",
        applied_action: "cancel",
        status: "applied",
        attempt_count: 1,
        applied_at: "2026-08-01T00:00:01.000Z",
        last_error_code: null,
      },
    ];
    const canceled = {
      ...stripeSubscriptions()[0],
      status: "canceled",
    };

    const report = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: [canceled],
      portalConfigurations: portalConfigurations(),
      database,
      config: configuration(),
      now: NOW,
    });

    expect(report.verdict).toBe("pass");
    expect(report.blockers).toEqual([]);
    expect(report.warnings.map((warning) => warning.code)).toContain(
      "deleted_business_subscription_retained_during_grace"
    );
  });

  it("blocks phone release actions that cannot restore their prior status", () => {
    const database = cleanDatabase({
      releaseActions: [
        {
          id: "91000000-0000-4000-a000-000000000009",
          run_id: "90000000-0000-4000-a000-000000000009",
          business_id: CAMP_ID,
          managed_resource_id: null,
          protection_id: null,
          resource_type: "phone_number",
          previous_resource_status: null,
          classification: "unverified_hold",
          desired_action: "hold",
          state: "held",
          next_retry_at: null,
          last_error_code: null,
        },
      ],
    });

    const report = analyzeInventory({
      account: { id: "acct_test" },
      stripeSubscriptions: stripeSubscriptions(),
      portalConfigurations: portalConfigurations(),
      database,
      config: configuration(),
      now: NOW,
    });

    expect(report.verdict).toBe("blocked");
    expect(report.telnyx_ledger.phone_actions_missing_previous_status).toBe(1);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "phone_release_action_previous_status_missing"
    );
  });

  it("sanitizes provider and tenant identifiers in failures", () => {
    expect(
      sanitizeError(
        new Error(
          "failed sub_secret cus_secret bpc_secret price_secret aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb +15742133931"
        )
      )
    ).toBe(
      "failed [stripe_ref] [stripe_ref] [stripe_ref] [stripe_ref] [uuid] [phone]"
    );
    expect(stableRef("business", BRYAN_ID)).toMatch(
      /^business_[0-9a-f]{12}$/
    );
  });
});
