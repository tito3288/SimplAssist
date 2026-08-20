import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const REPORTS = [
  {
    phase: "pre_migration",
    url: new URL(
      "../supabase/snippets/chat-only-phase4-pre-migration-report.sql",
      import.meta.url
    ),
  },
  {
    phase: "post_migration",
    url: new URL(
      "../supabase/snippets/chat-only-phase4-post-migration-report.sql",
      import.meta.url
    ),
  },
];

const PROACTIVE_PREFLIGHT = {
  phase: "proactive_pre_migration",
  url: new URL(
    "../supabase/snippets/proactive-widget-065-066-pre-migration-report.sql",
    import.meta.url
  ),
};

const PRE_REQUIRED_CHECKS = [
  "migration_ledger_format",
  "migration_ledger_contiguous",
  "migration_ledger_unknown_future",
  "migration_064_not_yet_applied",
  "migration_056_phone_release_prerequisite",
  "migration_059_plan_family_conflicts",
  "migration_059_chat_setup_fee_conflicts",
  "migration_061_active_widget_hostname_derivability",
  "migration_062_active_booking_overlaps",
  "migration_063_pending_booking_without_token",
  "migration_063_invalid_provider_namespace",
  "cleanup_eligible_inventory",
  "database_cron_exact_jobs",
];

const POST_REQUIRED_CHECKS = [
  "migration_ledger_exact_tip",
  "expected_relation_catalog",
  "expected_validated_constraints",
  "expected_index_catalog",
  "private_relation_rls_and_grants",
  "service_function_boundaries",
  "trigger_catalog_and_boundaries",
  "migration_063_provider_table_shape",
  "migration_061_widget_schema_boundaries",
  "migration_065_proactive_preference_boundaries",
  "migration_063_google_token_grants",
  "migration_063_function_lock_boundaries",
  "migration_063_function_namespace_boundaries",
  "migration_063_function_reconciliation_boundaries",
  "migration_064_checkout_table_shape",
  "migration_066_widget_telemetry_schema_boundaries",
  "migration_066_widget_telemetry_security_boundaries",
  "migration_066_widget_telemetry_retention_boundaries",
  "plan_family_lock_invariants",
  "migration_064_function_evidence_boundaries",
  "migration_066_function_boundaries",
  "migration_064_authority_trigger_fields",
  "active_widget_allowlist_invariants",
  "active_widget_inventory",
  "active_widget_hostname_inventory",
  "calendar_active_booking_conflicts",
  "calendar_invalid_provider_namespaces",
  "calendar_live_provider_conflicts",
  "calendar_provider_unresolved_backlog",
  "calendar_provider_overdue_backlog",
  "calendar_provider_expired_claim_inventory",
  "calendar_provider_missing_credentials",
  "reply_reservation_active_inventory",
  "reply_provider_ledger_content_shape",
  "reply_reservation_overdue_unlinked",
  "reply_reservation_overdue_linked",
  "reply_reservation_attempt_alignment",
  "cleanup_eligible_inventory",
  "cleanup_provider_blocked_backlog",
  "checkout_live_attempt_inventory",
  "checkout_stale_creating_backlog",
  "checkout_stale_open_backlog",
  "checkout_completed_binding_invariants",
  "checkout_family_lock_invariants",
  "checkout_singleflight_invariants",
  "widget_telemetry_purge_eligible_inventory",
  "widget_telemetry_expired_backlog",
  "database_cron_exact_jobs",
];

const PROACTIVE_PREFLIGHT_REQUIRED_CHECKS = [
  "migration_ledger_exact_064",
  "migration_065_preference_column_absent",
  "migration_066_telemetry_objects_absent",
  "pre_066_widget_endpoint_constraints",
  "widget_config_security_prerequisites",
  "active_widget_allowlist_prerequisites",
  "widget_config_inventory",
  "active_widget_inventory",
  "database_cron_pre_066_exact_jobs",
];

function maskSqlLiteralsAndComments(sql) {
  let masked = "";
  let index = 0;

  const appendMasked = (length) => {
    masked += " ".repeat(length);
    index += length;
  };

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index);
      const end = newline === -1 ? sql.length : newline;
      appendMasked(end - index);
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const endMarker = sql.indexOf("*/", index + 2);
      const end = endMarker === -1 ? sql.length : endMarker + 2;
      appendMasked(end - index);
      continue;
    }

    if (sql[index] === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      masked += " ".repeat(index - start);
      continue;
    }

    if (sql[index] === '"') {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (sql[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      masked += " ".repeat(index - start);
      continue;
    }

    if (sql[index] === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        const start = index;
        const closing = sql.indexOf(tag, index + tag.length);
        index = closing === -1 ? sql.length : closing + tag.length;
        masked += " ".repeat(index - start);
        continue;
      }
    }

    masked += sql[index];
    index += 1;
  }

  return masked;
}

function extractCheckNames(sql, phase) {
  const pattern = new RegExp(
    `'${phase}'[^,]*,\\s*'([a-z0-9_]+)'`,
    "g"
  );
  return [...sql.matchAll(pattern)].map((match) => match[1]);
}

async function loadReports() {
  return Promise.all(
    REPORTS.map(async (report) => ({
      ...report,
      sql: await readFile(report.url, "utf8"),
    }))
  );
}

describe("Phase 4 SQL report safety contract", () => {
  it("uses one repeatable-read, transaction-read-only snapshot and rolls back", async () => {
    for (const { sql } of await loadReports()) {
      const executable = maskSqlLiteralsAndComments(sql);
      expect(executable).toMatch(
        /BEGIN\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+REPEATABLE\s+READ\s+READ\s+ONLY\s*;/i
      );
      expect(executable.match(/\bBEGIN\b/gi)).toHaveLength(1);
      expect(executable.match(/\bROLLBACK\b/gi)).toHaveLength(1);
      expect(executable.trimEnd()).toMatch(/ROLLBACK\s*;$/i);
    }
  });

  it("contains no SQL or psql mutation surface", async () => {
    const forbidden =
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|COPY|VACUUM|ANALYZE|GRANT|REVOKE|LOCK|REFRESH|CLUSTER|REINDEX)\b/i;

    for (const { sql } of await loadReports()) {
      const executable = maskSqlLiteralsAndComments(sql);
      expect(executable).not.toMatch(forbidden);
      expect(executable).not.toMatch(/\\(?:gexec|copy|include|i|o|out)\b/i);
      expect(executable).not.toMatch(
        /\b(?:nextval|setval|pg_advisory_lock|pg_advisory_xact_lock|dblink|lo_import|lo_export)\s*\(/i
      );
    }
  });

  it("emits only the fixed sanitized five-column report shape", async () => {
    for (const { sql } of await loadReports()) {
      expect(sql).toMatch(
        /SELECT phase, check_name, status, observed_count, detail\s+FROM report_rows\s+ORDER BY check_name;/
      );
      expect(sql).not.toMatch(
        /\b(?:json_agg|jsonb_agg|array_agg|string_agg|row_to_json|to_json|to_jsonb)\s*\(/i
      );
      expect(maskSqlLiteralsAndComments(sql)).not.toContain("||");
      expect(sql).not.toMatch(/\bSELECT\s+\*/i);
    }
  });

  it("keeps the historical pre-report independent of every post-tip object", async () => {
    const [{ sql }] = await loadReports();

    expect(sql).not.toContain("chat_only_checkout_attempts");
    expect(sql).not.toContain("acquire_chat_only_checkout_attempt");
    expect(sql).not.toContain("sync_chat_only_subscription_from_attempt");
    expect(sql).not.toContain("complete_chat_only_checkout_attempt");
    expect(sql).not.toContain("expire_chat_only_checkout_attempt");
    expect(sql).not.toContain("proactive_invitation_enabled");
    expect(sql).not.toContain("widget_engagement_events");
    expect(sql).not.toContain("acquire_widget_telemetry_capacity");
    expect(sql).not.toContain("purge_widget_engagement_events");
  });

  it("pins the current post-report to exact reviewed tip 066", async () => {
    const [, { sql }] = await loadReports();

    expect(sql).toMatch(/migration_number NOT BETWEEN 1 AND 66/);
    expect(sql).toMatch(/migration_number BETWEEN 1 AND 66/);
    expect(sql).toMatch(/migration_number = 66/);
    expect(sql).toMatch(/generate_series\(1, 66\)/);
    expect(sql).toMatch(/reviewed_versions = 66/);
    expect(sql).toContain("exact reviewed tip 066");
  });

  it("pins migration 065 owner preference schema and inherited security", async () => {
    const [, { sql }] = await loadReports();

    expect(sql).toContain("proactive_invitation_enabled");
    expect(sql).toContain("'boolean'::regtype");
    expect(sql).toContain("default_value.adbin");
    expect(sql).toContain(
      "Owner preference for automatically revealing the saved welcome message. Public delivery also requires the server-only runtime gate."
    );
    expect(sql).toContain("widget_configs_update");
    expect(sql).toContain("welcome_message");
  });

  it("pins migration 066 content-free schema, security, retention, and cron", async () => {
    const [, { sql }] = await loadReports();

    expect(sql).toContain("public.widget_engagement_events");
    expect(sql).toContain("session_key_hash");
    expect(sql).toContain("widget_engagement_events_source_contract");
    expect(sql).toContain("widget_ingress_rate_buckets_endpoint_check");
    expect(sql).toContain("widget_request_rate_buckets_endpoint_check");
    expect(sql).toContain("'telemetry'");
    expect(sql).toContain(
      "public.record_widget_engagement_event(uuid,text,text,text,text,integer)"
    );
    expect(sql).toContain(
      "public.acquire_widget_telemetry_ingress_capacity(text)"
    );
    expect(sql).toContain(
      "public.acquire_widget_telemetry_capacity(uuid,text,text,text,text)"
    );
    expect(sql).toContain("public.purge_widget_engagement_events()");
    expect(sql).toContain("interval '90 days'");
    expect(sql).toContain("interval '91 days'");
    expect(sql).toContain("cleanup_widget_engagement_events");
    expect(sql).toContain("'20 3 * * *'");
    expect(sql).toMatch(/total_jobs = 3/);
    expect(sql).toMatch(/valid_widget_telemetry_cleanup_jobs = 1/);
    expect(sql).toContain(
      "CHECKendpoint=ANYARRAY[''config'',''chat'',''end'',''lead'',''telemetry'']"
    );
    expect(sql).toContain(
      "CHECKendpoint=ANYARRAY[''config'',''chat'',''end'',''lead'',''telemetry'',''preview_chat'',''preview_end'']"
    );
    for (const forbiddenRecordDependency of [
      "%contacts%",
      "%conversations%",
      "%messages%",
      "%anthropic%",
      "%billing_usage%",
      "%ai_reply_usage_periods%",
      "%ai_reply_reservations%",
      "%subscriptions%",
      "%stripe%",
      "%telnyx%",
      "%calendar_provider_operations%",
    ]) {
      expect(sql).toContain(forbiddenRecordDependency);
    }
  });

  it("contains each pre-migration blocker and inventory check exactly once", async () => {
    const [{ sql, phase }] = await loadReports();
    const names = extractCheckNames(sql, phase);

    expect(new Set(names).size).toBe(names.length);
    expect(names.toSorted()).toEqual(PRE_REQUIRED_CHECKS.toSorted());
    for (const required of PRE_REQUIRED_CHECKS) {
      expect(sql).toContain(`'${required}'`);
    }
  });

  it("contains every post-migration schema, security, invariant, and backlog check", async () => {
    const [, { sql, phase }] = await loadReports();
    const names = extractCheckNames(sql, phase);

    expect(new Set(names).size).toBe(names.length);
    expect(
      names.every((name) => POST_REQUIRED_CHECKS.includes(name))
    ).toBe(true);
    for (const required of POST_REQUIRED_CHECKS) {
      expect(sql).toContain(`'${required}'`);
    }
  });

  it("does not treat unbound partner jobs as business family evidence", async () => {
    const [, { sql }] = await loadReports();

    expect(sql).toMatch(
      /FROM public\.partner_client_provisioning_jobs AS job\s+WHERE job\.business_id IS NOT NULL\s+AND job\.partner_plan IN/
    );
  });

  it("uses only deterministic status labels", async () => {
    for (const { sql } of await loadReports()) {
      const statuses = [...sql.matchAll(/'(PASS|BLOCKER|NOT_APPLICABLE)'/g)].map(
        (match) => match[1]
      );
      expect(statuses.length).toBeGreaterThan(0);
      expect(
        statuses.every((status) =>
          ["PASS", "BLOCKER", "NOT_APPLICABLE"].includes(status)
        )
      ).toBe(true);
    }
  });
});

describe("proactive widget 064-to-066 preflight safety contract", () => {
  it("is a read-only repeatable-read snapshot with fixed aggregate output", async () => {
    const sql = await readFile(PROACTIVE_PREFLIGHT.url, "utf8");
    const executable = maskSqlLiteralsAndComments(sql);

    expect(executable).toMatch(
      /BEGIN\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+REPEATABLE\s+READ\s+READ\s+ONLY\s*;/i
    );
    expect(executable.match(/\bBEGIN\b/gi)).toHaveLength(1);
    expect(executable.match(/\bROLLBACK\b/gi)).toHaveLength(1);
    expect(executable.trimEnd()).toMatch(/ROLLBACK\s*;$/i);
    expect(sql).toMatch(
      /SELECT phase, check_name, status, observed_count, detail\s+FROM report_rows\s+ORDER BY check_name;/
    );
    expect(sql).not.toMatch(
      /\b(?:json_agg|jsonb_agg|array_agg|string_agg|row_to_json|to_json|to_jsonb)\s*\(/i
    );
    expect(sql).not.toMatch(/\bSELECT\s+\*/i);
    expect(executable).not.toContain("||");
  });

  it("contains no SQL or psql mutation surface", async () => {
    const sql = await readFile(PROACTIVE_PREFLIGHT.url, "utf8");
    const executable = maskSqlLiteralsAndComments(sql);
    const forbidden =
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|COPY|VACUUM|ANALYZE|GRANT|REVOKE|LOCK|REFRESH|CLUSTER|REINDEX)\b/i;

    expect(executable).not.toMatch(forbidden);
    expect(executable).not.toMatch(/\\(?:gexec|copy|include|i|o|out)\b/i);
    expect(executable).not.toMatch(
      /\b(?:nextval|setval|pg_advisory_lock|pg_advisory_xact_lock|dblink|lo_import|lo_export)\s*\(/i
    );
  });

  it("emits every required sanitized preflight check exactly once", async () => {
    const sql = await readFile(PROACTIVE_PREFLIGHT.url, "utf8");
    const names = extractCheckNames(sql, PROACTIVE_PREFLIGHT.phase);

    expect(new Set(names).size).toBe(names.length);
    expect(names.toSorted()).toEqual(
      PROACTIVE_PREFLIGHT_REQUIRED_CHECKS.toSorted()
    );
  });

  it("pins exact tip 064, absent 065-066 objects, old enums, and two jobs", async () => {
    const sql = await readFile(PROACTIVE_PREFLIGHT.url, "utf8");

    expect(sql).toMatch(/migration_number NOT BETWEEN 1 AND 64/);
    expect(sql).toMatch(/generate_series\(1, 64\)/);
    expect(sql).toMatch(/reviewed_versions = 64/);
    expect(sql).toContain("proactive_invitation_enabled");
    expect(sql).toContain("public.widget_engagement_events");
    expect(sql).toContain(
      "public.record_widget_engagement_event(uuid,text,text,text,text,integer)"
    );
    expect(sql).toContain("pg_get_constraintdef(constraint_row.oid)");
    expect(sql).toContain("LIKE '%''telemetry''%'");
    expect(sql).toMatch(/total_jobs = 2/);
    expect(sql).toContain("cleanup_processed_webhook_events");
    expect(sql).toContain("reap_expired_ai_reply_reservations");
    expect(sql).not.toContain("cleanup_widget_engagement_events");
  });

  it("documents the exact operator command and rejects the historical pre-report", async () => {
    const runbook = await readFile(
      new URL("../docs/proactive-widget-rollout.md", import.meta.url),
      "utf8"
    );

    expect(runbook).toContain(
      "npx supabase db query --linked --project-ref inmgpkurctttsofpywuz --file supabase/snippets/proactive-widget-065-066-pre-migration-report.sql"
    );
    expect(runbook).toContain(
      "The Phase 4 pre-report is a historical pre-064 artifact"
    );
  });
});
