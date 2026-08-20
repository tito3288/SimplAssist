#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  buildReadinessAudit as buildPhase4ReadinessAudit,
  loadPhase4DatabaseState,
  parseArguments as parsePhase4Arguments,
  sanitizeReadinessError,
  validateEnvironment as validatePhase4Environment,
} from "./chat-only-phase4-readiness.mjs";
import { stableRef } from "./chat-only-phase0-inventory.mjs";

const STRIPE_API_VERSION = "2026-02-25.clover";
const PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTEMPT_STATES = new Set([
  "creating",
  "open",
  "completed",
  "expired",
]);
const UNRESOLVED_ATTEMPT_STATES = new Set(["creating", "open"]);
const PHASE5_FLAGS = new Set([
  "--launch-state",
  "--blocker-inventories-clear",
  "--waf-verified",
  "--scheduler-verified",
  "--homepage-cache-verified",
]);

const HELP = `Usage:
  npm run audit:chat-only-phase5 -- \\
    --launch-state <off|ready> \\
    --stripe-mode <test|live> \\
    --supabase-project-ref <project-ref> \\
    --blocker-inventories-clear <true|false> \\
    --waf-verified <true|false> \\
    --scheduler-verified <true|false> \\
    --homepage-cache-verified <true|false>

This launch-readiness audit is strictly read-only. It reuses the Phase 4
Stripe, Supabase, Portal, billing-authority, Telnyx-safety, Chat Price, widget
secret, and open-Checkout inventory. It adds a read-only inventory of the
private Chat Checkout attempt ledger. It has no apply, repair, deployment,
Checkout, expiration, cancellation, or provider-mutation mode.

Both launch states require:
  - an active, licensed USD $10 monthly Chat Only Price in the selected mode;
  - the server-only widget secret and pinned safe Billing Portal contract;
  - no open Chat Checkout Session or creating/open Chat Checkout attempt;
  - the partner-assignment switch at exact 0 and the canary unset; and
  - explicit external evidence for the locked SQL blocker inventories,
    managed widget WAF/edge controls, cleanup scheduler, and public homepage
    cache behavior.

--launch-state off requires CHAT_ONLY_DIRECT_SALES_ENABLED=0 exactly.
--launch-state ready requires --stripe-mode live and accepts an exact broad
direct-sales value of 0 (pre-open readiness) or 1 (open launch window). It
never permits partner assignment or an exact-business canary.

The four external evidence flags are attestations from separately reviewed
read-only checks. Supplying false produces a blocker; omitting or misspelling a
boolean makes the audit incomplete. This command does not inspect or modify
Cloudflare or cron-job.org itself.

--homepage-cache-verified requires post-Phase-5-deploy evidence from both the
apex and www versions of /. Each must return HTTP 200, Cache-Control private
with no-store and max-age=0, CF-Cache-Status DYNAMIC, and no positive Age.
Whenever CHAT_ONLY_DIRECT_SALES_ENABLED=0, including --launch-state ready
before opening sales, the response body, metadata, and JSON-LD must contain no
Chat Only sale. This flag records separately reviewed evidence; it does not
change Cloudflare or deploy the application.

Required environment variables are the Phase 4 required-Price configuration,
including STRIPE_PRICE_CHAT_ONLY, WIDGET_TOKEN_SECRET, and the pinned Portal
configuration. CHAT_ONLY_DIRECT_SALES_ENABLED and
CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED must be explicitly configured as
described above. CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID must be unset or empty.

The process exits 0 for a complete clean report, 2 for a sanitized blocked
report, and 1 when the audit could not complete.`;

export function parseArguments(argv) {
  const phase4Arguments = [];
  const phase5Values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = splitArgument(argument);
    if (!PHASE5_FLAGS.has(flag)) {
      phase4Arguments.push(argument);
      continue;
    }
    if (phase5Values.has(flag)) {
      throw new Error(`${flag} may be supplied only once`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    phase5Values.set(flag, value);
  }

  const phase4 = parsePhase4Arguments([
    ...phase4Arguments,
    "--chat-price-state",
    "required",
    "--widget-secret-state",
    "required",
    "--canary-state",
    "absent",
  ]);
  if (phase4.help) return { ...phase4, launchState: null };

  const launchState = phase5Values.get("--launch-state");
  if (launchState !== "off" && launchState !== "ready") {
    throw new Error("--launch-state must be exactly off or ready");
  }

  return {
    ...phase4,
    launchState,
    blockerInventoriesClear: parseRequiredBoolean(
      phase5Values,
      "--blocker-inventories-clear",
    ),
    wafVerified: parseRequiredBoolean(phase5Values, "--waf-verified"),
    schedulerVerified: parseRequiredBoolean(
      phase5Values,
      "--scheduler-verified",
    ),
    homepageCacheVerified: parseRequiredBoolean(
      phase5Values,
      "--homepage-cache-verified",
    ),
  };
}

export function validateEnvironment(arguments_, environment) {
  if (arguments_.launchState !== "off" && arguments_.launchState !== "ready") {
    throw new Error("--launch-state must be exactly off or ready");
  }
  assertBooleanArgument(
    arguments_.blockerInventoriesClear,
    "--blocker-inventories-clear",
  );
  assertBooleanArgument(arguments_.wafVerified, "--waf-verified");
  assertBooleanArgument(
    arguments_.schedulerVerified,
    "--scheduler-verified",
  );
  assertBooleanArgument(
    arguments_.homepageCacheVerified,
    "--homepage-cache-verified",
  );

  const phase4 = validatePhase4Environment(
    {
      ...arguments_,
      chatPriceState: "required",
      widgetSecretState: "required",
      canaryState: "absent",
    },
    environment,
  );

  const directSalesSwitchValue = requireExactBinarySwitch(
    environment,
    "CHAT_ONLY_DIRECT_SALES_ENABLED",
  );
  const partnerAssignmentSwitchValue = requireExactBinarySwitch(
    environment,
    "CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED",
  );
  if (partnerAssignmentSwitchValue !== "0") {
    throw new Error(
      "CHAT_ONLY_PARTNER_ASSIGNMENT_ENABLED must be exact 0 for Phase 5",
    );
  }
  if (
    arguments_.launchState === "off" &&
    directSalesSwitchValue !== "0"
  ) {
    throw new Error(
      "CHAT_ONLY_DIRECT_SALES_ENABLED must be exact 0 for --launch-state off",
    );
  }
  if (
    arguments_.launchState === "ready" &&
    arguments_.stripeMode !== "live"
  ) {
    throw new Error("--launch-state ready requires --stripe-mode live");
  }
  if (phase4.directCanaryBusinessId !== null) {
    throw new Error(
      "CHAT_ONLY_DIRECT_CANARY_BUSINESS_ID must be unset or empty for Phase 5",
    );
  }

  return {
    ...phase4,
    launchState: arguments_.launchState,
    directSalesSwitchValue,
    partnerAssignmentSwitchValue,
    blockerInventoriesClear: arguments_.blockerInventoriesClear,
    wafVerified: arguments_.wafVerified,
    schedulerVerified: arguments_.schedulerVerified,
    homepageCacheVerified: arguments_.homepageCacheVerified,
  };
}

/**
 * Load only the additional private attempt facts needed by Phase 5. The
 * inherited Phase 4 loader remains the authority for every other database
 * inventory. Checkout URLs and raw Stripe/customer identifiers are never read.
 */
export async function loadPhase5DatabaseState(
  supabase,
  config,
  { loadPhase4 = loadPhase4DatabaseState } = {},
) {
  const inheritedConfig = phase4AnalysisConfig(config);
  const [database, chatOnlyCheckoutAttempts] = await Promise.all([
    loadPhase4(supabase, inheritedConfig),
    readAllChatOnlyCheckoutAttempts(supabase),
  ]);
  return { ...database, chatOnlyCheckoutAttempts };
}

export async function buildLaunchReadinessAudit({
  stripe,
  supabase,
  config,
  now = new Date(),
  loadDatabase = loadPhase5DatabaseState,
  buildPhase4 = buildPhase4ReadinessAudit,
}) {
  const inheritedConfig = phase4AnalysisConfig(config);
  let databaseEvidence = null;
  const phase4Report = await buildPhase4({
    stripe,
    supabase,
    config: inheritedConfig,
    now,
    loadDatabase: async () => {
      databaseEvidence = await loadDatabase(supabase, config);
      return databaseEvidence;
    },
  });
  if (!databaseEvidence) {
    throw new Error("Phase 5 database inventory did not complete");
  }
  return analyzeLaunchReadiness({
    phase4Report,
    database: databaseEvidence,
    config,
    now,
  });
}

export function analyzeLaunchReadiness({
  phase4Report,
  database,
  config,
  now = new Date(),
}) {
  assertAnalysisConfig(config);
  assertPhase4Report(phase4Report);

  const blockers = phase4Report.blockers.map(cloneIssue);
  const warnings = phase4Report.warnings.map(cloneIssue);
  assertInheritedTargets(phase4Report, config);
  addContractBlockers(blockers, phase4Report);
  const attemptInventory = analyzeAttemptInventory(
    database?.chatOnlyCheckoutAttempts,
    blockers,
  );
  const openChatSessions =
    phase4Report.open_checkout_sessions.open_chat_only;
  if (!Number.isInteger(openChatSessions) || openChatSessions < 0) {
    throw new Error("Phase 4 open Chat Checkout evidence is invalid");
  }
  if (openChatSessions > 0) {
    addIssue(
      blockers,
      "open_chat_checkout_sessions_unresolved",
      "Open Chat Only Checkout Sessions must be resolved before Phase 5 launch",
      phase4Report.open_checkout_sessions.chat_session_refs,
      openChatSessions,
    );
  }

  addExternalEvidenceBlockers(blockers, config);
  addRolloutBlockers(blockers, config);
  sortIssues(blockers);
  sortIssues(warnings);

  const generatedAt = validDate(now)
    ? now.toISOString()
    : phase4Report.generated_at;
  return {
    schema_version: 1,
    operation: "chat_only_phase5_launch_readiness",
    generated_at: generatedAt,
    verdict: blockers.length === 0 ? "pass" : "blocked",
    targets: { ...phase4Report.targets },
    launch: {
      requested_state: config.launchState,
      direct_sales_switch: config.directSalesSwitchValue,
      direct_sales_enabled: config.directSalesSwitchValue === "1",
      partner_assignment_switch: config.partnerAssignmentSwitchValue,
      partner_assignment_enabled: false,
      direct_canary_configured: false,
    },
    contracts: {
      inherited_phase4_inventory_clear:
        phase4Report.blockers.length === 0,
      chat_only_price: { ...phase4Report.chat_only_price },
      widget_token_secret_configured:
        phase4Report.environment.widget_token_secret_configured === true,
      pinned_portal_contract_complete:
        phase4Report.stripe_portal.phase4_contract_complete === true,
    },
    checkout: {
      open_chat_only_sessions: openChatSessions,
      open_chat_session_refs: [
        ...phase4Report.open_checkout_sessions.chat_session_refs,
      ],
      attempts: attemptInventory,
      subscriptions: { ...phase4Report.chat_only_subscriptions },
    },
    external_evidence: {
      blocker_inventories_clear: config.blockerInventoriesClear,
      managed_widget_waf_verified: config.wafVerified,
      cleanup_scheduler_verified: config.schedulerVerified,
      public_homepage_cache_verified: config.homepageCacheVerified,
    },
    blockers,
    warnings,
  };
}

function phase4AnalysisConfig(config) {
  return {
    ...config,
    chatPriceState: "required",
    widgetSecretState: "required",
    canaryState: "absent",
    directCanaryBusinessId: null,
    // Phase 4's inherited baseline is intentionally pre-enable. Phase 5
    // validates the real exact switch separately, then suppresses only that
    // expected pre-enable finding while retaining every other Phase 4 check.
    chatOnlyDirectSalesEnabled: false,
    chatOnlyPartnerAssignmentEnabled: false,
  };
}

function analyzeAttemptInventory(attempts, blockers) {
  if (!Array.isArray(attempts)) {
    throw new Error("Chat Checkout attempt inventory was not an array");
  }
  const byState = {
    creating: 0,
    open: 0,
    completed: 0,
    expired: 0,
  };
  const unresolvedRefs = [];
  const invalidRefs = [];

  for (const attempt of attempts) {
    const ref = stableRef("chat_checkout_attempt", attempt?.id ?? "missing");
    if (
      !attempt ||
      typeof attempt !== "object" ||
      !UUID_PATTERN.test(attempt.id) ||
      !UUID_PATTERN.test(attempt.business_id) ||
      !ATTEMPT_STATES.has(attempt.state)
    ) {
      invalidRefs.push(ref);
      continue;
    }
    byState[attempt.state] += 1;
    if (UNRESOLVED_ATTEMPT_STATES.has(attempt.state)) {
      unresolvedRefs.push(ref);
    }
  }

  if (invalidRefs.length > 0) {
    addIssue(
      blockers,
      "chat_checkout_attempt_inventory_invalid",
      "Chat Checkout attempt inventory contains malformed evidence",
      invalidRefs,
      invalidRefs.length,
    );
  }
  if (unresolvedRefs.length > 0) {
    addIssue(
      blockers,
      "chat_checkout_attempts_unresolved",
      "Creating or open Chat Checkout attempts must be resolved before Phase 5 launch",
      unresolvedRefs,
      unresolvedRefs.length,
    );
  }

  return {
    total: attempts.length,
    by_state: byState,
    unresolved: unresolvedRefs.length,
    unresolved_refs: [...new Set(unresolvedRefs)].sort(),
    malformed: invalidRefs.length,
    malformed_refs: [...new Set(invalidRefs)].sort(),
  };
}

function addExternalEvidenceBlockers(blockers, config) {
  if (!config.blockerInventoriesClear) {
    addIssue(
      blockers,
      "postmigration_blocker_inventories_not_clear",
      "The separately locked post-migration blocker inventories are not confirmed clear",
    );
  }
  if (!config.wafVerified) {
    addIssue(
      blockers,
      "managed_widget_waf_not_verified",
      "Managed edge/WAF controls for every public widget endpoint are not confirmed",
    );
  }
  if (!config.schedulerVerified) {
    addIssue(
      blockers,
      "cleanup_scheduler_not_verified",
      "The production cleanup scheduler contract is not confirmed",
    );
  }
  if (!config.homepageCacheVerified) {
    addIssue(
      blockers,
      "public_homepage_cache_not_verified",
      "The public homepage cache and requested-state presentation contract is not confirmed",
    );
  }
}

function addContractBlockers(blockers, phase4Report) {
  if (
    phase4Report.environment.chat_price_state !== "required" ||
    phase4Report.chat_only_price.contract_satisfied !== true ||
    phase4Report.chat_only_price.mode_matches !== true ||
    phase4Report.chat_only_price.active !== true ||
    phase4Report.chat_only_price.usd_1000 !== true ||
    phase4Report.chat_only_price.monthly_interval !== true ||
    phase4Report.chat_only_price.licensed !== true
  ) {
    addIssue(
      blockers,
      "chat_only_price_launch_contract_not_verified",
      "The exact active USD $10 monthly licensed Chat Only Price is not verified in the selected Stripe mode",
    );
  }
  if (
    phase4Report.environment.widget_secret_state !== "required" ||
    phase4Report.environment.widget_token_secret_configured !== true
  ) {
    addIssue(
      blockers,
      "widget_secret_launch_contract_not_verified",
      "The required server-only widget security secret is not verified",
    );
  }
  if (phase4Report.stripe_portal.phase4_contract_complete !== true) {
    addIssue(
      blockers,
      "billing_portal_launch_contract_not_verified",
      "The pinned safe Billing Portal contract is not verified",
    );
  }
  if (phase4Report.environment.direct_canary?.configured !== false) {
    addIssue(
      blockers,
      "direct_canary_not_absent",
      "The exact-business direct canary must be absent for Phase 5",
    );
  }
}

function addRolloutBlockers(blockers, config) {
  if (config.partnerAssignmentSwitchValue !== "0") {
    addIssue(
      blockers,
      "partner_assignment_switch_not_off",
      "Partner Chat Only assignment must remain exact 0 during Phase 5",
    );
  }
  if (
    config.launchState === "off" &&
    config.directSalesSwitchValue !== "0"
  ) {
    addIssue(
      blockers,
      "direct_sales_switch_conflicts_with_off_target",
      "The off launch target requires the broad direct-sales switch at exact 0",
    );
  }
  if (
    config.launchState === "ready" &&
    config.directSalesSwitchValue !== "0" &&
    config.directSalesSwitchValue !== "1"
  ) {
    addIssue(
      blockers,
      "direct_sales_switch_invalid_for_ready_target",
      "The ready launch target requires an exact broad direct-sales value of 0 or 1",
    );
  }
}

function assertAnalysisConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Phase 5 launch configuration is missing");
  }
  if (config.launchState !== "off" && config.launchState !== "ready") {
    throw new Error("Phase 5 launch state is missing or invalid");
  }
  if (config.launchState === "ready" && config.stripeMode !== "live") {
    throw new Error("The ready launch state requires live Stripe evidence");
  }
  for (const [value, flag] of [
    [config.blockerInventoriesClear, "--blocker-inventories-clear"],
    [config.wafVerified, "--waf-verified"],
    [config.schedulerVerified, "--scheduler-verified"],
    [config.homepageCacheVerified, "--homepage-cache-verified"],
  ]) {
    assertBooleanArgument(value, flag);
  }
}

function assertPhase4Report(report) {
  if (
    !report ||
    typeof report !== "object" ||
    report.operation !== "chat_only_phase4_readiness" ||
    !Array.isArray(report.blockers) ||
    !Array.isArray(report.warnings) ||
    !report.targets ||
    !report.environment ||
    !report.chat_only_price ||
    !report.open_checkout_sessions ||
    !Array.isArray(report.open_checkout_sessions.chat_session_refs) ||
    !report.chat_only_subscriptions ||
    !report.stripe_portal
  ) {
    throw new Error("Inherited Phase 4 readiness evidence is incomplete");
  }
  const expectedVerdict = report.blockers.length === 0 ? "pass" : "blocked";
  if (report.verdict !== expectedVerdict) {
    throw new Error("Inherited Phase 4 readiness verdict is inconsistent");
  }
}

function assertInheritedTargets(report, config) {
  if (
    report.targets.stripe_mode !== config.stripeMode ||
    report.targets.supabase_project_ref !== config.projectRef
  ) {
    throw new Error("Inherited readiness target does not match Phase 5 target");
  }
}

async function readAllChatOnlyCheckoutAttempts(supabase) {
  const rows = [];
  let expectedCount = null;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error, count } = await supabase
      .from("chat_only_checkout_attempts")
      .select("id,business_id,state", { count: "exact" })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `Failed to read Chat Checkout attempt inventory: ${error.message}`,
      );
    }
    if (!Array.isArray(data)) {
      throw new Error(
        "Failed to read Chat Checkout attempt inventory: response was not an array",
      );
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        "Failed to read Chat Checkout attempt inventory: exact count was unavailable",
      );
    }
    if (expectedCount === null) expectedCount = count;
    if (count !== expectedCount) {
      throw new Error(
        "Failed to read Chat Checkout attempt inventory: exact count changed during pagination",
      );
    }
    const expectedPageLength = Math.min(
      PAGE_SIZE,
      Math.max(0, expectedCount - offset),
    );
    if (data.length !== expectedPageLength) {
      throw new Error(
        "Failed to read Chat Checkout attempt inventory: page length did not match the exact count",
      );
    }
    rows.push(...data);
    if (rows.length === expectedCount) return rows;
  }
}

function parseRequiredBoolean(values, flag) {
  if (!values.has(flag)) throw new Error(`${flag} is required`);
  const value = values.get(flag);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be exactly true or false`);
}

function assertBooleanArgument(value, flag) {
  if (typeof value !== "boolean") {
    throw new Error(`${flag} must be an explicit boolean`);
  }
}

function requireExactBinarySwitch(environment, name) {
  const value = environment[name];
  if (value !== "0" && value !== "1") {
    throw new Error(`${name} must be explicitly configured as exact 0 or 1`);
  }
  return value;
}

function splitArgument(argument) {
  const equals = argument.indexOf("=");
  return equals === -1
    ? [argument, null]
    : [argument.slice(0, equals), argument.slice(equals + 1)];
}

function cloneIssue(issue) {
  if (
    !issue ||
    typeof issue.code !== "string" ||
    typeof issue.message !== "string" ||
    !Number.isInteger(issue.count) ||
    !Array.isArray(issue.refs)
  ) {
    throw new Error("Inherited readiness issue evidence is malformed");
  }
  return {
    code: issue.code,
    message: issue.message,
    count: issue.count,
    refs: [...issue.refs],
  };
}

function addIssue(target, code, message, refs = [], count = 1) {
  if (target.some((issue) => issue.code === code)) return;
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
      `${right.code}:${right.refs.join(",")}`,
    ),
  );
}

function validDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function sanitizeLaunchReadinessError(error) {
  return sanitizeReadinessError(error)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [secret]")
    .replace(
      /\b(?:api[_-]?key|password|secret|token)\s*[=:]\s*[^\s,;]+/gi,
      "credential=[secret]",
    );
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
    const report = await buildLaunchReadinessAudit({
      stripe,
      supabase,
      config,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.verdict !== "pass") process.exitCode = 2;
  } catch (error) {
    console.error(
      JSON.stringify({
        schema_version: 1,
        operation: "chat_only_phase5_launch_readiness",
        verdict: "incomplete",
        error: sanitizeLaunchReadinessError(error),
      }),
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
