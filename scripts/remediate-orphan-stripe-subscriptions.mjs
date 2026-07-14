#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const API_VERSION = "2026-02-25.clover";
const PAGE_SIZE = 100;
const DATABASE_PAGE_SIZE = 1000;
const LIVE_CONFIRMATION = "CANCEL_LIVE_STRIPE_SUBSCRIPTIONS";
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]+$/;
const REVIEW_HASH_PATTERN = /^[0-9a-f]{64}$/;

const HELP = `Usage:
  node scripts/remediate-orphan-stripe-subscriptions.mjs \\
    --stripe-mode <test|live> \\
    --supabase-project-ref <project-ref>

Dry-run is the default and performs no writes.

Apply an explicitly reviewed list:
  node scripts/remediate-orphan-stripe-subscriptions.mjs \\
    --stripe-mode live \\
    --supabase-project-ref <project-ref> \\
    --apply sub_123 \\
    --apply sub_456 \\
    --review-hash <hash-from-dry-run> \\
    --confirm-live ${LIVE_CONFIRMATION}

Required environment variables:
  STRIPE_SECRET_KEY
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

There is intentionally no --apply-all option. Every subscription ID supplied
to --apply must come from a manually reviewed dry-run report.`;

export class RemediationApplyError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RemediationApplyError";
    this.details = details;
  }
}

export function parseArguments(argv) {
  const singletonFlags = new Set();
  const parsed = {
    help: false,
    stripeMode: null,
    projectRef: null,
    applyIds: [],
    reviewHash: null,
    confirmLive: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const [flag, inlineValue] = splitArgument(argument);

    if (flag === "--help" || flag === "-h") {
      parsed.help = true;
      continue;
    }

    if (
      flag !== "--stripe-mode" &&
      flag !== "--supabase-project-ref" &&
      flag !== "--apply" &&
      flag !== "--review-hash" &&
      flag !== "--confirm-live"
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }

    if (flag !== "--apply") {
      if (singletonFlags.has(flag)) {
        throw new Error(`${flag} may be supplied only once`);
      }
      singletonFlags.add(flag);
    }

    if (flag === "--stripe-mode") parsed.stripeMode = value;
    if (flag === "--supabase-project-ref") parsed.projectRef = value;
    if (flag === "--review-hash") parsed.reviewHash = value;
    if (flag === "--confirm-live") parsed.confirmLive = value;
    if (flag === "--apply") {
      parsed.applyIds.push(
        ...value
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      );
    }
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

  const duplicateIds = parsed.applyIds.filter(
    (id, index) => parsed.applyIds.indexOf(id) !== index
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate --apply subscription ID: ${[...new Set(duplicateIds)].join(", ")}`
    );
  }
  for (const subscriptionId of parsed.applyIds) {
    if (!SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
      throw new Error(`Invalid Stripe subscription ID: ${subscriptionId}`);
    }
  }

  if (parsed.applyIds.length === 0) {
    if (parsed.reviewHash || parsed.confirmLive) {
      throw new Error(
        "--review-hash and --confirm-live are valid only with an explicit --apply list"
      );
    }
    return parsed;
  }

  if (!parsed.reviewHash || !REVIEW_HASH_PATTERN.test(parsed.reviewHash)) {
    throw new Error(
      "Applying requires --review-hash with the 64-character hash from the reviewed dry-run"
    );
  }
  if (
    parsed.stripeMode === "live" &&
    parsed.confirmLive !== LIVE_CONFIRMATION
  ) {
    throw new Error(
      `Live apply requires --confirm-live ${LIVE_CONFIRMATION}`
    );
  }
  if (parsed.stripeMode === "test" && parsed.confirmLive) {
    throw new Error("--confirm-live cannot be used with --stripe-mode test");
  }

  return parsed;
}

export function validateEnvironment(arguments_, environment) {
  const stripeSecretKey = environment.STRIPE_SECRET_KEY;
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required");
  const expectedStripePrefix =
    arguments_.stripeMode === "live" ? "sk_live_" : "sk_test_";
  if (!stripeSecretKey.startsWith(expectedStripePrefix)) {
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

  const isLocal =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1" ||
    parsedUrl.hostname === "::1";
  if (arguments_.stripeMode === "live") {
    if (isLocal || parsedUrl.protocol !== "https:") {
      throw new Error("Live Stripe mode requires a non-local HTTPS Supabase URL");
    }
  }

  if (isLocal) {
    if (arguments_.projectRef !== "local") {
      throw new Error(
        "Local Supabase URLs require --supabase-project-ref local"
      );
    }
  } else {
    if (!parsedUrl.hostname.endsWith(".supabase.co")) {
      throw new Error(
        "Supabase URL must be local or use the <project-ref>.supabase.co host"
      );
    }
    const actualProjectRef = parsedUrl.hostname.split(".")[0];
    if (arguments_.projectRef !== actualProjectRef) {
      throw new Error(
        `Supabase project mismatch: expected ${arguments_.projectRef}, URL resolves to ${actualProjectRef}`
      );
    }
  }

  return {
    stripeMode: arguments_.stripeMode,
    projectRef: arguments_.projectRef,
    stripeSecretKey,
    supabaseUrl: parsedUrl.toString().replace(/\/$/, ""),
    serviceRoleKey,
  };
}

export async function loadDatabaseState(supabase) {
  const [businesses, subscriptions, actions] = await Promise.all([
    readAllRows(
      supabase,
      "businesses",
      "id, owner_id, deleted_at, deletion_scheduled_for",
      "id"
    ),
    readAllRows(
      supabase,
      "subscriptions",
      "business_id, stripe_customer_id, stripe_subscription_id",
      "business_id"
    ),
    readAllRows(
      supabase,
      "account_deletion_stripe_actions",
      "business_id, stripe_subscription_id, desired_action, status, generation",
      "business_id"
    ),
  ]);

  return { businesses, subscriptions, actions };
}

export function classifySubscription({
  subscription,
  customer,
  customerLookupError = null,
  database,
  nonterminalBusinessCounts,
  nonterminalCustomerCounts,
  expectedLivemode,
}) {
  const subscriptionId = stringValue(subscription?.id);
  const customerId = stripeCustomerId(subscription?.customer);
  const businessId = metadataBusinessId(subscription?.metadata);
  const baseEvidence = evidenceForSubscription(
    subscription,
    customerId,
    businessId
  );
  const terminal = TERMINAL_STATUSES.has(subscription?.status);

  if (terminal) {
    return result("terminal", ["Stripe subscription is already terminal"], {
      ...baseEvidence,
      database: emptyDatabaseEvidence(),
    });
  }

  const ambiguous = (...reasons) =>
    result("ambiguous", reasons, {
      ...baseEvidence,
      database: databaseEvidence(database, businessId, subscriptionId, customerId),
    });

  if (subscription?.livemode !== expectedLivemode) {
    return ambiguous("Stripe subscription livemode does not match the selected mode");
  }
  if (!subscriptionId || !SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
    return ambiguous("Stripe subscription ID is missing or invalid");
  }
  if (!businessId) {
    return ambiguous(
      "Subscription metadata.business_id is missing or is not a valid UUID"
    );
  }
  if (!customerId) {
    return ambiguous("Stripe subscription has no string customer ID");
  }
  if (customerLookupError) {
    return ambiguous(`Stripe Customer lookup failed: ${customerLookupError}`);
  }
  if (!customer || customer.deleted === true) {
    return ambiguous("Stripe Customer is missing or deleted");
  }

  const customerBusinessId = metadataBusinessId(customer.metadata);
  if (!customerBusinessId) {
    return ambiguous(
      "Customer metadata.business_id is missing or is not a valid UUID"
    );
  }
  if (customerBusinessId !== businessId) {
    return ambiguous(
      "Subscription and Customer business metadata do not match"
    );
  }

  const business = database.businesses.find((row) => row.id === businessId);
  if (!business) {
    return ambiguous("Metadata business does not exist in Supabase");
  }
  if ((nonterminalBusinessCounts.get(businessId) ?? 0) !== 1) {
    return ambiguous("Business maps to multiple nonterminal Stripe subscriptions");
  }
  if ((nonterminalCustomerCounts.get(customerId) ?? 0) !== 1) {
    return ambiguous("Customer maps to multiple nonterminal Stripe subscriptions");
  }

  const relatedSubscriptions = relatedLocalSubscriptions(
    database,
    businessId,
    subscriptionId,
    customerId
  );
  const relatedActions = relatedDurableActions(
    database,
    businessId,
    subscriptionId
  );
  const evidence = {
    ...baseEvidence,
    database: databaseEvidence(database, businessId, subscriptionId, customerId),
  };
  const exactLocalMatch =
    relatedSubscriptions.length === 1 &&
    relatedSubscriptions[0].business_id === businessId &&
    relatedSubscriptions[0].stripe_subscription_id === subscriptionId &&
    relatedSubscriptions[0].stripe_customer_id === customerId;
  const exactActions = relatedActions.filter(
    (action) =>
      action.business_id === businessId &&
      action.stripe_subscription_id === subscriptionId
  );
  const hasConflictingAction = exactActions.length !== relatedActions.length;

  if (business.deleted_at == null) {
    if (exactLocalMatch && relatedActions.length === 0) {
      return result(
        "active_local_match",
        ["Active business has exact local subscription linkage"],
        evidence
      );
    }
    return result(
      "ambiguous",
      ["Active business does not have one exact, conflict-free local linkage"],
      evidence
    );
  }

  if (hasConflictingAction) {
    return result(
      "ambiguous",
      ["Durable Stripe action linkage conflicts with Stripe metadata"],
      evidence
    );
  }

  const localRowsConflict = relatedSubscriptions.some(
    (row) =>
      row.business_id !== businessId ||
      row.stripe_subscription_id !== subscriptionId ||
      row.stripe_customer_id !== customerId
  );
  if (localRowsConflict) {
    return result(
      "ambiguous",
      ["Local subscription linkage conflicts with Stripe metadata"],
      evidence
    );
  }

  if (business.deletion_scheduled_for != null) {
    return result(
      "managed_deletion",
      ["Soft-deletion or cleanup workflow still owns this business"],
      evidence
    );
  }

  if (relatedActions.length > 0) {
    return result(
      "managed_deletion",
      ["A durable account-deletion Stripe action still owns this subscription"],
      evidence
    );
  }

  if (business.owner_id != null) {
    return result(
      "ambiguous",
      ["Completed tombstone shape is invalid because owner_id is still present"],
      evidence
    );
  }
  if (relatedSubscriptions.length > 0) {
    return result(
      "ambiguous",
      ["Completed tombstone still has local subscription linkage"],
      evidence
    );
  }
  return result(
    "safe_candidate",
    ["Completed tombstone has exact Stripe metadata and no live DB linkage"],
    evidence
  );
}

export async function buildAudit({
  stripe,
  supabase,
  config,
  loadDatabase = loadDatabaseState,
  refreshSubscriptionIds = [],
}) {
  const [account, subscriptions, database] = await Promise.all([
    stripe.accounts.retrieve(),
    listAllStripeSubscriptions(stripe),
    loadDatabase(supabase),
  ]);

  for (const subscriptionId of refreshSubscriptionIds) {
    const refreshed = await stripe.subscriptions.retrieve(subscriptionId);
    const existingIndex = subscriptions.findIndex(
      (subscription) => subscription.id === subscriptionId
    );
    if (existingIndex === -1) subscriptions.push(refreshed);
    else subscriptions[existingIndex] = refreshed;
  }

  if (!account || typeof account.id !== "string" || !account.id) {
    throw new Error("Stripe account lookup returned an invalid account");
  }

  const expectedLivemode = config.stripeMode === "live";
  const modeMismatch = subscriptions.find(
    (subscription) => subscription.livemode !== expectedLivemode
  );
  if (modeMismatch) {
    throw new Error(
      `Stripe subscription ${modeMismatch.id ?? "unknown"} livemode does not match --stripe-mode ${config.stripeMode}`
    );
  }

  const nonterminal = subscriptions.filter(
    (subscription) => !TERMINAL_STATUSES.has(subscription.status)
  );
  const nonterminalBusinessCounts = countBy(nonterminal, (subscription) =>
    metadataBusinessId(subscription.metadata)
  );
  const nonterminalCustomerCounts = countBy(nonterminal, (subscription) =>
    stripeCustomerId(subscription.customer)
  );
  const customerCache = new Map();
  const classifications = [];

  for (const subscription of subscriptions) {
    let customer = null;
    let customerLookupError = null;
    if (!TERMINAL_STATUSES.has(subscription.status)) {
      const customerId = stripeCustomerId(subscription.customer);
      if (customerId) {
        if (!customerCache.has(customerId)) {
          try {
            customerCache.set(
              customerId,
              await stripe.customers.retrieve(customerId)
            );
          } catch (error) {
            if (!isResourceMissing(error)) throw error;
            customerCache.set(customerId, {
              id: customerId,
              deleted: true,
              missing: true,
            });
          }
        }
        customer = customerCache.get(customerId);
        if (customer?.missing === true) {
          customerLookupError = "resource_missing";
        }
      }
    }

    classifications.push(
      classifySubscription({
        subscription,
        customer,
        customerLookupError,
        database,
        nonterminalBusinessCounts,
        nonterminalCustomerCounts,
        expectedLivemode,
      })
    );
  }

  classifications.sort((left, right) =>
    String(left.subscription_id).localeCompare(String(right.subscription_id))
  );
  const safeCandidates = classifications.filter(
    (entry) => entry.classification === "safe_candidate"
  );
  const reviewHash = buildReviewHash({
    stripeAccountId: account.id,
    stripeMode: config.stripeMode,
    projectRef: config.projectRef,
    safeCandidates,
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    stripe_account_id: account.id,
    stripe_mode: config.stripeMode,
    supabase_project_ref: config.projectRef,
    counts: countClassifications(classifications),
    safe_candidate_ids: safeCandidates.map((entry) => entry.subscription_id),
    review_hash: reviewHash,
    subscriptions: classifications,
  };
}

export function buildReviewHash({
  stripeAccountId,
  stripeMode,
  projectRef,
  safeCandidates,
}) {
  const candidates = safeCandidates
    .map((candidate) => ({
      subscription_id: candidate.subscription_id,
      customer_id: candidate.customer_id,
      business_id: candidate.business_id,
      status: candidate.stripe.status,
      livemode: candidate.stripe.livemode,
      cancel_at_period_end: candidate.stripe.cancel_at_period_end,
      pause_collection: candidate.stripe.pause_collection,
    }))
    .sort((left, right) =>
      String(left.subscription_id).localeCompare(String(right.subscription_id))
    );

  return createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 1,
        stripe_account_id: stripeAccountId,
        stripe_mode: stripeMode,
        supabase_project_ref: projectRef,
        safe_candidates: candidates,
      })
    )
    .digest("hex");
}

export async function runRemediation({
  stripe,
  supabase,
  config,
  applyIds = [],
  reviewHash = null,
  loadDatabase = loadDatabaseState,
}) {
  const duplicateApplyIds = applyIds.filter(
    (id, index) => applyIds.indexOf(id) !== index
  );
  if (duplicateApplyIds.length > 0) {
    throw new Error(
      `Apply list contains duplicate subscriptions: ${[...new Set(duplicateApplyIds)].join(", ")}`
    );
  }
  for (const subscriptionId of applyIds) {
    if (!SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
      throw new Error(`Invalid Stripe subscription ID: ${subscriptionId}`);
    }
  }

  const audit = await buildAudit({ stripe, supabase, config, loadDatabase });
  if (applyIds.length === 0) {
    return { operation: "dry_run", mutated: false, audit };
  }

  if (reviewHash !== audit.review_hash) {
    throw new Error(
      `Reviewed evidence is stale: supplied ${reviewHash}, current ${audit.review_hash}`
    );
  }

  const safeIds = new Set(audit.safe_candidate_ids);
  const unsafeIds = applyIds.filter((id) => !safeIds.has(id));
  if (unsafeIds.length > 0) {
    throw new Error(
      `Apply list contains subscriptions that are not current safe candidates: ${unsafeIds.join(", ")}`
    );
  }

  const applied = [];
  for (const subscriptionId of applyIds) {
    try {
      const immediateAudit = await buildAudit({
        stripe,
        supabase,
        config,
        loadDatabase,
        refreshSubscriptionIds: [subscriptionId],
      });
      const current = immediateAudit.subscriptions.find(
        (entry) => entry.subscription_id === subscriptionId
      );
      if (!current || current.classification !== "safe_candidate") {
        throw new Error(
          `Subscription ${subscriptionId} is no longer a safe candidate immediately before cancellation`
        );
      }

      await stripe.subscriptions.cancel(
        subscriptionId,
        { invoice_now: false, prorate: false },
        {
          idempotencyKey: `simplassist-orphan-remediation-${subscriptionId}`,
        }
      );
      const verified = await stripe.subscriptions.retrieve(subscriptionId);
      if (verified.status !== "canceled") {
        throw new Error(
          `Stripe subscription ${subscriptionId} did not verify as canceled`
        );
      }
      applied.push({ subscription_id: subscriptionId, status: "canceled" });
    } catch (error) {
      throw new RemediationApplyError(
        `Stopped while applying ${subscriptionId}: ${errorMessage(error)}`,
        {
          failed_subscription_id: subscriptionId,
          applied_subscription_ids: applied.map((entry) => entry.subscription_id),
        }
      );
    }
  }

  return {
    operation: "apply",
    mutated: applied.length > 0,
    reviewed_hash: reviewHash,
    applied,
    initial_audit: audit,
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
    if (error) {
      throw new Error(`Failed to read ${table}: ${error.message}`);
    }
    if (!Array.isArray(data)) {
      throw new Error(`Failed to read ${table}: response was not an array`);
    }
    rows.push(...data);
    if (data.length < DATABASE_PAGE_SIZE) return rows;
  }
}

async function listAllStripeSubscriptions(stripe) {
  const subscriptions = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (!page || !Array.isArray(page.data)) {
      throw new Error("Stripe subscription list returned an invalid page");
    }
    subscriptions.push(...page.data);
    if (!page.has_more) return subscriptions;
    const lastId = page.data.at(-1)?.id;
    if (!lastId) {
      throw new Error("Stripe subscription pagination did not advance");
    }
    startingAfter = lastId;
  }
}

function result(classification, reasons, evidence) {
  return {
    subscription_id: evidence.subscription_id,
    customer_id: evidence.customer_id,
    business_id: evidence.business_id,
    classification,
    reasons,
    stripe: evidence.stripe,
    database: evidence.database,
    proposed_action:
      classification === "safe_candidate"
        ? {
            action: "cancel",
            invoice_now: false,
            prorate: false,
          }
        : null,
  };
}

function evidenceForSubscription(subscription, customerId, businessId) {
  return {
    subscription_id: stringValue(subscription?.id),
    customer_id: customerId,
    business_id: businessId,
    stripe: {
      status: subscription?.status ?? null,
      livemode:
        typeof subscription?.livemode === "boolean"
          ? subscription.livemode
          : null,
      cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
      pause_collection: normalizePauseCollection(subscription?.pause_collection),
    },
  };
}

function databaseEvidence(database, businessId, subscriptionId, customerId) {
  if (!businessId) return emptyDatabaseEvidence();
  const business = database.businesses.find((row) => row.id === businessId);
  return {
    business_state: business
      ? business.deleted_at == null
        ? "active"
        : business.deletion_scheduled_for == null && business.owner_id == null
          ? "completed_tombstone"
          : "deleted_incomplete_or_managed"
      : "missing",
    related_local_subscription_count: relatedLocalSubscriptions(
      database,
      businessId,
      subscriptionId,
      customerId
    ).length,
    related_durable_action_count: relatedDurableActions(
      database,
      businessId,
      subscriptionId
    ).length,
  };
}

function emptyDatabaseEvidence() {
  return {
    business_state: "unknown",
    related_local_subscription_count: 0,
    related_durable_action_count: 0,
  };
}

function relatedLocalSubscriptions(
  database,
  businessId,
  subscriptionId,
  customerId
) {
  return database.subscriptions.filter(
    (row) =>
      row.business_id === businessId ||
      row.stripe_subscription_id === subscriptionId ||
      row.stripe_customer_id === customerId
  );
}

function relatedDurableActions(database, businessId, subscriptionId) {
  return database.actions.filter(
    (row) =>
      row.business_id === businessId ||
      row.stripe_subscription_id === subscriptionId
  );
}

function countBy(items, keyForItem) {
  const counts = new Map();
  for (const item of items) {
    const key = keyForItem(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countClassifications(classifications) {
  const counts = {
    total: classifications.length,
    safe_candidate: 0,
    active_local_match: 0,
    managed_deletion: 0,
    ambiguous: 0,
    terminal: 0,
  };
  for (const entry of classifications) counts[entry.classification]++;
  return counts;
}

function metadataBusinessId(metadata) {
  const value = metadata?.business_id;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function stripeCustomerId(customer) {
  if (typeof customer === "string") return customer;
  return customer && typeof customer.id === "string" ? customer.id : null;
}

function normalizePauseCollection(pauseCollection) {
  if (!pauseCollection || typeof pauseCollection !== "object") return null;
  return {
    behavior:
      typeof pauseCollection.behavior === "string"
        ? pauseCollection.behavior
        : null,
    resumes_at:
      typeof pauseCollection.resumes_at === "number"
        ? pauseCollection.resumes_at
        : null,
  };
}

function stringValue(value) {
  return typeof value === "string" ? value : null;
}

function splitArgument(argument) {
  const equalsIndex = argument.indexOf("=");
  return equalsIndex === -1
    ? [argument, null]
    : [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)];
}

function isResourceMissing(error) {
  return error?.code === "resource_missing" && error?.statusCode === 404;
}

function errorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const config = validateEnvironment(arguments_, process.env);
  const stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: API_VERSION,
    typescript: true,
    maxNetworkRetries: 2,
  });
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await runRemediation({
    stripe,
    supabase,
    config,
    applyIds: arguments_.applyIds,
    reviewHash: arguments_.reviewHash,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  main().catch((error) => {
    const output = {
      success: false,
      error: errorMessage(error),
      ...(error instanceof RemediationApplyError
        ? { apply: error.details }
        : {}),
    };
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = 1;
  });
}
