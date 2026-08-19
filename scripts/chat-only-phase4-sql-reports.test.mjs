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
  "migration_063_google_token_grants",
  "migration_063_function_lock_boundaries",
  "migration_063_function_namespace_boundaries",
  "migration_063_function_reconciliation_boundaries",
  "migration_064_checkout_table_shape",
  "plan_family_lock_invariants",
  "migration_064_function_evidence_boundaries",
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
  "database_cron_exact_jobs",
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

  it("keeps the pre-report independent of every post-tip Checkout object", async () => {
    const [{ sql }] = await loadReports();

    expect(sql).not.toContain("chat_only_checkout_attempts");
    expect(sql).not.toContain("acquire_chat_only_checkout_attempt");
    expect(sql).not.toContain("sync_chat_only_subscription_from_attempt");
    expect(sql).not.toContain("complete_chat_only_checkout_attempt");
    expect(sql).not.toContain("expire_chat_only_checkout_attempt");
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
