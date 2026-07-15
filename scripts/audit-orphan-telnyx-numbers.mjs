#!/usr/bin/env node
// READ-ONLY audit: Telnyx-owned phone numbers with no live phone_numbers row.
//
// Surfaces orphans created by the purchase-save gap (a number purchased at
// Telnyx whose local insert failed and was never retried) and any numbers
// still owned for tombstoned businesses. REPORT ONLY — this script never
// writes to Telnyx or the database; any release is a manual operator action
// per the prod-mutation working agreement (docs/PROJECT_LOG.md §2).
//
// Output is PII-redacted (masked numbers, business ids not names) so it can
// be pasted into logs/PRs without violating the no-PII rule; resolve details
// via the printed telnyx/business ids.
//
// Caveat: a number whose purchase is in flight (bought at Telnyx, local
// insert not yet committed) reports as a transient false-positive ORPHAN —
// re-run before acting on any finding.
//
// Usage: node --env-file=.env.local scripts/audit-orphan-telnyx-numbers.mjs
// Requires TELNYX_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TELNYX_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing TELNYX_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run with node --env-file=.env.local)"
  );
  process.exit(1);
}

function mask(phoneNumber) {
  if (typeof phoneNumber !== "string" || phoneNumber.length < 6) return "***";
  return `${phoneNumber.slice(0, 3)}***${phoneNumber.slice(-4)}`;
}

async function listOwnedTelnyxNumbers() {
  const owned = [];
  let pageNumber = 1;
  for (;;) {
    const res = await fetch(
      `https://api.telnyx.com/v2/phone_numbers?page[size]=250&page[number]=${pageNumber}`,
      { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } }
    );
    if (!res.ok) {
      throw new Error(`Telnyx list failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    for (const n of body.data ?? []) {
      owned.push({
        id: n.id,
        phone_number: n.phone_number,
        status: n.status,
        customer_reference: n.customer_reference ?? null,
        created_at: n.created_at,
      });
    }
    // Explicit pagination: missing meta means the page shape changed —
    // fail loudly rather than silently under-listing (a partial list would
    // report a false "clean").
    const meta = body.meta;
    if (
      typeof meta?.page_number !== "number" ||
      typeof meta?.total_pages !== "number"
    ) {
      if ((body.data ?? []).length === 0 && owned.length > 0) break;
      throw new Error(
        `Telnyx list response missing pagination meta on page ${pageNumber} — refusing to report a possibly-partial audit`
      );
    }
    if (meta.page_number >= meta.total_pages) break;
    pageNumber = meta.page_number + 1;
  }
  return owned;
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const [owned, { data: rows, error: rowsError }, { data: businesses, error: bizError }] =
  await Promise.all([
    listOwnedTelnyxNumbers(),
    supabase
      .from("phone_numbers")
      .select("phone_number, telnyx_phone_number_id, business_id, is_active"),
    supabase.from("businesses").select("id, deleted_at"),
  ]);

if (rowsError) throw new Error(`phone_numbers read failed: ${rowsError.message}`);
if (bizError) throw new Error(`businesses read failed: ${bizError.message}`);

const rowsByTelnyxId = new Map(rows.map((r) => [r.telnyx_phone_number_id, r]));
const rowsByNumber = new Map(rows.map((r) => [r.phone_number, r]));
const businessById = new Map(businesses.map((b) => [b.id, b]));

console.log(`Telnyx-owned numbers: ${owned.length}`);
console.log(
  `phone_numbers rows:   ${rows.length} (${rows.filter((r) => r.is_active).length} active)`
);
console.log("");

let orphans = 0;
let tombstoned = 0;

for (const n of owned) {
  const row = rowsByTelnyxId.get(n.id) ?? rowsByNumber.get(n.phone_number);
  if (!row) {
    orphans += 1;
    console.log(
      `ORPHAN: ${mask(n.phone_number)} (telnyx id=${n.id}, status=${n.status}, ordered=${n.created_at}) — no phone_numbers row; customer_reference=${n.customer_reference ?? "none"}`
    );
    continue;
  }
  const business = businessById.get(row.business_id);
  if (business?.deleted_at) {
    tombstoned += 1;
    console.log(
      `TOMBSTONED: ${mask(n.phone_number)} (telnyx id=${n.id}) — row belongs to deleted business ${row.business_id}`
    );
  }
}

console.log("");
console.log(
  `Result: ${orphans} orphan(s), ${tombstoned} owned for tombstoned business(es).`
);
console.log(
  orphans + tombstoned === 0
    ? "Clean — every owned number is tracked by a live business."
    : "Review above; releases are MANUAL ONLY (releaseNumber via operator, per §2 prod-mutation rule)."
);
