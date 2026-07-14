#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PROJECT_NAME = path.basename(REPO_ROOT);
const NEXT_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);
const REQUIRED_MIGRATIONS = ["029"];
const CRASH_LEASE_SECONDS = 5;
const DAY_SECONDS = 24 * 60 * 60;
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 90_000;
const STRIPE_ASYNC_POLL_INTERVAL_MS = 2_000;
const STRIPE_ASYNC_TIMEOUT_MS = 5 * 60_000;
const INVOICE_FINALIZATION_ADVANCE_SECONDS = 2 * 60 * 60;
const NEXT_START_TIMEOUT_MS = 120_000;
const LOCAL_HEALTH_REQUEST_TIMEOUT_MS = 10_000;
const LOCAL_ROUTE_REQUEST_TIMEOUT_MS = 120_000;
const E2E_API_VERSION = "2026-02-25.clover";

const stripeSecretKey = requireTestSecretKey(process.env.STRIPE_SECRET_KEY);
const runId = randomUUID();
const runToken = runId.replaceAll("-", "");
const webhookSecret = `whsec_${randomBytes(32).toString("hex")}`;
const cronSecret = randomBytes(32).toString("hex");

const resources = {
  authUserId: null,
  businessId: null,
  customerId: null,
  paymentMethodId: null,
  priceId: null,
  productId: null,
  subscriptionId: null,
  testClockId: null,
  webhookEventIds: [],
};

let admin = null;
let nextProcess = null;
let stripeModeVerified = false;
let primaryFailure = null;

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: E2E_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 20_000,
});

try {
  await main();
} catch (error) {
  primaryFailure = error;
  process.exitCode = 1;
  console.error(`\nE2E FAILED: ${errorMessage(error)}`);
} finally {
  const cleanupErrors = await cleanup();
  if (cleanupErrors.length > 0) {
    process.exitCode = 1;
    console.error("\nCleanup did not fully complete:");
    for (const cleanupError of cleanupErrors) {
      console.error(`- ${cleanupError}`);
    }
    console.error("Tracked test resource IDs:", safeResourceSummary());
  }

  if (!primaryFailure && cleanupErrors.length === 0) {
    console.log("\nPASS: account-deletion Stripe test-mode E2E completed and cleaned up.");
  }
}

async function main() {
  console.log(`Account-deletion Stripe E2E run ${runId}`);
  console.log("Preflight: local Supabase isolation and migration catalog");

  const {
    apiUrl: localSupabaseUrl,
    publishableKey: anonKey,
    secretKey: serviceRoleKey,
  } = readLocalSupabaseStatus();
  assertLoopbackSupabaseUrl(localSupabaseUrl);
  const localStack = inspectLocalSupabaseStack();
  assertRequiredMigrationCatalog(localStack.databaseContainer);
  applyLocalDataApiGrantShim(
    localStack.databaseContainer,
    localSupabaseUrl
  );
  assertLocalNextRuntime();

  admin = createClient(localSupabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await waitFor(
    "local Supabase auth health",
    async () => {
      const response = await fetchWithTimeout(
        `${localSupabaseUrl}/auth/v1/health`,
        { headers: { apikey: anonKey } },
        LOCAL_HEALTH_REQUEST_TIMEOUT_MS
      );
      return requireHealthyResponse(response, "Supabase auth health");
    },
    60_000
  );

  await waitFor(
    "local Supabase REST health",
    async () => {
      const response = await fetchWithTimeout(
        `${localSupabaseUrl}/rest/v1/`,
        {
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
          },
        },
        LOCAL_HEALTH_REQUEST_TIMEOUT_MS
      );
      return requireHealthyResponse(response, "Supabase REST health");
    },
    60_000
  );

  const serviceRoleProbe = await fetchWithTimeout(
    `${localSupabaseUrl}/rest/v1/businesses?select=id&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    },
    LOCAL_HEALTH_REQUEST_TIMEOUT_MS
  );
  await requireHealthyResponse(
    serviceRoleProbe,
    "Supabase service-role businesses probe"
  );

  const { count: preexistingExpiredCount, error: expiredQueryError } =
    await admin
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null)
      .lt("deletion_scheduled_for", new Date().toISOString());
  assertSupabaseSuccess(expiredQueryError, "query pre-existing expired businesses");
  assert.equal(
    preexistingExpiredCount,
    0,
    "The local stack contains an expired deleted business. Reset or clean the disposable local stack before running this harness."
  );
  const { count: preexistingActionCount, error: actionCountError } = await admin
    .from("account_deletion_stripe_actions")
    .select("business_id", { count: "exact", head: true });
  assertSupabaseSuccess(actionCountError, "query pre-existing Stripe actions");
  assert.equal(
    preexistingActionCount,
    0,
    "The local stack contains durable account-deletion Stripe work. Reset or clean the disposable local stack before running this harness."
  );

  console.log("Preflight: Stripe key prefix and read-only livemode sentinel");
  const balance = await stripe.balance.retrieve();
  assertTestModeObject("Stripe balance", balance);
  stripeModeVerified = true;

  console.log("Create: Stripe Test Clock, product, price, customer, and subscription");
  const initialFrozenTime = Math.floor(Date.now() / 1000);
  const testClock = await stripeMutation("create Test Clock", () =>
    stripe.testHelpers.testClocks.create({
      frozen_time: initialFrozenTime,
      name: `SimplAssist account deletion E2E ${runId}`,
    })
  );
  resources.testClockId = testClock.id;

  const product = await stripeMutation("create product", () =>
    stripe.products.create({
      name: `SimplAssist account deletion E2E ${runId}`,
      metadata: runMetadata(),
    })
  );
  resources.productId = product.id;

  const price = await stripeMutation("create recurring price", () =>
    stripe.prices.create({
      currency: "usd",
      product: product.id,
      recurring: { interval: "month" },
      unit_amount: 100,
      metadata: runMetadata(),
    })
  );
  resources.priceId = price.id;

  const fixturePassword = randomBytes(24).toString("base64url");
  const fixtureEmail = `stripe-account-deletion-e2e+${runToken}@example.invalid`;
  const { data: createdUser, error: createUserError } =
    await admin.auth.admin.createUser({
      email: fixtureEmail,
      password: fixturePassword,
      email_confirm: true,
      user_metadata: { e2e_run_id: runId },
    });
  assertSupabaseSuccess(createUserError, "create local auth fixture");
  assert(createdUser.user, "Local auth fixture creation returned no user");
  resources.authUserId = createdUser.user.id;

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .update({
      name: `Account deletion E2E ${runId}`,
      has_ein: false,
      telnyx_submission_disabled: true,
    })
    .eq("owner_id", resources.authUserId)
    .select("id")
    .single();
  assertSupabaseSuccess(businessError, "prepare local business fixture");
  resources.businessId = business.id;

  const customer = await stripeMutation("create customer", () =>
    stripe.customers.create({
      email: fixtureEmail,
      test_clock: testClock.id,
      metadata: runMetadata({ business_id: business.id }),
    })
  );
  assert(!customer.deleted, "Stripe returned a deleted customer fixture");
  resources.customerId = customer.id;

  const paymentMethod = await stripeMutation("create payment method", () =>
    stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" },
      metadata: runMetadata(),
    })
  );
  resources.paymentMethodId = paymentMethod.id;

  await stripeMutation("attach payment method", () =>
    stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id })
  );
  await stripeMutation("set customer default payment method", () =>
    stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    })
  );

  const initialSubscription = await stripeMutation("create subscription", () =>
    stripe.subscriptions.create({
      customer: customer.id,
      default_payment_method: paymentMethod.id,
      items: [{ price: price.id }],
      metadata: runMetadata({ business_id: business.id }),
      payment_behavior: "error_if_incomplete",
      expand: ["latest_invoice"],
    })
  );
  resources.subscriptionId = initialSubscription.id;
  assert.equal(initialSubscription.status, "active");
  assert.equal(initialSubscription.pause_collection, null);

  const initialItem = requirePrimarySubscriptionItem(initialSubscription);
  const originalBillingAnchor = initialSubscription.billing_cycle_anchor;
  assert(Number.isSafeInteger(originalBillingAnchor));
  assert(Number.isSafeInteger(initialItem.current_period_end));

  const initialInvoices = await listSubscriptionInvoices(initialSubscription.id);
  assert(initialInvoices.length > 0, "Subscription creation produced no invoice");
  const initialInvoice = initialInvoices[0];
  assert.equal(initialInvoice.status, "paid");
  assert(initialInvoice.amount_paid > 0, "Initial subscription invoice was not paid");
  const initialCharges = await listCustomerCharges(customer.id);
  assert(
    initialCharges.some((charge) => charge.paid && charge.status === "succeeded"),
    "Initial subscription payment did not produce a successful test charge"
  );

  const nowIso = new Date().toISOString();
  const { error: subscriptionInsertError } = await admin
    .from("subscriptions")
    .insert({
      business_id: business.id,
      stripe_customer_id: customer.id,
      stripe_subscription_id: initialSubscription.id,
      stripe_price_id: price.id,
      stripe_setup_fee_price_id: price.id,
      plan: "sms_only",
      status: "active",
      current_period_start: new Date(
        initialItem.current_period_start * 1000
      ).toISOString(),
      current_period_end: new Date(
        initialItem.current_period_end * 1000
      ).toISOString(),
      setup_fee_paid_at: nowIso,
      cancel_at_period_end: false,
      updated_at: nowIso,
    });
  assertSupabaseSuccess(subscriptionInsertError, "create local subscription fixture");

  const authCookie = await createAuthenticatedCookie({
    anonKey,
    email: fixtureEmail,
    password: fixturePassword,
    supabaseUrl: localSupabaseUrl,
  });

  const port = await findOpenPort();
  const appUrl = `http://127.0.0.1:${port}`;
  nextProcess = startNextServer({
    anonKey,
    appUrl,
    cronSecret,
    port,
    priceId: price.id,
    serviceRoleKey,
    stripeSecretKey,
    supabaseUrl: localSupabaseUrl,
    webhookSecret,
  });
  await waitForNextServer(appUrl);

  console.log("Assert: first deletion applies reversible void pause");
  const firstDelete = await requestJson(appUrl, "/api/account", {
    method: "DELETE",
    cookie: authCookie,
  });
  assert.equal(firstDelete.status, 200, responseFailure(firstDelete));
  assert.equal(firstDelete.body.success, true);

  const firstDeletedBusiness = await readBusiness(business.id);
  assert(firstDeletedBusiness.deleted_at, "Business was not soft-deleted");
  assert(
    firstDeletedBusiness.deletion_scheduled_for,
    "Business has no grace-period deadline"
  );
  const firstGraceMs =
    Date.parse(firstDeletedBusiness.deletion_scheduled_for) -
    Date.parse(firstDeletedBusiness.deleted_at);
  assert.equal(firstGraceMs, 60 * DAY_SECONDS * 1000);

  const firstPauseAction = await readStripeAction(business.id);
  assert.equal(firstPauseAction.desired_action, "pause");
  assert.equal(firstPauseAction.status, "applied");
  assert.equal(firstPauseAction.applied_action, "pause");
  await assertLocalSubscriptionCount(business.id, 1);

  const pausedSubscription = await retrieveSubscription(initialSubscription.id);
  assert.equal(pausedSubscription.status, "active");
  assert.equal(pausedSubscription.pause_collection?.behavior, "void");
  assert.equal(pausedSubscription.pause_collection?.resumes_at ?? null, null);

  console.log("Assert: grace-period renewal is void and collects nothing");
  const invoiceIdsBeforeGraceRenewal = new Set(
    initialInvoices.map((invoice) => invoice.id)
  );
  const chargeIdsBeforeGraceRenewal = new Set(
    initialCharges.map((charge) => charge.id)
  );
  await advanceClock(testClock.id, initialItem.current_period_end + 60);

  const renewalInvoicesAtBoundary = await waitForNewSubscriptionInvoices(
    initialSubscription.id,
    invoiceIdsBeforeGraceRenewal,
    "grace-period renewal invoice creation"
  );
  console.log(
    "Observed grace-period renewal invoices at the billing boundary:",
    summarizeInvoices(renewalInvoicesAtBoundary)
  );
  for (const invoice of renewalInvoicesAtBoundary) {
    assert(
      invoice.status === "draft" || invoice.status === "void",
      `Grace-period renewal invoice ${invoice.id} had unexpected boundary status ${String(invoice.status)}`
    );
    assert.equal(invoice.amount_paid, 0);
    if (invoice.status === "draft") {
      assert.equal(invoice.auto_advance, true);
    }
  }

  // Stripe Test Clocks create a renewal invoice at the billing boundary, but
  // normally leave it in draft for about one simulated hour. Real-time polling
  // cannot move a frozen clock through that finalization point. Once finalized,
  // pause_collection=void must transition the invoice to void.
  if (
    renewalInvoicesAtBoundary.some((invoice) => invoice.status !== "void")
  ) {
    await advanceClock(
      testClock.id,
      initialItem.current_period_end + INVOICE_FINALIZATION_ADVANCE_SECONDS
    );
  }

  const graceInvoices = await waitForVoidSubscriptionInvoices(
    initialSubscription.id,
    invoiceIdsBeforeGraceRenewal
  );
  assert(graceInvoices.length > 0);
  for (const invoice of graceInvoices) {
    assert.equal(invoice.status, "void");
    assert.equal(invoice.amount_paid, 0);
  }

  const chargesAfterGraceRenewal = await listCustomerCharges(customer.id);
  const collectedGraceCharges = chargesAfterGraceRenewal.filter(
    (charge) =>
      !chargeIdsBeforeGraceRenewal.has(charge.id) &&
      charge.paid &&
      charge.status === "succeeded"
  );
  assert.deepEqual(collectedGraceCharges, []);
  const preservedInitialInvoice = await retrieveInvoice(initialInvoice.id);
  assert.equal(preservedInitialInvoice.status, "paid");

  console.log("Assert: reactivation clears pause without moving the anchor");
  const reactivate = await requestJson(appUrl, "/api/account/reactivate", {
    method: "POST",
    cookie: authCookie,
  });
  assert.equal(reactivate.status, 200, responseFailure(reactivate));
  assert.equal(reactivate.body.success, true);

  const activeBusiness = await readBusiness(business.id);
  assert.equal(activeBusiness.deleted_at, null);
  assert.equal(activeBusiness.deletion_scheduled_for, null);
  assert.equal(await maybeReadStripeAction(business.id), null);
  await assertLocalSubscriptionCount(business.id, 1);

  const resumedSubscription = await retrieveSubscription(initialSubscription.id);
  assert.equal(resumedSubscription.status, "active");
  assert.equal(resumedSubscription.pause_collection, null);
  assert.equal(resumedSubscription.billing_cycle_anchor, originalBillingAnchor);

  const invoiceIdsAfterResume = new Set(
    (await listSubscriptionInvoices(initialSubscription.id)).map(
      (invoice) => invoice.id
    )
  );
  assert.deepEqual(invoiceIdsAfterResume, new Set([
    ...invoiceIdsBeforeGraceRenewal,
    ...graceInvoices.map((invoice) => invoice.id),
  ]));
  const chargeIdsAfterResume = new Set(
    (await listCustomerCharges(customer.id)).map((charge) => charge.id)
  );
  assert.deepEqual(chargeIdsAfterResume, new Set(chargeIdsBeforeGraceRenewal));

  console.log("Assert: a crash-held pause retries only after lease expiry");
  const crashDeletedAt = new Date();
  const crashScheduledFor = new Date(
    crashDeletedAt.getTime() + 60 * DAY_SECONDS * 1000
  );
  const { data: crashScheduled, error: crashScheduleError } = await admin.rpc(
    "schedule_account_deletion",
    {
      p_business_id: business.id,
      p_owner_id: resources.authUserId,
      p_deleted_at: crashDeletedAt.toISOString(),
      p_deletion_scheduled_for: crashScheduledFor.toISOString(),
    }
  );
  assertSupabaseSuccess(
    crashScheduleError,
    "commit crash-window deletion schedule"
  );
  assert.equal(crashScheduled.business_id, business.id);
  assert.equal(crashScheduled.stripe_action.desired_action, "pause");
  assert.equal(crashScheduled.stripe_action.status, "pending");
  const crashGeneration = crashScheduled.stripe_action.generation;
  assert(Number.isSafeInteger(crashGeneration));

  // Simulate a worker that committed its claim and then crashed before making
  // any Stripe call. The action must remain pending until this lease expires.
  const crashLeaseOwner = `account-deletion-e2e-crashed:${runId}`;
  const { data: crashClaim, error: crashClaimError } = await admin.rpc(
    "claim_account_deletion_stripe_action",
    {
      p_business_id: business.id,
      p_generation: crashGeneration,
      p_lease_owner: crashLeaseOwner,
      p_lease_seconds: CRASH_LEASE_SECONDS,
    }
  );
  assertSupabaseSuccess(crashClaimError, "claim crash-window pause action");
  assert(crashClaim, "Crash-window worker did not receive a lease");
  assert.equal(crashClaim.status, "pending");
  assert.equal(crashClaim.generation, crashGeneration);
  assert.equal(crashClaim.lease_owner, crashLeaseOwner);
  assert(crashClaim.lease_token);
  assert(crashClaim.lease_expires_at);
  const crashIdempotencyKey = crashClaim.idempotency_key;

  const preExpirySweep = await requestJson(appUrl, "/api/account/cleanup", {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assert.equal(preExpirySweep.status, 200, responseFailure(preExpirySweep));
  assert.equal(preExpirySweep.body.success, true);
  assert.equal(preExpirySweep.body.deleted_count, 0);
  assert.equal(preExpirySweep.body.failed_count, 0);

  const stillLeasedAction = await readStripeAction(business.id);
  assert.equal(stillLeasedAction.status, "pending");
  assert.equal(stillLeasedAction.generation, crashGeneration);
  assert.equal(stillLeasedAction.idempotency_key, crashIdempotencyKey);
  assert.equal(stillLeasedAction.lease_token, crashClaim.lease_token);
  assert.equal(stillLeasedAction.lease_owner, crashLeaseOwner);
  assert.equal(stillLeasedAction.attempt_count, 1);
  const stillUnpausedSubscription = await retrieveSubscription(
    initialSubscription.id
  );
  assert.equal(stillUnpausedSubscription.pause_collection, null);

  const observedExpiredAction = await waitFor(
    "crashed Stripe-action lease expiry",
    async () => {
      const action = await readStripeAction(business.id);
      return Date.parse(action.lease_expires_at) <= Date.now() ? action : null;
    },
    (CRASH_LEASE_SECONDS + 5) * 1000,
    250
  );
  assert.equal(observedExpiredAction.status, "pending");
  assert.equal(observedExpiredAction.lease_token, crashClaim.lease_token);

  const postExpirySweep = await requestJson(appUrl, "/api/account/cleanup", {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assert.equal(postExpirySweep.status, 200, responseFailure(postExpirySweep));
  assert.equal(postExpirySweep.body.success, true);
  assert.equal(postExpirySweep.body.deleted_count, 0);
  assert.equal(postExpirySweep.body.failed_count, 0);

  const recoveredPauseAction = await readStripeAction(business.id);
  assert.equal(recoveredPauseAction.desired_action, "pause");
  assert.equal(recoveredPauseAction.status, "applied");
  assert.equal(recoveredPauseAction.applied_action, "pause");
  assert.equal(recoveredPauseAction.generation, crashGeneration);
  assert.equal(recoveredPauseAction.idempotency_key, crashIdempotencyKey);
  assert.equal(recoveredPauseAction.lease_token, null);
  assert.equal(recoveredPauseAction.attempt_count, 2);
  const recoveredPausedSubscription = await retrieveSubscription(
    initialSubscription.id
  );
  assert.equal(recoveredPausedSubscription.pause_collection?.behavior, "void");

  let clock = await retrieveTestClock(testClock.id);
  const secondGraceTarget = clock.frozen_time + 61 * DAY_SECONDS;
  while (clock.frozen_time < secondGraceTarget) {
    const nextFrozenTime = Math.min(
      clock.frozen_time + 20 * DAY_SECONDS,
      secondGraceTarget
    );
    clock = await advanceClock(testClock.id, nextFrozenTime);
  }

  const cleanupInvoiceBaseline = new Set(
    (await listSubscriptionInvoices(initialSubscription.id)).map(
      (invoice) => invoice.id
    )
  );
  const cleanupChargeBaseline = new Set(
    (await listCustomerCharges(customer.id)).map((charge) => charge.id)
  );

  const { error: expireError } = await admin
    .from("businesses")
    .update({ deletion_scheduled_for: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", business.id);
  assertSupabaseSuccess(expireError, "expire disposable local grace period");

  const cleanupResponse = await requestJson(appUrl, "/api/account/cleanup", {
    method: "POST",
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  assert.equal(cleanupResponse.status, 200, responseFailure(cleanupResponse));
  assert.equal(cleanupResponse.body.success, true);
  assert.equal(cleanupResponse.body.deleted_count, 1);
  assert.equal(cleanupResponse.body.failed_count, 0);

  const canceledSubscription = await retrieveSubscription(
    initialSubscription.id
  );
  assert.equal(canceledSubscription.status, "canceled");
  assert.equal(canceledSubscription.cancel_at_period_end, false);
  assert(Number.isSafeInteger(canceledSubscription.canceled_at));

  const invoicesAfterCleanup = await listSubscriptionInvoices(
    initialSubscription.id
  );
  const cleanupCreatedInvoices = invoicesAfterCleanup.filter(
    (invoice) => !cleanupInvoiceBaseline.has(invoice.id)
  );
  assert.deepEqual(
    cleanupCreatedInvoices,
    [],
    "Immediate cleanup cancellation generated a final/proration invoice"
  );
  const chargesAfterCleanup = await listCustomerCharges(customer.id);
  const cleanupCreatedCharges = chargesAfterCleanup.filter(
    (charge) => !cleanupChargeBaseline.has(charge.id)
  );
  assert.deepEqual(
    cleanupCreatedCharges,
    [],
    "Immediate cleanup cancellation generated a charge"
  );

  const tombstone = await readBusiness(business.id);
  assert.equal(tombstone.owner_id, null);
  assert.equal(tombstone.name, "[deleted]");
  assert.equal(tombstone.deletion_scheduled_for, null);
  assert.equal(tombstone.cleanup_auth_user_id, null);
  assert.equal(await maybeReadStripeAction(business.id), null);
  await assertLocalSubscriptionCount(business.id, 0);
  await assertAuthUserDeleted(resources.authUserId);

  console.log("Assert: signed post-scrub webhooks cannot create a zombie row");
  const webhookCases = [
    {
      type: "customer.subscription.updated",
      object: canceledSubscription,
    },
    {
      type: "customer.subscription.deleted",
      object: canceledSubscription,
    },
    {
      type: "invoice.payment_failed",
      object: {
        id: `in_test_${runToken}`,
        object: "invoice",
        customer: customer.id,
        livemode: false,
      },
    },
    {
      type: "checkout.session.completed",
      object: {
        id: `cs_test_${runToken}`,
        object: "checkout.session",
        customer: customer.id,
        subscription: canceledSubscription.id,
        metadata: {
          business_id: business.id,
          setup_fee_price_id: price.id,
        },
        payment_status: "paid",
        status: "complete",
        livemode: false,
      },
    },
  ];

  for (const [index, webhookCase] of webhookCases.entries()) {
    assertTestModeObject(`${webhookCase.type} payload`, webhookCase.object);
    const event = buildTestEvent(
      `evt_test_${runToken}_${index + 1}`,
      webhookCase.type,
      webhookCase.object
    );
    resources.webhookEventIds.push(event.id);
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const webhookResponse = await requestJson(appUrl, "/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
    });
    assert.equal(webhookResponse.status, 200, responseFailure(webhookResponse));
    assert.equal(webhookResponse.body.received, true);
    await assertLocalSubscriptionCount(business.id, 0);
    const stillTombstoned = await readBusiness(business.id);
    assert.equal(stillTombstoned.owner_id, null);
    assert.equal(stillTombstoned.name, "[deleted]");
    assert.equal(await maybeReadStripeAction(business.id), null);

    const { data: webhookRow, error: webhookRowError } = await admin
      .from("stripe_webhook_events")
      .select("processed_at, processing_error")
      .eq("id", event.id)
      .single();
    assertSupabaseSuccess(webhookRowError, `read webhook event ${event.id}`);
    assert(webhookRow.processed_at, `Webhook ${event.id} was not marked processed`);
    assert.equal(webhookRow.processing_error, null);
  }
}

function requireTestSecretKey(value) {
  assert(value, "STRIPE_SECRET_KEY is required");
  assert.equal(
    value,
    value.trim(),
    "STRIPE_SECRET_KEY must not contain leading or trailing whitespace"
  );
  assert(
    /^sk_test_[A-Za-z0-9]+$/.test(value),
    "Refusing to run: STRIPE_SECRET_KEY must use the sk_test_ prefix"
  );
  assert(!value.startsWith("sk_live_"));
  assert(!value.startsWith("rk_"));
  return value;
}

function reassertTestKey() {
  assert.equal(requireTestSecretKey(process.env.STRIPE_SECRET_KEY), stripeSecretKey);
}

function assertTestModeObject(label, value) {
  assert(value && typeof value === "object", `${label} is not an object`);
  assert(
    Object.hasOwn(value, "livemode"),
    `${label} did not expose a livemode guard`
  );
  assert.equal(value.livemode, false, `${label} is not a test-mode object`);
  return value;
}

async function stripeMutation(label, operation) {
  reassertTestKey();
  assert(
    stripeModeVerified,
    `Refusing ${label}: read-only Stripe livemode sentinel was not verified`
  );
  const result = await operation();
  assertTestModeObject(`Result of ${label}`, result);
  return result;
}

function inspectLocalSupabaseStack() {
  const result = runCommand("docker", [
    "ps",
    "--format",
    "{{.Names}}",
  ], {
    remedy:
      "Start Docker Desktop and run `npx --yes supabase start` from this repository.",
  });
  const containers = result.stdout.split("\n").filter(Boolean);
  findProjectContainer(containers, "auth");
  const databaseContainer = findProjectContainer(containers, "db");
  findProjectContainer(containers, "kong");
  findProjectContainer(containers, "rest");
  return { databaseContainer };
}

function findProjectContainer(containers, service) {
  const exactName = `supabase_${service}_${PROJECT_NAME}`;
  const container = containers.find((name) => name === exactName);
  assert(
    container,
    `Disposable local Supabase container ${exactName} is not running. ` +
      "Run `npx --yes supabase start` from this repository and retry."
  );
  return container;
}

function readLocalSupabaseStatus() {
  const { stdout } = runCommand(
    "npx",
    ["--yes", "supabase", "status", "-o", "env"],
    {
      remedy:
        "Run `npx --yes supabase start` from this repository, then retry the harness.",
    }
  );
  const values = new Map();

  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const name = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    values.set(name, unquoteStatusValue(line.slice(separator + 1).trim()));
  }

  const apiUrl = requireStatusValue(values, ["API_URL", "SUPABASE_URL"]);
  const publishableKey = requireStatusValue(values, [
    "PUBLISHABLE_KEY",
    "ANON_KEY",
  ]);
  const secretKey = requireStatusValue(values, [
    "SECRET_KEY",
    "SERVICE_ROLE_KEY",
  ]);

  assert(
    publishableKey.startsWith("sb_publishable_"),
    "Local Supabase status did not return an sb_publishable_ key. " +
      "Update the Supabase CLI used by npx and restart the disposable local stack."
  );
  assert(
    secretKey.startsWith("sb_secret_"),
    "Local Supabase status did not return an sb_secret_ key. " +
      "Update the Supabase CLI used by npx and restart the disposable local stack."
  );

  return { apiUrl, publishableKey, secretKey };
}

function requireStatusValue(values, names) {
  for (const name of names) {
    const value = values.get(name);
    if (value) return value;
  }
  throw new Error(
    `supabase status -o env omitted ${names.join("/")} (reported variables: ${[
      ...values.keys(),
    ].join(", ") || "none"})`
  );
}

function unquoteStatusValue(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("supabase status returned an invalid quoted value");
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function assertRequiredMigrationCatalog(databaseContainer) {
  const quoted = REQUIRED_MIGRATIONS.map((version) => `'${version}'`).join(",");
  const sql =
    "SELECT version FROM supabase_migrations.schema_migrations " +
    `WHERE version IN (${quoted}) ORDER BY version`;
  const { stdout } = runLocalPsql(databaseContainer, sql);
  const applied = stdout.split("\n").filter(Boolean);
  if (
    applied.length !== REQUIRED_MIGRATIONS.length ||
    applied.some((version, index) => version !== REQUIRED_MIGRATIONS[index])
  ) {
    throw new Error(
      `Local migration catalog is missing ${REQUIRED_MIGRATIONS.join(", ")}. ` +
        "Run `npx --yes supabase db reset` and retry. If replay stops at migration 009 because `cron.schedule` is unavailable, enable pg_cron in the disposable local database first; that fresh-stack migration prerequisite is a known backlog item."
    );
  }
}

function applyLocalDataApiGrantShim(databaseContainer, supabaseUrl) {
  // This mutates only the disposable local database container found above.
  // Keep both URL and container guards adjacent to the shim so a future caller
  // cannot reuse it against a hosted project.
  assertLoopbackSupabaseUrl(supabaseUrl);
  assert.equal(
    databaseContainer,
    `supabase_db_${PROJECT_NAME}`,
    "Refusing to apply the local grants shim outside this repository's disposable Supabase database container"
  );

  const sql = `
BEGIN;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.businesses TO authenticated;

-- Preserve migration 029's service-role-only boundary after the legacy local
-- grants shim. In particular, anon/authenticated still get no action-table
-- privileges and service_role does not gain TRUNCATE/REFERENCES/TRIGGER.
REVOKE ALL ON TABLE public.account_deletion_stripe_actions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.account_deletion_stripe_actions TO service_role;
COMMIT;

SELECT CASE WHEN
  has_table_privilege('service_role', 'public.businesses', 'SELECT,INSERT,UPDATE,DELETE')
  AND has_table_privilege('service_role', 'public.subscriptions', 'SELECT,INSERT,UPDATE,DELETE')
  AND has_table_privilege('service_role', 'public.stripe_webhook_events', 'SELECT,INSERT,UPDATE,DELETE')
  AND has_table_privilege('authenticated', 'public.businesses', 'SELECT')
  AND has_table_privilege('service_role', 'public.account_deletion_stripe_actions', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role', 'public.account_deletion_stripe_actions', 'TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('anon', 'public.account_deletion_stripe_actions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.account_deletion_stripe_actions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
THEN 'ready' ELSE 'invalid' END;
`;
  const { stdout } = runLocalPsql(databaseContainer, sql, {
    remedy:
      "Reset the disposable local stack and retry; the harness could not restore the local Data API grants required by the application routes.",
  });
  assert.equal(
    stdout.trim(),
    "ready",
    "The local grants shim did not produce the required privileges while preserving migration 029's protected table boundary"
  );
}

function runLocalPsql(databaseContainer, sql, options = {}) {
  return runCommand(
    "docker",
    [
      "exec",
      databaseContainer,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atqc",
      sql,
    ],
    options
  );
}

function runCommand(command, args, { remedy } = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    const detail = (
      result.stderr ||
      result.error?.message ||
      `exit status ${String(result.status)}${result.signal ? `, signal ${result.signal}` : ""}`
    ).trim();
    throw new Error(
      `${command} ${args.slice(0, 6).join(" ")} failed: ${detail}` +
        (remedy ? ` Remedy: ${remedy}` : "")
    );
  }
  return result;
}

function assertLoopbackSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Supabase status returned an invalid local API URL");
  }
  const validHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !validHost || url.port !== "54321") {
    throw new Error(
      `Refusing Supabase URL ${url.origin}. This harness requires the disposable loopback API at http://127.0.0.1:54321 from supabase/config.toml.`
    );
  }
}

function assertLocalNextRuntime() {
  const [nodeMajor, nodeMinor] = process.versions.node
    .split(".")
    .slice(0, 2)
    .map(Number);
  assert(
    nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 17),
    `Node ${process.versions.node} is too old for this Next.js app. Use Node 18.17 or newer.`
  );
  assert(
    existsSync(NEXT_BIN),
    "The local Next.js executable is missing. Run `npm install` in this repository before rerunning the harness."
  );
}

function runMetadata(extra = {}) {
  return {
    simplassist_e2e: "account_deletion_stripe",
    simplassist_e2e_run: runId,
    ...extra,
  };
}

async function createAuthenticatedCookie({
  anonKey,
  email,
  password,
  supabaseUrl,
}) {
  const cookies = new Map();
  assertLoopbackSupabaseUrl(supabaseUrl);
  const authClient = createServerClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: true },
    cookies: {
      getAll() {
        return [...cookies].map(([name, value]) => ({ name, value }));
      },
      setAll(values) {
        for (const { name, value } of values) {
          if (value) cookies.set(name, value);
          else cookies.delete(name);
        }
      },
    },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  assertSupabaseSuccess(error, "sign in local auth fixture");
  assert(data.session, "Local sign-in returned no session");
  assert(cookies.size > 0, "Local sign-in produced no auth cookie");
  return [...cookies]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function startNextServer({
  anonKey,
  appUrl,
  cronSecret: childCronSecret,
  port,
  priceId,
  serviceRoleKey,
  stripeSecretKey: childStripeKey,
  supabaseUrl,
  webhookSecret: childWebhookSecret,
}) {
  assertLoopbackSupabaseUrl(supabaseUrl);
  requireTestSecretKey(childStripeKey);

  assertLocalNextRuntime();
  const child = spawn(process.execPath, [NEXT_BIN, "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: REPO_ROOT,
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? "en_US.UTF-8",
      PATH: process.env.PATH,
      SHELL: process.env.SHELL,
      TERM: process.env.TERM ?? "dumb",
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      STRIPE_SECRET_KEY: childStripeKey,
      STRIPE_WEBHOOK_SECRET: childWebhookSecret,
      STRIPE_PRICE_SMS_ONLY: priceId,
      STRIPE_PRICE_SMS_AND_CHAT: priceId,
      STRIPE_PRICE_FULL: priceId,
      STRIPE_PRICE_SETUP_FEE: priceId,
      STRIPE_PRICE_SMS_OVERAGE_PART: priceId,
      CRON_SECRET: childCronSecret,
      TELNYX_API_KEY: "account-deletion-e2e-disabled",
      TELNYX_PUBLIC_KEY: "account-deletion-e2e-disabled",
      TELNYX_MESSAGING_PROFILE_ID: "account-deletion-e2e-disabled",
      TELNYX_CONNECTION_ID: "account-deletion-e2e-disabled",
      ANTHROPIC_API_KEY: "account-deletion-e2e-disabled",
      FIRECRAWL_API_KEY: "account-deletion-e2e-disabled",
      RESEND_API_KEY: "account-deletion-e2e-disabled",
      RESEND_FROM_EMAIL: "account-deletion-e2e@example.invalid",
      SUPPORT_EMAIL: "support@example.invalid",
      GOOGLE_CLIENT_ID: "account-deletion-e2e-disabled",
      GOOGLE_CLIENT_SECRET: "account-deletion-e2e-disabled",
      GOOGLE_REDIRECT_URI: `${appUrl}/api/google/callback`,
      A2P_REVIEW_ADMIN_TOKEN: "account-deletion-e2e-disabled",
      A2P_REVIEW_EMAIL: "account-deletion-e2e@example.invalid",
      SIMPLASSIST_ADMIN_USER_IDS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tail = [];
  const collect = (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    tail.push(...lines);
    if (tail.length > 200) tail.splice(0, tail.length - 200);
    if (process.env.E2E_VERBOSE === "1") {
      for (const line of lines) console.log(`[next] ${line}`);
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.e2eLogTail = tail;
  return child;
}

async function waitForNextServer(appUrl) {
  try {
    await waitFor(
      "local Next server",
      async () => {
        if (!nextProcess || nextProcess.exitCode !== null) {
          const tail = nextProcess?.e2eLogTail?.join("\n") ?? "no server output";
          throw new Error(`Local Next server exited before readiness:\n${tail}`);
        }
        try {
          const response = await fetchWithTimeout(
            `${appUrl}/api/account/cleanup`,
            {
              method: "POST",
              headers: { authorization: "Bearer readiness-probe" },
            },
            LOCAL_HEALTH_REQUEST_TIMEOUT_MS
          );
          return response.status === 401;
        } catch {
          return false;
        }
      },
      NEXT_START_TIMEOUT_MS
    );
  } catch (error) {
    const tail = nextProcess?.e2eLogTail?.join("\n") ?? "no server output";
    throw new Error(
      `${errorMessage(error)} Remedy: stop any other Next dev process using this repository, run \`npm install\`, and retry with E2E_VERBOSE=1 if needed. Last Next output:\n${tail}`
    );
  }
}

async function requestJson(
  appUrl,
  pathname,
  { method, cookie, headers = {}, body } = {}
) {
  const response = await fetchWithTimeout(
    `${appUrl}${pathname}`,
    {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body,
    },
    LOCAL_ROUTE_REQUEST_TIMEOUT_MS
  );
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

function responseFailure(response) {
  return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
}

function fetchWithTimeout(input, init, timeoutMs) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readBusiness(businessId) {
  const { data, error } = await admin
    .from("businesses")
    .select(
      "id, owner_id, name, deleted_at, deletion_scheduled_for, cleanup_auth_user_id"
    )
    .eq("id", businessId)
    .single();
  assertSupabaseSuccess(error, `read business ${businessId}`);
  return data;
}

async function readStripeAction(businessId) {
  const action = await maybeReadStripeAction(businessId);
  assert(action, `Business ${businessId} has no durable Stripe action`);
  return action;
}

async function maybeReadStripeAction(businessId) {
  const { data, error } = await admin
    .from("account_deletion_stripe_actions")
    .select(
      "business_id, desired_action, applied_action, status, generation, idempotency_key, lease_token, lease_owner, lease_expires_at, attempt_count"
    )
    .eq("business_id", businessId)
    .maybeSingle();
  assertSupabaseSuccess(error, `read Stripe action for ${businessId}`);
  return data;
}

async function assertLocalSubscriptionCount(businessId, expected) {
  const { count, error } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);
  assertSupabaseSuccess(error, `count subscriptions for ${businessId}`);
  assert.equal(count, expected);
}

async function assertAuthUserDeleted(userId) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  assert(
    error?.status === 404 || !data?.user,
    `Auth user ${userId} still exists after permanent cleanup`
  );
}

async function retrieveSubscription(subscriptionId) {
  reassertTestKey();
  assert(stripeModeVerified);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return assertTestModeObject(`Subscription ${subscriptionId}`, subscription);
}

async function retrieveInvoice(invoiceId) {
  reassertTestKey();
  assert(stripeModeVerified);
  const invoice = await stripe.invoices.retrieve(invoiceId);
  return assertTestModeObject(`Invoice ${invoiceId}`, invoice);
}

async function listSubscriptionInvoices(subscriptionId) {
  reassertTestKey();
  assert(stripeModeVerified);
  const page = await stripe.invoices.list({
    subscription: subscriptionId,
    limit: 100,
  });
  for (const invoice of page.data) {
    assertTestModeObject(`Invoice ${invoice.id}`, invoice);
  }
  return page.data;
}

async function waitForNewSubscriptionInvoices(
  subscriptionId,
  baselineInvoiceIds,
  label
) {
  let latestInvoices = [];
  try {
    return await waitFor(
      label,
      async () => {
        latestInvoices = await listSubscriptionInvoices(subscriptionId);
        const newInvoices = latestInvoices.filter(
          (invoice) => !baselineInvoiceIds.has(invoice.id)
        );
        return newInvoices.length > 0 ? newInvoices : null;
      },
      STRIPE_ASYNC_TIMEOUT_MS,
      STRIPE_ASYNC_POLL_INTERVAL_MS
    );
  } catch (error) {
    throw new Error(
      `${errorMessage(error)}. Stripe returned these subscription invoices: ${summarizeInvoices(latestInvoices, baselineInvoiceIds)}`
    );
  }
}

async function waitForVoidSubscriptionInvoices(
  subscriptionId,
  baselineInvoiceIds
) {
  let latestInvoices = [];
  try {
    return await waitFor(
      "void grace-period renewal invoice",
      async () => {
        latestInvoices = await listSubscriptionInvoices(subscriptionId);
        const newInvoices = latestInvoices.filter(
          (invoice) => !baselineInvoiceIds.has(invoice.id)
        );
        return newInvoices.length > 0 &&
          newInvoices.every((invoice) => invoice.status === "void")
          ? newInvoices
          : null;
      },
      STRIPE_ASYNC_TIMEOUT_MS,
      STRIPE_ASYNC_POLL_INTERVAL_MS
    );
  } catch (error) {
    throw new Error(
      `${errorMessage(error)}. Stripe returned these subscription invoices: ${summarizeInvoices(latestInvoices, baselineInvoiceIds)}`
    );
  }
}

function summarizeInvoices(invoices, baselineInvoiceIds = new Set()) {
  return JSON.stringify(
    invoices.map((invoice) => ({
      id: invoice.id,
      is_new: !baselineInvoiceIds.has(invoice.id),
      status: invoice.status,
      auto_advance: invoice.auto_advance,
      amount_due: invoice.amount_due,
      amount_paid: invoice.amount_paid,
      created: invoice.created,
    }))
  );
}

async function listCustomerCharges(customerId) {
  reassertTestKey();
  assert(stripeModeVerified);
  const page = await stripe.charges.list({ customer: customerId, limit: 100 });
  for (const charge of page.data) {
    assertTestModeObject(`Charge ${charge.id}`, charge);
  }
  return page.data;
}

async function retrieveTestClock(testClockId) {
  reassertTestKey();
  assert(stripeModeVerified);
  const clock = await stripe.testHelpers.testClocks.retrieve(testClockId);
  return assertTestModeObject(`Test Clock ${testClockId}`, clock);
}

async function advanceClock(testClockId, frozenTime) {
  await stripeMutation("advance Test Clock", () =>
    stripe.testHelpers.testClocks.advance(testClockId, {
      frozen_time: frozenTime,
    })
  );
  return waitFor(
    `Test Clock ${testClockId} ready at ${frozenTime}`,
    async () => {
      const clock = await retrieveTestClock(testClockId);
      if (clock.status === "internal_failure") {
        throw new Error(`Test Clock ${testClockId} entered internal_failure`);
      }
      return clock.status === "ready" && clock.frozen_time === frozenTime
        ? clock
        : null;
    },
    STRIPE_ASYNC_TIMEOUT_MS,
    STRIPE_ASYNC_POLL_INTERVAL_MS
  );
}

function requirePrimarySubscriptionItem(subscription) {
  const item = subscription.items.data[0];
  assert(item, `Subscription ${subscription.id} has no primary item`);
  assert.equal(item.price.id, resources.priceId);
  return item;
}

function buildTestEvent(id, type, object) {
  assertTestModeObject(`${type} event object`, object);
  return {
    id,
    object: "event",
    api_version: E2E_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    data: { object },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
  };
}

async function waitFor(
  label,
  operation,
  timeoutMs = POLL_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${errorMessage(lastError)}` : ""}`
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function assertSupabaseSuccess(error, action) {
  if (error) {
    throw new Error(`Failed to ${action}: ${errorMessage(error)}`);
  }
}

async function requireHealthyResponse(response, label) {
  if (response.ok) return true;

  const body = (await response.text()).trim();
  throw new Error(
    `${label} returned HTTP ${response.status} ${response.statusText}` +
      (body ? ` | body=${body.slice(0, 1_000)}` : "")
  );
}

async function cleanup() {
  const errors = [];
  const attempt = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(`${label}: ${errorMessage(error)}`);
    }
  };

  if (nextProcess) {
    await attempt("stop local Next server", () => stopChild(nextProcess));
    nextProcess = null;
  }

  if (resources.subscriptionId && stripeModeVerified) {
    await attempt("cancel remaining test subscription", async () => {
      const subscription = await stripe.subscriptions.retrieve(
        resources.subscriptionId
      );
      assertTestModeObject("Cleanup subscription", subscription);
      if (subscription.status !== "canceled") {
        await stripeMutation("cleanup subscription cancellation", () =>
          stripe.subscriptions.cancel(resources.subscriptionId, {
            invoice_now: false,
            prorate: false,
          })
        );
      }
    });
  }

  if (resources.customerId && stripeModeVerified) {
    await attempt("delete test customer", async () => {
      reassertTestKey();
      assert(stripeModeVerified);
      await stripe.customers.del(resources.customerId);
    });
  }

  if (resources.priceId && stripeModeVerified) {
    await attempt("deactivate test price", async () => {
      await stripeMutation("deactivate test price", () =>
        stripe.prices.update(resources.priceId, { active: false })
      );
    });
  }

  if (resources.productId && stripeModeVerified) {
    await attempt("delete test product", async () => {
      reassertTestKey();
      assert(stripeModeVerified);
      try {
        await stripe.products.del(resources.productId);
      } catch {
        await stripeMutation("deactivate test product", () =>
          stripe.products.update(resources.productId, { active: false })
        );
      }
    });
  }

  if (resources.testClockId && stripeModeVerified) {
    await attempt("delete Test Clock", async () => {
      reassertTestKey();
      assert(stripeModeVerified);
      await waitFor(
        `delete Test Clock ${resources.testClockId}`,
        async () => {
          try {
            await stripe.testHelpers.testClocks.del(resources.testClockId);
            return true;
          } catch {
            return false;
          }
        },
        30_000,
        2_000
      );
    });
  }

  if (admin) {
    if (resources.webhookEventIds.length > 0) {
      await attempt("delete local webhook fixtures", async () => {
        const { error } = await admin
          .from("stripe_webhook_events")
          .delete()
          .in("id", resources.webhookEventIds);
        assertSupabaseSuccess(error, "delete local webhook fixtures");
      });
    }

    if (resources.businessId) {
      await attempt("delete local business fixture", async () => {
        const { error } = await admin
          .from("businesses")
          .delete()
          .eq("id", resources.businessId);
        assertSupabaseSuccess(error, "delete local business fixture");
      });
    }

    if (resources.authUserId) {
      await attempt("delete local auth fixture", async () => {
        const { error } = await admin.auth.admin.deleteUser(
          resources.authUserId
        );
        if (error && error.status !== 404) throw error;
      });
    }
  }

  return errors;
}

function stopChild(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Local Next server did not stop after SIGTERM"));
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function safeResourceSummary() {
  return Object.fromEntries(
    Object.entries(resources).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value)
    )
  );
}

function errorMessage(error) {
  const parts = [];

  if (error instanceof Error) {
    if (error.name && error.name !== "Error") parts.push(`name=${error.name}`);
    if (error.message?.trim()) parts.push(`message=${error.message.trim()}`);
    if ("code" in error && error.code) parts.push(`code=${String(error.code)}`);
    if (error.cause) parts.push(`cause=${errorMessage(error.cause)}`);
  } else if (error && typeof error === "object") {
    for (const key of ["code", "status", "message", "details", "hint"]) {
      const value = error[key];
      if (value !== null && value !== undefined && String(value).trim()) {
        parts.push(`${key}=${String(value).trim()}`);
      }
    }
    if (error.cause) parts.push(`cause=${errorMessage(error.cause)}`);
  } else if (error !== null && error !== undefined && String(error).trim()) {
    parts.push(String(error).trim());
  }

  if (parts.length > 0) return [...new Set(parts)].join(" | ");
  return "unknown error (empty error object; client exposed no HTTP status)";
}
