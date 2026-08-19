#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-02-25.clover";
const PAGE_SIZE = 100;
const DATABASE_PAGE_SIZE = 1000;
const CURRENT_BILLING_MODES = new Set(["stripe", "invoiced", "comped"]);
const TERMINAL_STRIPE_STATUSES = new Set(["canceled", "incomplete_expired"]);
const AUTHORITATIVE_DATABASE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);
const OPEN_RELEASE_RUN_STATUSES = new Set([
  "parked",
  "release_pending",
  "releasing",
  "blocked",
]);
const ACTIONABLE_RELEASE_STATES = new Set([
  "pending",
  "retryable",
  "leased",
  "blocked",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRYAN_PROTECTED_BUSINESS_ID = "aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb";
const REQUIRED_PROTECTION_SHAPES = {
  bryan_develops_retain_all: ["business_all", null],
  simplassist_live_phone: ["resource", "phone_number"],
  simplassist_live_campaign: ["resource", "campaign"],
  simplassist_shared_brand: ["resource", "brand"],
};

const HELP = `Usage:
  npm run audit:chat-only-phase0 -- \\
    --stripe-mode <test|live> \\
    --supabase-project-ref <project-ref>

This command is strictly read-only. It has no apply or remediation mode.

Required environment variables:
  STRIPE_SECRET_KEY
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  STRIPE_PRICE_SMS_ONLY
  STRIPE_PRICE_SMS_AND_CHAT
  STRIPE_PRICE_FULL

Optional environment variable:
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID

The process exits 0 for a complete clean inventory, 2 when the sanitized
report contains safety blockers, and 1 when the inventory could not complete.`;

export function parseArguments(argv) {
  const parsed = { help: false, stripeMode: null, projectRef: null };
  const supplied = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = splitArgument(argument);
    if (flag === "--help" || flag === "-h") {
      parsed.help = true;
      continue;
    }
    if (flag !== "--stripe-mode" && flag !== "--supabase-project-ref") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (supplied.has(flag)) {
      throw new Error(`${flag} may be supplied only once`);
    }
    supplied.add(flag);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === "--stripe-mode") parsed.stripeMode = value;
    if (flag === "--supabase-project-ref") parsed.projectRef = value;
  }

  if (parsed.help) return parsed;
  if (parsed.stripeMode !== "test" && parsed.stripeMode !== "live") {
    throw new Error("--stripe-mode must be exactly test or live");
  }
  if (!parsed.projectRef || !/^[a-z0-9-]+$/.test(parsed.projectRef)) {
    throw new Error(
      "--supabase-project-ref is required and must contain only lowercase letters, numbers, or hyphens"
    );
  }
  return parsed;
}

export function validateEnvironment(arguments_, environment) {
  const stripeSecretKey = environment.STRIPE_SECRET_KEY;
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required");
  const expectedPrefix =
    arguments_.stripeMode === "live" ? "sk_live_" : "sk_test_";
  if (!stripeSecretKey.startsWith(expectedPrefix)) {
    throw new Error(
      `STRIPE_SECRET_KEY does not match --stripe-mode ${arguments_.stripeMode}`
    );
  }
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(
    parsedUrl.hostname
  );
  if (arguments_.stripeMode === "live" && (local || parsedUrl.protocol !== "https:")) {
    throw new Error("Live Stripe mode requires a non-local HTTPS Supabase URL");
  }
  if (local) {
    if (arguments_.projectRef !== "local") {
      throw new Error("Local Supabase URLs require --supabase-project-ref local");
    }
  } else {
    if (!parsedUrl.hostname.endsWith(".supabase.co")) {
      throw new Error(
        "Supabase URL must be local or use the <project-ref>.supabase.co host"
      );
    }
    const actualProjectRef = parsedUrl.hostname.split(".")[0];
    if (actualProjectRef !== arguments_.projectRef) {
      throw new Error(
        `Supabase project mismatch: expected ${arguments_.projectRef}`
      );
    }
  }

  const planPriceIds = {
    sms_only: requirePriceId(environment, "STRIPE_PRICE_SMS_ONLY"),
    sms_and_chat: requirePriceId(
      environment,
      "STRIPE_PRICE_SMS_AND_CHAT"
    ),
    full: requirePriceId(environment, "STRIPE_PRICE_FULL"),
  };
  if (new Set(Object.values(planPriceIds)).size !== 3) {
    throw new Error("Existing Stripe base-plan Price IDs must be unique");
  }
  const portalConfigurationId =
    environment.STRIPE_BILLING_PORTAL_CONFIGURATION_ID || null;
  if (
    portalConfigurationId &&
    !/^bpc_[A-Za-z0-9]+$/.test(portalConfigurationId)
  ) {
    throw new Error(
      "STRIPE_BILLING_PORTAL_CONFIGURATION_ID must be a Stripe Portal configuration ID"
    );
  }

  return {
    stripeMode: arguments_.stripeMode,
    projectRef: arguments_.projectRef,
    stripeSecretKey,
    supabaseUrl: parsedUrl.toString().replace(/\/$/, ""),
    serviceRoleKey,
    planPriceIds,
    portalConfigurationId,
    chatOnlyDirectSalesEnabled:
      environment.CHAT_ONLY_DIRECT_SALES_ENABLED === "1",
    chatOnlyPartnerAssignmentEnabled:
      environment.CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED === "1",
    telnyxRemoteReleaseEnabled:
      environment.TELNYX_REMOTE_RELEASE_ENABLED === "1",
  };
}

export async function loadDatabaseState(supabase) {
  const entries = await Promise.all([
    readAllRows(
      supabase,
      "businesses",
      "id, owner_id, partner_id, billing_mode, partner_plan, billing_pilot, billing_comped, billing_exempt, deleted_at, operations_suspended_at, telnyx_brand_id, telnyx_campaign_id, telnyx_messaging_profile_id, telnyx_voice_application_id, active_telnyx_release_run_id, telnyx_resource_state",
      "id"
    ),
    readAllRows(
      supabase,
      "subscriptions",
      "business_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end",
      "business_id"
    ),
    readAllRows(
      supabase,
      "account_deletion_stripe_actions",
      "business_id, stripe_subscription_id, desired_action, applied_action, status, attempt_count, applied_at, last_error_code",
      "business_id"
    ),
    readAllRows(
      supabase,
      "partners",
      "id, name, slug, custom_domain, domain_status, status, logo_light_url, logo_dark_url, favicon_url, email_from_status",
      "id"
    ),
    readAllRows(
      supabase,
      "phone_numbers",
      "id, business_id, telnyx_phone_number_id, is_active, resource_status",
      "id"
    ),
    readAllRows(
      supabase,
      "telnyx_managed_resources",
      "id, business_id, phone_number_id, resource_type, provider_id, provider_origin, ownership_state, local_claim_active",
      "id"
    ),
    readAllRows(
      supabase,
      "telnyx_release_protections",
      "id, protection_key, scope, business_id, resource_type, reason_code",
      "id"
    ),
    readAllRows(
      supabase,
      "telnyx_resource_release_runs",
      "id, business_id, status, effective_release_at, point_of_no_return_at, last_error_code",
      "id"
    ),
    readAllRows(
      supabase,
      "telnyx_resource_release_reasons",
      "run_id, business_id, reason_type, status, release_at",
      "id"
    ),
    readAllRows(
      supabase,
      "telnyx_resource_release_actions",
      "id, run_id, business_id, managed_resource_id, protection_id, resource_type, previous_resource_status, classification, desired_action, state, next_retry_at, last_error_code",
      "id"
    ),
    readAllRows(
      supabase,
      "telnyx_resource_release_config",
      "id, mode, single_business_id, expected_shared_messaging_profile_id, expected_shared_voice_application_id, protection_manifest_fingerprint, protection_manifest_verified_at, dry_run_completed_at, single_business_test_completed_at, authorization_epoch",
      "id"
    ),
  ]);

  const [
    businesses,
    subscriptions,
    accountDeletionStripeActions,
    partners,
    phoneNumbers,
    managedResources,
    protections,
    releaseRuns,
    releaseReasons,
    releaseActions,
    releaseConfig,
  ] = entries;
  return {
    businesses,
    subscriptions,
    accountDeletionStripeActions,
    partners,
    phoneNumbers,
    managedResources,
    protections,
    releaseRuns,
    releaseReasons,
    releaseActions,
    releaseConfig,
  };
}

export async function buildInventory({
  stripe,
  supabase,
  config,
  now = new Date(),
  loadDatabase = loadDatabaseState,
}) {
  const [account, stripeSubscriptions, portalConfigurations, database] =
    await Promise.all([
      stripe.accounts.retrieve(),
      listAllStripeSubscriptions(stripe),
      listAllPortalConfigurations(stripe),
      loadDatabase(supabase),
    ]);

  if (!account || typeof account.id !== "string" || !account.id) {
    throw new Error("Stripe account lookup returned an invalid account");
  }
  const expectedLivemode = config.stripeMode === "live";
  if (
    stripeSubscriptions.some(
      (subscription) => subscription.livemode !== expectedLivemode
    )
  ) {
    throw new Error("Stripe subscription livemode does not match selected mode");
  }

  return analyzeInventory({
    account,
    stripeSubscriptions,
    portalConfigurations,
    database,
    config,
    now,
  });
}

export function analyzeInventory({
  account,
  stripeSubscriptions,
  portalConfigurations,
  database,
  config,
  now = new Date(),
}) {
  const blockers = [];
  const warnings = [];
  // Phase 0 supplies the original three-plan catalog. Later read-only audits
  // may reuse this reconciler with an explicitly validated expanded catalog;
  // deriving the set from that catalog preserves Phase 0 behavior while
  // avoiding a second copy of the billing/Telnyx authority analysis.
  const currentPlans = new Set(Object.keys(config.planPriceIds));
  const businessById = new Map(database.businesses.map((row) => [row.id, row]));
  const partnerById = new Map(database.partners.map((row) => [row.id, row]));
  const dbSubscriptionByBusiness = new Map(
    database.subscriptions.map((row) => [row.business_id, row])
  );
  const dbSubscriptionByStripeId = new Map(
    database.subscriptions.map((row) => [row.stripe_subscription_id, row])
  );
  const deletionStripeActionByBusiness = new Map(
    database.accountDeletionStripeActions.map((row) => [
      row.business_id,
      row,
    ])
  );
  const activeStripeSubscriptions = stripeSubscriptions.filter((row) =>
    !TERMINAL_STRIPE_STATUSES.has(row.status)
  );
  const allStripeById = new Map(
    stripeSubscriptions.map((row) => [row.id, row])
  );
  const stripeById = new Map(
    activeStripeSubscriptions.map((row) => [row.id, row])
  );
  const priceToPlan = new Map(
    Object.entries(config.planPriceIds).map(([plan, priceId]) => [priceId, plan])
  );

  if (config.chatOnlyDirectSalesEnabled) {
    addIssue(
      blockers,
      "chat_only_direct_rollout_open",
      "Direct chat-only acquisition must remain disabled during Phase 0"
    );
  }
  if (config.chatOnlyPartnerAssignmentEnabled) {
    addIssue(
      blockers,
      "chat_only_partner_rollout_open",
      "Partner chat-only assignment must remain disabled during Phase 0"
    );
  }
  if (config.telnyxRemoteReleaseEnabled) {
    addIssue(
      blockers,
      "telnyx_remote_release_open",
      "Remote Telnyx release must remain disabled during this inventory"
    );
  }

  for (const business of database.businesses) {
    const ref = stableRef("business", business.id);
    if (!CURRENT_BILLING_MODES.has(business.billing_mode)) {
      addIssue(blockers, "unknown_billing_mode", "Business has an unknown billing mode", [ref]);
      continue;
    }
    if (business.billing_mode === "stripe" && business.partner_plan != null) {
      addIssue(blockers, "split_billing_authority", "Stripe business also has a partner plan", [ref]);
    }
    if (business.billing_mode !== "stripe") {
      if (!currentPlans.has(business.partner_plan)) {
        addIssue(blockers, "invalid_partner_plan", "Partner-managed business lacks a valid current plan", [ref]);
      }
      if (!business.partner_id || !partnerById.has(business.partner_id)) {
        addIssue(blockers, "missing_partner_authority", "Partner-managed business has no valid partner", [ref]);
      }
      if (dbSubscriptionByBusiness.has(business.id)) {
        addIssue(blockers, "split_billing_authority", "Partner-managed business also has a subscription row", [ref]);
      }
    }
  }

  for (const subscription of database.subscriptions) {
    const ref = stableRef("business", subscription.business_id);
    if (!currentPlans.has(subscription.plan)) {
      addIssue(blockers, "invalid_subscription_plan", "Database subscription has an unknown plan", [ref]);
    }
    const business = businessById.get(subscription.business_id);
    if (!business || business.billing_mode !== "stripe") {
      addIssue(blockers, "invalid_subscription_authority", "Subscription row is not owned by a Stripe-mode business", [ref]);
    }
    if (
      AUTHORITATIVE_DATABASE_STATUSES.has(subscription.status) &&
      !stripeById.has(subscription.stripe_subscription_id)
    ) {
      const stripeSubscription = allStripeById.get(
        subscription.stripe_subscription_id
      );
      const deletionAction = deletionStripeActionByBusiness.get(
        subscription.business_id
      );
      const cancellationProvenForDeletedBusiness = Boolean(
        business?.deleted_at &&
          deletionAction?.stripe_subscription_id ===
            subscription.stripe_subscription_id &&
          deletionAction.status === "applied" &&
          deletionAction.applied_action === "cancel" &&
          (!stripeSubscription ||
            TERMINAL_STRIPE_STATUSES.has(stripeSubscription.status))
      );
      if (cancellationProvenForDeletedBusiness) {
        addIssue(
          warnings,
          "deleted_business_subscription_retained_during_grace",
          "Deleted business retains its local subscription during the deletion grace period after Stripe cancellation was durably proven",
          [ref]
        );
      } else {
        addIssue(
          blockers,
          stripeSubscription &&
            TERMINAL_STRIPE_STATUSES.has(stripeSubscription.status)
            ? "database_subscription_terminal_in_stripe"
            : "database_subscription_missing_in_stripe",
          stripeSubscription &&
            TERMINAL_STRIPE_STATUSES.has(stripeSubscription.status)
            ? "Authoritative database subscription points to a terminal Stripe subscription"
            : "Authoritative database subscription has no matching Stripe subscription",
          [ref]
        );
      }
    }
  }

  for (const [businessId, count] of countBy(
    activeStripeSubscriptions,
    (row) => validUuid(row.metadata?.business_id)
  )) {
    if (businessId && count > 1) {
      addIssue(blockers, "duplicate_stripe_business", "One business maps to multiple nonterminal Stripe subscriptions", [stableRef("business", businessId)], count);
    }
  }
  for (const [customerId, count] of countBy(
    activeStripeSubscriptions,
    (row) => stripeCustomerId(row.customer)
  )) {
    if (customerId && count > 1) {
      addIssue(blockers, "duplicate_stripe_customer", "One customer maps to multiple nonterminal Stripe subscriptions", [stableRef("customer", customerId)], count);
    }
  }

  const stripePlanCounts = {};
  for (const subscription of activeStripeSubscriptions) {
    const subscriptionRef = stableRef("subscription", subscription.id);
    const businessId = validUuid(subscription.metadata?.business_id);
    const customerId = stripeCustomerId(subscription.customer);
    if (!businessId) {
      addIssue(blockers, "stripe_business_metadata_missing", "Nonterminal Stripe subscription lacks valid business metadata", [subscriptionRef]);
      continue;
    }
    const matchedPlans = [
      ...new Set(
        (subscription.items?.data ?? [])
          .map((item) => priceToPlan.get(item?.price?.id))
          .filter(Boolean)
      ),
    ];
    if (matchedPlans.length !== 1) {
      addIssue(blockers, "stripe_base_plan_ambiguous", "Nonterminal Stripe subscription does not have exactly one known base plan", [subscriptionRef]);
    } else {
      increment(stripePlanCounts, matchedPlans[0]);
    }
    const business = businessById.get(businessId);
    const local = dbSubscriptionByBusiness.get(businessId);
    if (!business || business.deleted_at != null) {
      addIssue(blockers, "stripe_business_unavailable", "Nonterminal Stripe subscription points to a missing or deleted business", [subscriptionRef, stableRef("business", businessId)]);
    } else if (business.billing_mode !== "stripe") {
      addIssue(blockers, "stripe_partner_authority_conflict", "Nonterminal Stripe subscription points to a partner-managed business", [subscriptionRef, stableRef("business", businessId)]);
    }
    if (
      !local ||
      local.stripe_subscription_id !== subscription.id ||
      local.stripe_customer_id !== customerId
    ) {
      addIssue(blockers, "stripe_database_link_mismatch", "Stripe and database subscription linkage do not match", [subscriptionRef, stableRef("business", businessId)]);
    }
    if (local && matchedPlans.length === 1 && local.plan !== matchedPlans[0]) {
      addIssue(blockers, "stripe_database_plan_mismatch", "Stripe base plan and database plan do not match", [subscriptionRef, stableRef("business", businessId)]);
    }
  }

  for (const [stripeId, local] of dbSubscriptionByStripeId) {
    if (!stripeId || typeof stripeId !== "string") {
      addIssue(blockers, "invalid_database_stripe_id", "Database subscription has an invalid Stripe identifier", [stableRef("business", local.business_id)]);
    }
  }

  const activePortalConfigurations = portalConfigurations.filter(
    (configuration) => configuration.active
  );
  const defaultPortalConfigurations = activePortalConfigurations.filter(
    (configuration) => configuration.is_default
  );
  let pinnedPortalConfiguration = null;
  if (config.portalConfigurationId) {
    pinnedPortalConfiguration = portalConfigurations.find(
      (configuration) => configuration.id === config.portalConfigurationId
    );
    if (!pinnedPortalConfiguration || !pinnedPortalConfiguration.active) {
      addIssue(blockers, "portal_pin_invalid", "Pinned Portal configuration is missing or inactive");
    }
  } else {
    addIssue(
      blockers,
      "portal_configuration_pin_missing",
      "Application requires an explicit active Stripe Billing Portal configuration pin"
    );
  }
  const portalSummaries = activePortalConfigurations.map((configuration) => {
    const isPinned = configuration.id === config.portalConfigurationId;
    const productPrices = (configuration.features?.subscription_update?.products ?? [])
      .flatMap((product) => product.prices ?? []);
    const knownPriceCount = productPrices.filter((priceId) =>
      priceToPlan.has(priceId)
    ).length;
    const unknownPriceCount = productPrices.length - knownPriceCount;
    if (configuration.features?.subscription_update?.enabled) {
      addIssue(warnings, "portal_plan_switching_enabled", "An active Portal configuration permits subscription updates", [stableRef("portal", configuration.id)]);
      if (isPinned) {
        addIssue(
          blockers,
          "pinned_portal_plan_switching_enabled",
          "The pinned Portal configuration must not permit subscription updates before transition orchestration exists",
          [stableRef("portal", configuration.id)]
        );
      }
    }
    if (configuration.features?.subscription_cancel?.enabled && isPinned) {
      addIssue(
        blockers,
        "pinned_portal_cancellation_enabled",
        "The pinned Portal configuration must not permit cancellation before Telnyx lifecycle execution exists",
        [stableRef("portal", configuration.id)]
      );
    }
    if (unknownPriceCount > 0) {
      addIssue(warnings, "portal_unknown_prices", "An active Portal configuration exposes Price IDs outside the current base-plan catalog", [stableRef("portal", configuration.id)], unknownPriceCount);
    }
    return {
      ref: stableRef("portal", configuration.id),
      pinned: isPinned,
      default: Boolean(configuration.is_default),
      subscription_updates_enabled: Boolean(
        configuration.features?.subscription_update?.enabled
      ),
      known_base_plan_prices: knownPriceCount,
      unknown_prices: unknownPriceCount,
      cancellation_enabled: Boolean(
        configuration.features?.subscription_cancel?.enabled
      ),
    };
  });

  const releaseConfig = database.releaseConfig;
  if (releaseConfig.length !== 1) {
    addIssue(blockers, "telnyx_release_config_ambiguous", "Expected exactly one Telnyx release configuration row", [], releaseConfig.length);
  }
  const releaseSettings = releaseConfig[0] ?? null;
  if (releaseSettings?.mode === "enabled") {
    addIssue(blockers, "telnyx_release_broadly_enabled", "Database Telnyx release mode is broadly enabled during Phase 0");
  }
  if (
    releaseSettings?.mode === "single_business" &&
    releaseSettings.single_business_id === BRYAN_PROTECTED_BUSINESS_ID
  ) {
    addIssue(blockers, "protected_business_is_release_canary", "Protected Bryan business is configured as the release canary");
  }
  if (
    releaseSettings &&
    releaseSettings.mode !== "disabled" &&
    (!releaseSettings.protection_manifest_verified_at ||
      !releaseSettings.dry_run_completed_at)
  ) {
    addIssue(blockers, "telnyx_release_prerequisites_missing", "Non-disabled Telnyx release configuration lacks verified protections or dry run");
  }

  const protectionByKey = new Map(
    database.protections.map((row) => [row.protection_key, row])
  );
  for (const [key, [scope, resourceType]] of Object.entries(
    REQUIRED_PROTECTION_SHAPES
  )) {
    const protection = protectionByKey.get(key);
    if (
      !protection ||
      protection.scope !== scope ||
      protection.resource_type !== resourceType
    ) {
      addIssue(blockers, "required_telnyx_protection_missing", `Required protection ${key} is missing or malformed`);
    }
  }
  const bryanProtection = protectionByKey.get("bryan_develops_retain_all");
  if (bryanProtection?.business_id !== BRYAN_PROTECTED_BUSINESS_ID) {
    addIssue(blockers, "bryan_business_protection_mismatch", "Bryan retain-all protection does not target the known protected business");
  }

  const runById = new Map(database.releaseRuns.map((row) => [row.id, row]));
  const nowMs = now.getTime();
  const dueReasons = database.releaseReasons.filter((reason) => {
    const run = runById.get(reason.run_id);
    return (
      reason.status === "active" &&
      run &&
      OPEN_RELEASE_RUN_STATUSES.has(run.status) &&
      timestampDue(reason.release_at, nowMs)
    );
  });
  const dueActions = database.releaseActions.filter((action) => {
    const run = runById.get(action.run_id);
    return (
      run &&
      OPEN_RELEASE_RUN_STATUSES.has(run.status) &&
      timestampDue(run.effective_release_at, nowMs) &&
      ACTIONABLE_RELEASE_STATES.has(action.state) &&
      (!action.next_retry_at || timestampDue(action.next_retry_at, nowMs))
    );
  });
  if (dueReasons.length > 0) {
    addIssue(blockers, "due_telnyx_release_reasons", "Active Telnyx release reasons are due", uniqueRefs(dueReasons, "business_id"), dueReasons.length);
  }
  if (dueActions.length > 0) {
    addIssue(blockers, "due_telnyx_release_actions", "Telnyx release actions are due or blocked", uniqueRefs(dueActions, "business_id"), dueActions.length);
  }
  const unsafeProtectedActions = database.releaseActions.filter(
    (action) =>
      action.protection_id &&
      (action.classification !== "protected_retain" ||
        action.desired_action !== "retain" ||
        action.state !== "retained")
  );
  if (unsafeProtectedActions.length > 0) {
    addIssue(blockers, "unsafe_protected_release_action", "Protected Telnyx actions are not immutable retains", uniqueRefs(unsafeProtectedActions, "business_id"), unsafeProtectedActions.length);
  }
  const bryanUnsafeActions = database.releaseActions.filter(
    (action) =>
      action.business_id === BRYAN_PROTECTED_BUSINESS_ID &&
      !["protected_retain", "policy_retain"].includes(action.classification)
  );
  if (bryanUnsafeActions.length > 0) {
    addIssue(blockers, "unsafe_bryan_release_action", "Protected Bryan business has a non-retain release action", [stableRef("business", BRYAN_PROTECTED_BUSINESS_ID)], bryanUnsafeActions.length);
  }
  const phoneActionsMissingPreviousStatus = database.releaseActions.filter(
    (action) =>
      ["phone_number_assignment", "phone_number"].includes(
        action.resource_type
      ) && action.previous_resource_status == null
  );
  if (phoneActionsMissingPreviousStatus.length > 0) {
    addIssue(
      blockers,
      "phone_release_action_previous_status_missing",
      "Phone release actions are missing the prior local resource status required for safe cancellation",
      uniqueRefs(phoneActionsMissingPreviousStatus, "business_id"),
      phoneActionsMissingPreviousStatus.length
    );
  }

  const phoneNamespaceCounts = {
    numeric_owned_resource: 0,
    legacy_uuid_hold: 0,
    missing: 0,
    invalid: 0,
  };
  for (const resource of database.managedResources) {
    if (
      resource.ownership_state === "managed_releaseable" &&
      !["created_by_simplassist", "manually_attested"].includes(
        resource.provider_origin
      )
    ) {
      addIssue(blockers, "unsafe_releaseable_resource", "Releaseable Telnyx resource lacks an allowed ownership attestation", [stableRef("business", resource.business_id)]);
    }
    if (resource.ownership_state === "released" && resource.local_claim_active) {
      addIssue(blockers, "released_resource_claim_active", "Released Telnyx resource still has an active local claim", [stableRef("business", resource.business_id)]);
    }
    if (resource.resource_type !== "phone_number") continue;
    const providerId = resource.provider_id;
    if (!providerId) phoneNamespaceCounts.missing += 1;
    else if (/^[0-9]+$/.test(providerId)) {
      phoneNamespaceCounts.numeric_owned_resource += 1;
    } else if (
      LEGACY_UUID_PATTERN.test(providerId) &&
      resource.ownership_state === "unverified_hold"
    ) {
      phoneNamespaceCounts.legacy_uuid_hold += 1;
    } else {
      phoneNamespaceCounts.invalid += 1;
      addIssue(blockers, "invalid_phone_provider_namespace", "Managed phone resource has an unsafe provider identifier namespace", [stableRef("business", resource.business_id)]);
    }
  }
  const managedPhoneIds = new Set(
    database.managedResources
      .filter((resource) => resource.resource_type === "phone_number")
      .map((resource) => resource.phone_number_id)
      .filter(Boolean)
  );
  const unregisteredActivePhones = database.phoneNumbers.filter(
    (phone) => phone.resource_status !== "released" && !managedPhoneIds.has(phone.id)
  );
  if (unregisteredActivePhones.length > 0) {
    addIssue(blockers, "active_phone_missing_registry", "Active phone rows are missing from the managed-resource registry", uniqueRefs(unregisteredActivePhones, "business_id"), unregisteredActivePhones.length);
  }

  const alphaDogCandidates = database.partners.filter((partner) => {
    const identity = `${partner.name ?? ""} ${partner.slug ?? ""}`.toLowerCase();
    return identity.includes("alpha") && identity.includes("dog");
  });
  if (alphaDogCandidates.length !== 1) {
    addIssue(blockers, "alpha_dog_partner_ambiguous", "Expected exactly one Alpha Dog partner", [], alphaDogCandidates.length);
  }
  const alphaDog = alphaDogCandidates[0] ?? null;
  const alphaDogBusinesses = alphaDog
    ? database.businesses.filter((business) => business.partner_id === alphaDog.id)
    : [];
  if (alphaDog && alphaDogBusinesses.length === 0) {
    addIssue(blockers, "alpha_dog_clients_missing", "Alpha Dog has no assigned client businesses");
  }
  if (
    alphaDog &&
    (alphaDog.status !== "active" ||
      alphaDog.domain_status !== "connected" ||
      !alphaDog.custom_domain)
  ) {
    addIssue(blockers, "alpha_dog_branding_incomplete", "Alpha Dog partner branding/domain is not active and connected");
  }
  for (const business of alphaDogBusinesses) {
    if (
      business.billing_mode === "stripe" ||
      !currentPlans.has(business.partner_plan)
    ) {
      addIssue(blockers, "alpha_dog_client_authority_invalid", "Alpha Dog client is not partner-managed on a valid plan", [stableRef("business", business.id)]);
    }
  }

  const bryanBusiness = businessById.get(BRYAN_PROTECTED_BUSINESS_ID);
  if (!bryanBusiness) {
    addIssue(blockers, "bryan_business_missing", "Known protected Bryan business is missing");
  }

  const openRuns = database.releaseRuns.filter((run) =>
    OPEN_RELEASE_RUN_STATUSES.has(run.status)
  );
  if (openRuns.length > 0) {
    addIssue(warnings, "open_telnyx_release_runs", "Open Telnyx lifecycle runs require documented disposition", uniqueRefs(openRuns, "business_id"), openRuns.length);
  }

  sortIssues(blockers);
  sortIssues(warnings);
  return {
    schema_version: 1,
    operation: "read_only_inventory",
    generated_at: new Date(nowMs).toISOString(),
    verdict: blockers.length === 0 ? "pass" : "blocked",
    targets: {
      stripe_mode: config.stripeMode,
      stripe_account_ref: stableRef("stripe_account", account.id),
      supabase_project_ref: config.projectRef,
    },
    rollout: {
      direct_sales_enabled: config.chatOnlyDirectSalesEnabled,
      partner_assignment_enabled: config.chatOnlyPartnerAssignmentEnabled,
      telnyx_remote_release_enabled: config.telnyxRemoteReleaseEnabled,
    },
    authority: {
      businesses: database.businesses.length,
      by_billing_mode: countObject(database.businesses, (row) => row.billing_mode),
      partner_plans: countObject(
        database.businesses.filter((row) => row.billing_mode !== "stripe"),
        (row) => row.partner_plan ?? "missing"
      ),
      database_subscriptions: database.subscriptions.length,
      account_deletion_stripe_actions:
        database.accountDeletionStripeActions.length,
      database_subscription_plans: countObject(
        database.subscriptions,
        (row) => row.plan
      ),
      database_subscription_statuses: countObject(
        database.subscriptions,
        (row) => row.status
      ),
      stripe_total_subscriptions: stripeSubscriptions.length,
      stripe_subscription_statuses: countObject(
        stripeSubscriptions,
        (row) => row.status
      ),
      stripe_nonterminal_subscriptions: activeStripeSubscriptions.length,
      stripe_nonterminal_plans: stripePlanCounts,
    },
    branding: {
      partners: database.partners.length,
      connected_partners: database.partners.filter(
        (partner) =>
          partner.status === "active" &&
          partner.domain_status === "connected" &&
          Boolean(partner.custom_domain)
      ).length,
      alpha_dog: {
        found: alphaDogCandidates.length === 1,
        active_and_connected: Boolean(
          alphaDog &&
            alphaDog.status === "active" &&
            alphaDog.domain_status === "connected" &&
            alphaDog.custom_domain
        ),
        assigned_businesses: alphaDogBusinesses.length,
        valid_partner_authority: alphaDogBusinesses.filter(
          (business) =>
            business.billing_mode !== "stripe" &&
            currentPlans.has(business.partner_plan)
        ).length,
        assigned_business_refs: alphaDogBusinesses.map((row) =>
          stableRef("business", row.id)
        ),
      },
    },
    protected_baseline: {
      bryan_business_found: Boolean(bryanBusiness),
      bryan_business_ref: stableRef(
        "business",
        BRYAN_PROTECTED_BUSINESS_ID
      ),
      required_protections: Object.fromEntries(
        Object.keys(REQUIRED_PROTECTION_SHAPES).map((key) => [
          key,
          protectionByKey.has(key),
        ])
      ),
    },
    stripe_portal: {
      configuration_pinned: Boolean(
        pinnedPortalConfiguration?.active
      ),
      active_configurations: activePortalConfigurations.length,
      active_default_configurations: defaultPortalConfigurations.length,
      configurations: portalSummaries,
    },
    telnyx_ledger: {
      release_mode: releaseSettings?.mode ?? "missing",
      protection_manifest_verified: Boolean(
        releaseSettings?.protection_manifest_verified_at
      ),
      dry_run_recorded: Boolean(releaseSettings?.dry_run_completed_at),
      managed_resources: database.managedResources.length,
      managed_by_type: countObject(
        database.managedResources,
        (row) => row.resource_type
      ),
      managed_by_ownership: countObject(
        database.managedResources,
        (row) => row.ownership_state
      ),
      phone_provider_namespaces: phoneNamespaceCounts,
      protections: database.protections.length,
      open_runs: openRuns.length,
      due_reasons: dueReasons.length,
      due_actions: dueActions.length,
      phone_actions_missing_previous_status:
        phoneActionsMissingPreviousStatus.length,
    },
    blockers,
    warnings,
  };
}

async function readAllRows(supabase, table, columns, orderColumn) {
  const rows = [];
  for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + DATABASE_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (!Array.isArray(data)) {
      throw new Error(`Failed to read ${table}: response was not an array`);
    }
    rows.push(...data);
    if (data.length < DATABASE_PAGE_SIZE) return rows;
  }
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

async function listStripePages(loadPage) {
  const rows = [];
  let startingAfter;
  for (;;) {
    const page = await loadPage(startingAfter);
    if (!page || !Array.isArray(page.data)) {
      throw new Error("Stripe list returned an invalid page");
    }
    rows.push(...page.data);
    if (!page.has_more) return rows;
    const lastId = page.data.at(-1)?.id;
    if (!lastId) throw new Error("Stripe pagination did not advance");
    startingAfter = lastId;
  }
}

function splitArgument(argument) {
  const equals = argument.indexOf("=");
  return equals === -1
    ? [argument, null]
    : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function requirePriceId(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  if (!value.startsWith("price_")) {
    throw new Error(`${name} must be a Stripe Price ID`);
  }
  return value;
}

function validUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function stripeCustomerId(customer) {
  if (typeof customer === "string" && customer.startsWith("cus_")) {
    return customer;
  }
  if (
    customer &&
    typeof customer === "object" &&
    typeof customer.id === "string" &&
    customer.id.startsWith("cus_")
  ) {
    return customer.id;
  }
  return null;
}

function countBy(rows, keyFor) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countObject(rows, keyFor) {
  const result = {};
  for (const row of rows) increment(result, String(keyFor(row)));
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function addIssue(target, code, message, refs = [], count = 1) {
  target.push({
    code,
    message,
    count,
    refs: [...new Set(refs)].sort(),
  });
}

function uniqueRefs(rows, key) {
  return [
    ...new Set(
      rows
        .map((row) => row[key])
        .filter(Boolean)
        .map((value) => stableRef("business", value))
    ),
  ].sort();
}

function sortIssues(issues) {
  issues.sort((left, right) =>
    `${left.code}:${left.refs.join(",")}`.localeCompare(
      `${right.code}:${right.refs.join(",")}`
    )
  );
}

function timestampDue(value, nowMs) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

export function stableRef(kind, value) {
  const digest = createHash("sha256")
    .update(`${kind}:${String(value ?? "missing")}`)
    .digest("hex")
    .slice(0, 12);
  return `${kind}_${digest}`;
}

export function sanitizeError(error) {
  const message =
    error instanceof Error ? error.message : "Unknown inventory failure";
  return message
    .replace(/\b(?:sub|cus|bpc|price)_[A-Za-z0-9_]+\b/g, "[stripe_ref]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[uuid]"
    )
    .replace(/\+[1-9][0-9]{7,14}\b/g, "[phone]");
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
    const report = await buildInventory({ stripe, supabase, config });
    console.log(JSON.stringify(report, null, 2));
    if (report.verdict !== "pass") process.exitCode = 2;
  } catch (error) {
    console.error(
      JSON.stringify({
        schema_version: 1,
        operation: "read_only_inventory",
        verdict: "incomplete",
        error: sanitizeError(error),
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
