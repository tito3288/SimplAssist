#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  analyzeInventory as analyzeBaselineInventory,
  loadDatabaseState,
  parseArguments as parseTargetArguments,
  sanitizeError as sanitizeBaselineError,
  stableRef,
  validateEnvironment as validateBaselineEnvironment,
} from "./chat-only-phase0-inventory.mjs";

const STRIPE_API_VERSION = "2026-02-25.clover";
const PAGE_SIZE = 100;
const CHAT_ONLY_PLAN = "chat_only";
const TERMINAL_STRIPE_STATUSES = new Set([
  "canceled",
  "incomplete_expired",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRYAN_PROTECTED_BUSINESS_ID = "aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb";
const EXTRA_NON_CHAT_PRICE_ENVIRONMENTS = [
  "STRIPE_PRICE_SETUP_FEE",
  "STRIPE_PRICE_SMS_OVERAGE_PART",
];
const PRE_ENABLE_SWITCHES = [
  "CHAT_ONLY_DIRECT_SALES_ENABLED",
  "CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED",
  "TELNYX_REMOTE_RELEASE_ENABLED",
];

const HELP = `Usage:
  npm run audit:chat-only-phase4 -- \\
    --stripe-mode <test|live> \\
    --supabase-project-ref <project-ref> \\
    --chat-price-state <absent|required> \\
    --canary-state <absent|required>

This pre-enable readiness audit is strictly read-only. It has no apply,
remediation, canary-creation, or Checkout-expiration mode.

Required environment variables:
  STRIPE_SECRET_KEY
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  STRIPE_PRICE_SMS_ONLY
  STRIPE_PRICE_SMS_AND_CHAT
  STRIPE_PRICE_FULL
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID
  WIDGET_TOKEN_SECRET

Stage-dependent server-only environment variables:
  STRIPE_PRICE_CHAT_ONLY
  CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID

Use --chat-price-state absent for the Stage A pre-Price baseline. In that
state STRIPE_PRICE_CHAT_ONLY must be unset or empty, the audit does not retrieve
a Chat Only Price, and any Chat-shaped Stripe subscription or open Checkout is
a blocker. Use --chat-price-state required after Stage B configures the Price;
the exact Price ID and full immutable contract are then required and verified.

Use --canary-state absent through Stages A-C. Use --canary-state required only
after Stage D configures the exact direct canary. A configured canary in an
absent state or a missing canary in the required state is a blocker; malformed
input makes the audit incomplete.

The three release switches may be unset or exact 0 for a passing pre-enable
audit. Exact 1 is reported as a blocker. Any other configured spelling makes
the audit incomplete instead of being silently treated as disabled.

The process exits 0 for a complete clean inventory, 2 when the sanitized
report contains safety blockers, and 1 when the audit could not complete.`;

export function parseArguments(argv) {
  const baselineArguments = [];
  let canaryState = null;
  let chatPriceState = null;
  const supplied = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const canaryInline = argument.startsWith("--canary-state=");
    const priceInline = argument.startsWith("--chat-price-state=");
    const isCanary = argument === "--canary-state" || canaryInline;
    const isPrice = argument === "--chat-price-state" || priceInline;
    if (!isCanary && !isPrice) {
      baselineArguments.push(argument);
      continue;
    }
    const flag = isCanary ? "--canary-state" : "--chat-price-state";
    if (supplied.has(flag)) {
      throw new Error(`${flag} may be supplied only once`);
    }
    supplied.add(flag);
    const value = canaryInline
      ? argument.slice("--canary-state=".length)
      : priceInline
        ? argument.slice("--chat-price-state=".length)
        : argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    if (isCanary) canaryState = value;
    if (isPrice) chatPriceState = value;
  }

  const parsed = parseTargetArguments(baselineArguments);
  if (parsed.help) return { ...parsed, chatPriceState, canaryState };
  if (chatPriceState !== "absent" && chatPriceState !== "required") {
    throw new Error("--chat-price-state must be exactly absent or required");
  }
  if (canaryState !== "absent" && canaryState !== "required") {
    throw new Error("--canary-state must be exactly absent or required");
  }
  return { ...parsed, chatPriceState, canaryState };
}

export function validateEnvironment(arguments_, environment) {
  if (
    arguments_.chatPriceState !== "absent" &&
    arguments_.chatPriceState !== "required"
  ) {
    throw new Error("--chat-price-state must be exactly absent or required");
  }
  if (
    arguments_.canaryState !== "absent" &&
    arguments_.canaryState !== "required"
  ) {
    throw new Error("--canary-state must be exactly absent or required");
  }
  if (
    arguments_.canaryState === "required" &&
    arguments_.chatPriceState !== "required"
  ) {
    throw new Error(
      "--canary-state required requires --chat-price-state required"
    );
  }
  const baseline = validateBaselineEnvironment(arguments_, environment);
  const configuredChatOnlyPriceId = environment.STRIPE_PRICE_CHAT_ONLY;
  let chatOnlyPriceId = null;
  let planPriceIds = baseline.planPriceIds;
  if (arguments_.chatPriceState === "absent") {
    if (configuredChatOnlyPriceId !== undefined && configuredChatOnlyPriceId !== "") {
      throw new Error(
        "STRIPE_PRICE_CHAT_ONLY must be unset or empty when --chat-price-state is absent"
      );
    }
  } else {
    chatOnlyPriceId = requirePriceId(environment, "STRIPE_PRICE_CHAT_ONLY");
    planPriceIds = {
      ...baseline.planPriceIds,
      chat_only: chatOnlyPriceId,
    };

    if (new Set(Object.values(planPriceIds)).size !== 4) {
      throw new Error("All four Stripe base-plan Price IDs must be unique");
    }
    for (const environmentName of EXTRA_NON_CHAT_PRICE_ENVIRONMENTS) {
      const configured = environment[environmentName];
      if (configured && configured === chatOnlyPriceId) {
        throw new Error(
          "STRIPE_PRICE_CHAT_ONLY must not match another configured Stripe Price ID"
        );
      }
    }
  }

  if (environment.NEXT_PUBLIC_STRIPE_PRICE_CHAT_ONLY) {
    throw new Error("STRIPE_PRICE_CHAT_ONLY must remain server-only");
  }
  if (environment.NEXT_PUBLIC_WIDGET_TOKEN_SECRET) {
    throw new Error("WIDGET_TOKEN_SECRET must remain server-only");
  }
  if (environment.NEXT_PUBLIC_CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID) {
    throw new Error(
      "CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID must remain server-only"
    );
  }
  const widgetTokenSecret = environment.WIDGET_TOKEN_SECRET;
  if (
    typeof widgetTokenSecret !== "string" ||
    Buffer.byteLength(widgetTokenSecret, "utf8") < 32
  ) {
    throw new Error("WIDGET_TOKEN_SECRET must contain at least 32 bytes");
  }

  const switchValues = Object.fromEntries(
    PRE_ENABLE_SWITCHES.map((name) => [
      name,
      parsePreEnableSwitch(environment, name),
    ])
  );
  const directCanaryBusinessId = parseOptionalCanaryBusinessId(environment);

  return {
    ...baseline,
    planPriceIds,
    chatOnlyPriceId,
    chatPriceState: arguments_.chatPriceState,
    canaryState: arguments_.canaryState,
    directCanaryBusinessId,
    widgetTokenSecretConfigured: true,
    chatOnlyDirectSalesEnabled:
      switchValues.CHAT_ONLY_DIRECT_SALES_ENABLED,
    chatOnlyPartnerAssignmentEnabled:
      switchValues.CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED,
    telnyxRemoteReleaseEnabled:
      switchValues.TELNYX_REMOTE_RELEASE_ENABLED,
  };
}

export async function loadPhase4DatabaseState(
  supabase,
  config,
  { loadBaseline = loadDatabaseState } = {}
) {
  const database = await loadBaseline(supabase);
  if (
    config.canaryState !== "required" ||
    !config.directCanaryBusinessId
  ) {
    // Stage A and Stage B run before migration 064. Do not even reference the
    // 064-only attempt table unless an exact post-migration canary is required.
    return database;
  }

  const [businessPlanFamilyLocks, chatOnlyCheckoutAttempts] =
    await Promise.all([
      readExactBusinessRows(
        supabase,
        "business_plan_family_locks",
        "business_id, family",
        config.directCanaryBusinessId,
        "business_id"
      ),
      readExactBusinessRows(
        supabase,
        "chat_only_checkout_attempts",
        "business_id, state, stripe_subscription_id",
        config.directCanaryBusinessId,
        "id"
      ),
    ]);

  return {
    ...database,
    businessPlanFamilyLocks,
    chatOnlyCheckoutAttempts,
  };
}

export async function buildReadinessAudit({
  stripe,
  supabase,
  config,
  now = new Date(),
  loadDatabase = loadPhase4DatabaseState,
}) {
  const [
    account,
    stripeSubscriptions,
    portalConfigurations,
    chatOnlyPrice,
    openCheckoutSessions,
    database,
  ] = await Promise.all([
    stripe.accounts.retrieve(),
    listAllStripeSubscriptions(stripe),
    listAllPortalConfigurations(stripe),
    config.chatPriceState === "required"
      ? stripe.prices.retrieve(config.chatOnlyPriceId)
      : Promise.resolve(null),
    listAllOpenCheckoutSessions(stripe),
    loadDatabase(supabase, config),
  ]);

  if (!account || typeof account.id !== "string" || !account.id) {
    throw new Error("Stripe account lookup returned an invalid account");
  }
  const expectedLivemode = config.stripeMode === "live";
  if (
    stripeSubscriptions.some(
      (subscription) => subscription?.livemode !== expectedLivemode
    )
  ) {
    throw new Error("Stripe subscription livemode does not match selected mode");
  }

  return analyzeReadiness({
    account,
    stripeSubscriptions,
    portalConfigurations,
    chatOnlyPrice,
    openCheckoutSessions,
    database,
    config,
    now,
  });
}

export function analyzeReadiness({
  account,
  stripeSubscriptions,
  portalConfigurations,
  chatOnlyPrice,
  openCheckoutSessions,
  database,
  config,
  now = new Date(),
}) {
  const baseline = analyzeBaselineInventory({
    account,
    stripeSubscriptions,
    portalConfigurations,
    database,
    config,
    now,
  });
  const blockers = [...baseline.blockers];
  const warnings = [...baseline.warnings];

  const priceContract = analyzeChatOnlyPrice(chatOnlyPrice, config, blockers);
  const checkoutInventory = analyzeOpenCheckoutSessions(
    openCheckoutSessions,
    config,
    blockers
  );
  const chatSubscriptionInventory = analyzeChatOnlySubscriptions(
    stripeSubscriptions,
    config,
    blockers
  );
  const directCanary = analyzeDirectCanary(database, config, blockers);
  const portalContractComplete = analyzePinnedPortalContract(
    portalConfigurations,
    config,
    blockers
  );

  sortIssues(blockers);
  sortIssues(warnings);
  return {
    ...baseline,
    schema_version: 1,
    operation: "chat_only_phase4_readiness",
    verdict: blockers.length === 0 ? "pass" : "blocked",
    environment: {
      chat_price_state: config.chatPriceState,
      widget_token_secret_configured:
        config.widgetTokenSecretConfigured === true,
      pre_enable_switch_values_valid: true,
      direct_canary: directCanary,
    },
    chat_only_price: priceContract,
    open_checkout_sessions: checkoutInventory,
    chat_only_subscriptions: chatSubscriptionInventory,
    stripe_portal: {
      ...baseline.stripe_portal,
      phase4_contract_complete: portalContractComplete,
    },
    blockers,
    warnings,
  };
}

function analyzePinnedPortalContract(configurations, config, blockers) {
  const pinned = configurations.find(
    (configuration) => configuration?.id === config.portalConfigurationId
  );
  const evidenceComplete = Boolean(
    pinned &&
      pinned.active === true &&
      typeof pinned.features?.subscription_update?.enabled === "boolean" &&
      typeof pinned.features?.subscription_cancel?.enabled === "boolean" &&
      typeof pinned.features?.invoice_history?.enabled === "boolean" &&
      typeof pinned.features?.payment_method_update?.enabled === "boolean"
  );
  if (!evidenceComplete) {
    addIssue(
      blockers,
      "pinned_portal_contract_incomplete",
      "Pinned Portal configuration lacks complete invoice, payment-method, subscription update, or cancellation evidence",
      [stableRef("portal", config.portalConfigurationId ?? "missing")]
    );
  }
  const contractComplete = Boolean(
    evidenceComplete &&
      pinned.features.subscription_update.enabled === false &&
      pinned.features.subscription_cancel.enabled === false &&
      pinned.features.invoice_history.enabled === true &&
      pinned.features.payment_method_update.enabled === true
  );
  if (evidenceComplete && !contractComplete) {
    addIssue(
      blockers,
      "pinned_portal_required_access_invalid",
      "Pinned Portal must enable invoice history and payment-method updates while disabling subscription updates and cancellation",
      [stableRef("portal", config.portalConfigurationId)]
    );
  }
  return contractComplete;
}

function analyzeDirectCanary(database, config, blockers) {
  if (config.canaryState !== "absent" && config.canaryState !== "required") {
    throw new Error("Canary readiness state is missing or invalid");
  }
  const canaryBusinessId = config.directCanaryBusinessId;
  if (config.canaryState === "absent" && canaryBusinessId) {
    const ref = stableRef("business", canaryBusinessId);
    addIssue(
      blockers,
      "direct_canary_unexpected_for_absent_stage",
      "Stage A requires the direct canary environment variable to remain absent",
      [ref]
    );
    return {
      expected_state: "absent",
      configured: true,
      ref,
      eligible: null,
    };
  }
  if (!canaryBusinessId) {
    if (config.canaryState === "required") {
      addIssue(
        blockers,
        "direct_canary_configuration_missing",
        "The required-canary state requires one configured direct canary business"
      );
    }
    return {
      expected_state: config.canaryState,
      configured: false,
      ref: null,
      eligible: null,
    };
  }

  const ref = stableRef("business", canaryBusinessId);
  const business = database.businesses.find(
    (row) => row.id?.toLowerCase?.() === canaryBusinessId.toLowerCase()
  );
  if (!business) {
    addIssue(
      blockers,
      "direct_canary_business_missing",
      "Configured direct canary does not identify an existing business",
      [ref]
    );
    return {
      expected_state: config.canaryState,
      configured: true,
      ref,
      eligible: false,
    };
  }

  const hasSubscription = database.subscriptions.some(
    (row) => row.business_id === business.id
  );
  const hasPhoneHistory = database.phoneNumbers.some(
    (row) => row.business_id === business.id
  );
  const hasManagedResourceHistory = database.managedResources.some(
    (row) => row.business_id === business.id
  );
  const hasTelnyxLifecycleHistory =
    database.releaseRuns.some((row) => row.business_id === business.id) ||
    database.releaseReasons.some((row) => row.business_id === business.id) ||
    database.releaseActions.some((row) => row.business_id === business.id);
  const protectedBusiness = database.protections.some(
    (row) => row.business_id === business.id
  );
  if (
    !Array.isArray(database.businessPlanFamilyLocks) ||
    !Array.isArray(database.chatOnlyCheckoutAttempts)
  ) {
    throw new Error(
      "Required canary family-lock or Checkout-attempt evidence was not loaded"
    );
  }
  const familyLocks = database.businessPlanFamilyLocks.filter(
    (row) => row.business_id === business.id
  );
  const familyLockEligible =
    familyLocks.length <= 1 &&
    familyLocks.every((row) => row.family === CHAT_ONLY_PLAN);
  const checkoutAttempts = database.chatOnlyCheckoutAttempts.filter(
    (row) => row.business_id === business.id
  );
  const checkoutHistoryEligible = checkoutAttempts.every(
    (row) =>
      row.state === "expired" &&
      row.stripe_subscription_id === null
  );
  const eligible = Boolean(
    business.id !== BRYAN_PROTECTED_BUSINESS_ID &&
      validUuid(business.owner_id) &&
      business.partner_id === null &&
      business.billing_mode === "stripe" &&
      business.partner_plan === null &&
      business.billing_pilot === false &&
      business.billing_comped === false &&
      business.billing_exempt === false &&
      business.deleted_at === null &&
      business.operations_suspended_at === null &&
      business.telnyx_brand_id === null &&
      business.telnyx_campaign_id === null &&
      business.telnyx_messaging_profile_id === null &&
      business.telnyx_voice_application_id === null &&
      business.active_telnyx_release_run_id === null &&
      business.telnyx_resource_state === "provisioning" &&
      !hasSubscription &&
      !hasPhoneHistory &&
      !hasManagedResourceHistory &&
      !hasTelnyxLifecycleHistory &&
      !protectedBusiness &&
      familyLockEligible &&
      checkoutHistoryEligible
  );
  if (!eligible) {
    addIssue(
      blockers,
      "direct_canary_business_ineligible",
      "Configured direct canary is not an active, direct, unpartnered, non-SMS disposable business",
      [ref]
    );
  }
  return {
    expected_state: config.canaryState,
    configured: true,
    ref,
    eligible,
  };
}

function analyzeChatOnlyPrice(price, config, blockers) {
  if (config.chatPriceState !== "absent" && config.chatPriceState !== "required") {
    throw new Error("Chat Price readiness state is missing or invalid");
  }
  if (config.chatPriceState === "absent") {
    const configured = config.chatOnlyPriceId !== null || price !== null;
    if (configured) {
      addIssue(
        blockers,
        "pre_price_chat_price_unexpected",
        "Stage A pre-Price baseline received configured Chat Only Price evidence"
      );
    }
    return {
      ref: null,
      configured,
      mode_matches: null,
      active: null,
      recurring: null,
      usd_1000: null,
      monthly_interval: null,
      licensed: null,
      contract_satisfied: null,
    };
  }

  const expectedLivemode = config.stripeMode === "live";
  const recurring = price?.recurring;
  const contractSatisfied = Boolean(
    price &&
      typeof price === "object" &&
      price.id === config.chatOnlyPriceId &&
      price.livemode === expectedLivemode &&
      price.active === true &&
      price.type === "recurring" &&
      typeof price.currency === "string" &&
      price.currency.toLowerCase() === "usd" &&
      price.unit_amount === 1_000 &&
      recurring?.interval === "month" &&
      recurring.interval_count === 1 &&
      recurring.usage_type === "licensed"
  );
  const ref = stableRef("price", price?.id ?? config.chatOnlyPriceId);
  if (!contractSatisfied) {
    addIssue(
      blockers,
      "chat_only_price_contract_invalid",
      "Configured Chat Only Price does not satisfy the active USD 1000 monthly licensed contract",
      [ref]
    );
  }
  return {
    ref,
    configured: true,
    mode_matches: price?.livemode === expectedLivemode,
    active: price?.active === true,
    recurring: price?.type === "recurring",
    usd_1000: price?.currency?.toLowerCase?.() === "usd" &&
      price?.unit_amount === 1_000,
    monthly_interval: recurring?.interval === "month" &&
      recurring?.interval_count === 1,
    licensed: recurring?.usage_type === "licensed",
    contract_satisfied: contractSatisfied,
  };
}

function analyzeOpenCheckoutSessions(sessions, config, blockers) {
  if (!Array.isArray(sessions)) {
    throw new Error("Stripe open Checkout inventory was not an array");
  }
  const expectedLivemode = config.stripeMode === "live";
  const priceToPlan = new Map(
    Object.entries(config.planPriceIds).map(([plan, priceId]) => [priceId, plan])
  );
  const byPlan = {};
  const chatRefs = new Set();

  for (const session of sessions) {
    const ref = stableRef("checkout", session?.id ?? "missing");
    const itemPriceIds = Array.isArray(session?.lineItems)
      ? session.lineItems.map(stripeLineItemPriceId)
      : [];
    if (
      session?.metadata?.plan === CHAT_ONLY_PLAN ||
      hasChatCheckoutMarkers(session?.metadata)
    ) {
      chatRefs.add(ref);
    }
    if (
      config.chatOnlyPriceId &&
      itemPriceIds.includes(config.chatOnlyPriceId)
    ) {
      chatRefs.add(ref);
    }
    if (
      !session ||
      typeof session.id !== "string" ||
      !session.id.startsWith("cs_") ||
      session.status !== "open" ||
      session.mode !== "subscription" ||
      session.livemode !== expectedLivemode ||
      !Array.isArray(session.lineItems)
    ) {
      addIssue(
        blockers,
        "open_checkout_shape_invalid",
        "An open Checkout Session has incomplete or mode-mismatched evidence",
        [ref]
      );
      continue;
    }

    if (
      itemPriceIds.length === 0 ||
      itemPriceIds.some((priceId) => priceId === null)
    ) {
      addIssue(
        blockers,
        "open_checkout_line_items_incomplete",
        "An open Checkout Session has incomplete line-item evidence",
        [ref]
      );
      continue;
    }

    const matchedPlans = [
      ...new Set(itemPriceIds.map((priceId) => priceToPlan.get(priceId)).filter(Boolean)),
    ];
    if (matchedPlans.length !== 1) {
      addIssue(
        blockers,
        "open_checkout_base_plan_ambiguous",
        "An open Checkout Session does not contain exactly one configured base plan",
        [ref]
      );
      continue;
    }

    const matchedPlan = matchedPlans[0];
    const metadataPlan = session.metadata?.plan;
    if (metadataPlan !== matchedPlan) {
      addIssue(
        blockers,
        "open_checkout_plan_evidence_mismatch",
        "An open Checkout Session metadata plan disagrees with its base Price",
        [ref]
      );
    }
    if (!validUuid(session.metadata?.business_id)) {
      addIssue(
        blockers,
        "open_checkout_business_metadata_invalid",
        "An open Checkout Session lacks valid business authority metadata",
        [ref]
      );
    }

    increment(byPlan, matchedPlan);
    if (matchedPlan !== CHAT_ONLY_PLAN) continue;
    chatRefs.add(ref);
    const onlyItem = session.lineItems[0];
    if (
      session.lineItems.length !== 1 ||
      stripeLineItemPriceId(onlyItem) !== config.chatOnlyPriceId ||
      onlyItem?.quantity !== 1
    ) {
      addIssue(
        blockers,
        "open_chat_checkout_item_shape_invalid",
        "An open Chat Only Checkout must contain exactly one quantity-one Chat Only item",
        [ref]
      );
    }
  }

  const sortedChatRefs = [...chatRefs].sort();
  if (sortedChatRefs.length > 0) {
    addIssue(
      blockers,
      config.chatPriceState === "absent"
        ? "pre_price_chat_checkout_evidence_present"
        : "open_chat_checkout_sessions",
      config.chatPriceState === "absent"
        ? "Stage A pre-Price baseline found a Chat-shaped open Checkout Session"
        : "Open Chat Only Checkout Sessions require disposition before the pre-enable gate can pass",
      sortedChatRefs,
      sortedChatRefs.length
    );
  }

  return {
    total_open: sessions.length,
    by_base_plan: sortedObject(byPlan),
    open_chat_only: sortedChatRefs.length,
    chat_session_refs: sortedChatRefs,
  };
}

function analyzeChatOnlySubscriptions(subscriptions, config, blockers) {
  const refs = [];
  let nonterminal = 0;
  let totalMatching = 0;
  for (const subscription of subscriptions) {
    const items = subscription?.items?.data;
    const includesChatPrice =
      Boolean(config.chatOnlyPriceId) &&
      Array.isArray(items) &&
      items.some(
        (item) => stripeLineItemPriceId(item) === config.chatOnlyPriceId
      );
    const declaresChat =
      subscription?.metadata?.plan === CHAT_ONLY_PLAN ||
      hasChatCheckoutMarkers(subscription?.metadata);
    if (!includesChatPrice && !declaresChat) continue;

    totalMatching += 1;
    const ref = stableRef("subscription", subscription?.id ?? "missing");
    refs.push(ref);
    if (TERMINAL_STRIPE_STATUSES.has(subscription?.status)) continue;

    nonterminal += 1;
    if (
      !Array.isArray(items) ||
      items.length !== 1 ||
      stripeLineItemPriceId(items[0]) !== config.chatOnlyPriceId ||
      items[0]?.quantity !== 1 ||
      subscription?.metadata?.plan !== CHAT_ONLY_PLAN
    ) {
      addIssue(
        blockers,
        "chat_only_subscription_item_shape_invalid",
        "A nonterminal Chat Only subscription must have one quantity-one Chat Only item and matching metadata",
        [ref]
      );
    }
  }
  const sortedRefs = [...new Set(refs)].sort();
  if (config.chatPriceState === "absent" && totalMatching > 0) {
    addIssue(
      blockers,
      "pre_price_chat_subscription_evidence_present",
      "Stage A pre-Price baseline found a Chat-shaped Stripe subscription",
      sortedRefs,
      totalMatching
    );
  }
  return {
    total_matching: totalMatching,
    nonterminal,
    refs: sortedRefs,
  };
}

async function listAllStripeSubscriptions(stripe) {
  return listStripePages((startingAfter) =>
    stripe.subscriptions.list({
      status: "all",
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
  );
}

async function listAllPortalConfigurations(stripe) {
  return listStripePages((startingAfter) =>
    stripe.billingPortal.configurations.list({
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
  );
}

async function listAllOpenCheckoutSessions(stripe) {
  const sessions = await listStripePages((startingAfter) =>
    stripe.checkout.sessions.list({
      status: "open",
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
  );
  const withItems = [];
  for (const session of sessions) {
    if (typeof session?.id !== "string" || !session.id.startsWith("cs_")) {
      throw new Error("Stripe open Checkout inventory returned an invalid session");
    }
    const lineItems = await listStripePages((startingAfter) =>
      stripe.checkout.sessions.listLineItems(session.id, {
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
    );
    withItems.push({ ...session, lineItems });
  }
  return withItems;
}

async function readExactBusinessRows(
  supabase,
  table,
  columns,
  businessId,
  orderColumn
) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("business_id", businessId)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (!Array.isArray(data)) {
      throw new Error(`Failed to read ${table}: response was not an array`);
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function listStripePages(loadPage) {
  const rows = [];
  let startingAfter;
  for (;;) {
    const page = await loadPage(startingAfter);
    if (
      !page ||
      !Array.isArray(page.data) ||
      typeof page.has_more !== "boolean"
    ) {
      throw new Error("Stripe list returned an invalid page");
    }
    rows.push(...page.data);
    if (!page.has_more) return rows;
    const lastId = page.data.at(-1)?.id;
    if (typeof lastId !== "string" || !lastId) {
      throw new Error("Stripe pagination did not advance");
    }
    startingAfter = lastId;
  }
}

function parsePreEnableSwitch(environment, name) {
  const value = environment[name];
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`${name} must be unset, exact 0, or exact 1`);
}

function parseOptionalCanaryBusinessId(environment) {
  const value = environment.CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID;
  if (value === undefined || value === "") return null;
  if (!CANONICAL_UUID_PATTERN.test(value)) {
    throw new Error(
      "CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID must be one exact canonical UUID"
    );
  }
  return value.toLowerCase();
}

function requirePriceId(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  if (!value.startsWith("price_") || value.length <= 6) {
    throw new Error(`${name} must be a Stripe Price ID`);
  }
  return value;
}

function stripeLineItemPriceId(item) {
  const price = item?.price;
  if (typeof price === "string" && price.startsWith("price_")) return price;
  if (
    price &&
    typeof price === "object" &&
    typeof price.id === "string" &&
    price.id.startsWith("price_")
  ) {
    return price.id;
  }
  return null;
}

function hasChatCheckoutMarkers(metadata) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      [
        "checkout_attempt_id",
        "checkout_request_fingerprint",
        "checkout_session_expires_at",
      ].some((key) => Object.prototype.hasOwnProperty.call(metadata, key))
  );
}

function validUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

function addIssue(target, code, message, refs = [], count = 1) {
  target.push({
    code,
    message,
    count,
    refs: [...new Set(refs)].sort(),
  });
}

function sortIssues(issues) {
  issues.sort((left, right) =>
    `${left.code}:${left.refs.join(",")}`.localeCompare(
      `${right.code}:${right.refs.join(",")}`
    )
  );
}

export function sanitizeReadinessError(error) {
  return sanitizeBaselineError(error)
    .replace(
      /\b(?:acct|cs_(?:test|live)|prod|in|pi|ch|evt|req|si|li|pm|seti|src|tok)_[A-Za-z0-9_]+\b/g,
      "[provider_ref]"
    )
    .replace(
      /\b(?:sk|rk|whsec)_(?:test_|live_)?[A-Za-z0-9_]+\b|\bsb_(?:secret|publishable)_[A-Za-z0-9_]+\b/g,
      "[secret]"
    )
    .replace(/\beyJ[A-Za-z0-9._-]+\b/g, "[token]")
    .replace(/\bhttps?:\/\/[^\s]+/g, "[url]")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email]");
}

async function main() {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    if (arguments_.help) {
      console.log(HELP);
      return;
    }
    const config = validateEnvironment(arguments_, process.env);
    const stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: STRIPE_API_VERSION,
    });
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const report = await buildReadinessAudit({ stripe, supabase, config });
    console.log(JSON.stringify(report, null, 2));
    if (report.verdict !== "pass") process.exitCode = 2;
  } catch (error) {
    console.error(
      JSON.stringify({
        schema_version: 1,
        operation: "chat_only_phase4_readiness",
        verdict: "incomplete",
        error: sanitizeReadinessError(error),
      })
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  await main();
}
