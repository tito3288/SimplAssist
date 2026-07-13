/**
 * Brand-rejection recovery harness (LOCAL STACK ONLY).
 *
 * Poisoned-payload verification of the brand archive-and-refile pipeline
 * before prod deploy. Runs everything in one process:
 *  - in-process mock Telnyx API (TELNYX_BASE_URL points at it)
 *  - real Ed25519-signed webhooks through the actual route handler
 *  - real DB writes through the local Supabase stack (service role)
 *
 * Prereqs: local stack running (npx supabase start), migrations applied,
 * grants shim applied (see scripts/brand-recovery-harness/README notes in
 * project memory), server-only shim in node_modules.
 *
 * Run from repo root:
 *   npx tsx scripts/brand-recovery-harness/run.ts
 *
 * Every env var is set below BEFORE any app module is imported — this
 * process never reads .env.local and cannot touch prod.
 */

import { generateKeyPairSync, sign as edSign } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// 1. Environment — local stack + fakes. MUST precede app imports.
// ---------------------------------------------------------------------------
const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyRaw = publicKey.export({ type: "spki", format: "der" });
// raw 32-byte key = last 32 bytes of the SPKI DER
const publicKeyB64 = Buffer.from(publicKeyRaw.subarray(-32)).toString("base64");

process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
process.env.TELNYX_API_KEY = "KEYfake_harness";
process.env.TELNYX_PUBLIC_KEY = publicKeyB64;
process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3111";
process.env.RESEND_API_KEY = "re_fake_harness";
process.env.TELNYX_MESSAGING_PROFILE_ID = "fake-shared-profile";
process.env.TELNYX_CONNECTION_ID = "fake-connection";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
process.env.ANTHROPIC_API_KEY = "fake";
process.env.FIRECRAWL_API_KEY = "fake";

// ---------------------------------------------------------------------------
// 2. Mock Telnyx API
// ---------------------------------------------------------------------------
interface MockCall {
  seq: number;
  method: string;
  path: string;
}
const mockLog: MockCall[] = [];
const mockFlags = { failBrandCreate: false, failBrandDelete: false };
let brandSeq = 0;
let campaignSeq = 0;
let seq = 0;

const mockServer = http.createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const method = req.method ?? "GET";
  mockLog.push({ seq: ++seq, method, path });

  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (method === "POST" && path === "/v2/10dlc/brand") {
    if (mockFlags.failBrandCreate) {
      return json(400, { errors: [{ detail: "mock brand create rejected" }] });
    }
    return json(200, { brandId: `brand-NEW-${++brandSeq}` });
  }
  if (method === "DELETE" && path.startsWith("/v2/10dlc/brand/")) {
    if (mockFlags.failBrandDelete) {
      return json(400, { errors: [{ detail: "mock brand delete refused" }] });
    }
    return json(200, {});
  }
  if (method === "DELETE" && path.startsWith("/v2/10dlc/campaign/")) {
    return json(200, {});
  }
  if (method === "GET" && path === "/v2/10dlc/campaign/usecase/cost") {
    return json(200, {
      usecase: "CUSTOMER_CARE",
      monthlyCost: "10.00",
      upFrontCost: "0.00",
    });
  }
  if (method === "GET" && path.startsWith("/v2/10dlc/campaignBuilder/brand/")) {
    return json(200, { usecase: "CUSTOMER_CARE" });
  }
  if (method === "POST" && path === "/v2/10dlc/campaignBuilder") {
    return json(200, { campaignId: `cmp-NEW-${++campaignSeq}` });
  }
  if (path.startsWith("/v2/phone_numbers/")) {
    return json(200, { data: {} });
  }
  console.warn(`[mock-telnyx] unmapped call: ${method} ${path}`);
  return json(200, { data: {} });
});

// ---------------------------------------------------------------------------
// 3. Assertion plumbing
// ---------------------------------------------------------------------------
let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------
async function main() {
  await new Promise<void>((r) => mockServer.listen(0, "127.0.0.1", r));
  const mockPort = (mockServer.address() as AddressInfo).port;
  process.env.TELNYX_BASE_URL = `http://127.0.0.1:${mockPort}/v2`;

  // App imports AFTER env is final.
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { POST: webhookPOST } = await import(
    "@/app/api/messaging/registration/status/route"
  );
  const { attemptPaidLaunch } = await import("@/lib/billing/launch");
  const { buildA2pRiskInputForBusiness, hashA2pRiskInput } = await import(
    "@/lib/messaging/registration/riskScreening"
  );
  const { NextRequest } = await import("next/server");

  // ---- helpers ----
  let userSeq = 0;
  async function seedRegisteredBusiness(tag: string) {
    const email = `harness-${tag}-${Date.now()}-${++userSeq}@test.local`;
    const { data: created, error: userErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: "harness-password-123!",
        email_confirm: true,
      });
    if (userErr || !created.user) throw new Error(`createUser: ${userErr?.message}`);
    const ownerId = created.user.id;

    const { data: biz, error: bizErr } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("owner_id", ownerId)
      .single<{ id: string }>();
    if (bizErr || !biz) throw new Error(`business lookup: ${bizErr?.message}`);

    const now = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("businesses")
      .update({
        name: `Harness Biz ${tag}`,
        business_type: "general",
        website_url: "https://example.com",
        phone_number: "5551234567",
        email: `biz-${tag}@test.local`,
        address: "1 Main St",
        city: "Testville",
        state: "CA",
        zip: "94000",
        slug: `harness-${tag}-${userSeq}`,
        sms_consent_agreed: true,
        legal_business_name: `Harness Legal ${tag} LLC`,
        business_entity_type: "llc",
        business_registration_state: "CA",
        tax_id_type: "ein",
        has_ein: true,
        ein: "12-3456789",
        a2p_brand_tier: "low_volume_standard",
        authorized_rep_name: "Jane Doe",
        authorized_rep_title: "Owner",
        authorized_rep_email: `rep-${tag}@test.local`,
        authorized_rep_phone: "5559876543",
        use_case_description: "Customer care replies about appointments and services.",
        estimated_monthly_volume: "1000",
        sample_messages: [
          "Hi, this is Harness Biz. Your appointment is confirmed. Reply STOP to opt out.",
          "Thanks for reaching out to Harness Biz — we'll reply shortly. Reply STOP to opt out.",
          "Harness Biz here: your quote is ready. Reply STOP to opt out.",
        ],
        opt_in_description: "Customers text our business number to start a conversation.",
        compliance_info_completed_at: now,
        privacy_terms_mode: "hosted",
        telnyx_brand_id: `brand-OLD-${tag}`,
        brand_status: "pending",
        brand_status_updated_at: now,
        telnyx_campaign_id: `cmp-OLD-${tag}`,
        campaign_status: "pending",
        campaign_status_updated_at: now,
        telnyx_messaging_profile_id: `prof-${tag}`,
        telnyx_voice_application_id: `voice-${tag}`,
        onboarding_registration_status: "submitted",
        onboarding_registration_started_at: now,
        onboarding_registration_submitted_at: now,
        billing_exempt: true,
      })
      .eq("id", biz.id);
    if (updErr) throw new Error(`seed update: ${updErr.message}`);

    const { error: pnErr } = await supabaseAdmin.from("phone_numbers").insert({
      business_id: biz.id,
      phone_number: `+1555123${String(1000 + userSeq).slice(-4)}`,
      telnyx_phone_number_id: `pn-${tag}-${userSeq}`,
      is_active: true,
    });
    if (pnErr) throw new Error(`phone seed: ${pnErr.message}`);

    // Stamp a passed risk decision over the seeded content's real hash so the
    // retry gate sees hashMatches=true and never tries to crawl.
    const { input } = await buildA2pRiskInputForBusiness(biz.id);
    const { error: riskErr } = await supabaseAdmin
      .from("businesses")
      .update({
        a2p_risk_review_status: "passed",
        a2p_risk_review_input_hash: hashA2pRiskInput(input),
        a2p_risk_review_scanned_at: now,
      })
      .eq("id", biz.id);
    if (riskErr) throw new Error(`risk stamp: ${riskErr.message}`);

    return biz.id;
  }

  function signedWebhook(eventId: string, payload: Record<string, unknown>) {
    const raw = JSON.stringify({
      data: { id: eventId, event_type: "brand.update", payload },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = edSign(
      null,
      Buffer.concat([Buffer.from(ts), Buffer.from("|"), Buffer.from(raw)]),
      privateKey
    ).toString("base64");
    return new NextRequest("http://127.0.0.1:3111/api/messaging/registration/status", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": ts,
      },
    });
  }

  const POISONED_REASON =
    "<script>alert(1)</script> EIN mismatch — брэнд ✗ 'quotes' \"double\" & ampersand; " +
    "carrier code 808: Registration Number does not match state records " +
    "(this reason is deliberately hostile: HTML, unicode, punctuation).";

  async function biz(id: string) {
    const { data } = await supabaseAdmin
      .from("businesses")
      .select(
        "telnyx_brand_id, brand_status, brand_rejection_reason, telnyx_campaign_id, campaign_status, campaign_rejection_reason, telnyx_messaging_profile_id, telnyx_voice_application_id, onboarding_registration_status, onboarding_registration_error, onboarding_registration_submitted_at"
      )
      .eq("id", id)
      .single();
    return data!;
  }

  async function rejectBrandViaWebhook(businessId: string, tag: string, eventId: string) {
    const res = await webhookPOST(
      signedWebhook(eventId, {
        brandId: `brand-OLD-${tag}`,
        brandIdentityStatus: "UNVERIFIED",
        status: "REGISTRATION_FAILED",
        description: POISONED_REASON,
      })
    );
    return res.status;
  }

  // =========================================================================
  section("A. Poisoned rejection webhook (business A)");
  const bizA = await seedRegisteredBusiness("A");
  const statusA = await rejectBrandViaWebhook(bizA, "A", "evt-A-1");
  let a = await biz(bizA);
  check("webhook returns 200", statusA === 200, statusA);
  check("brand_status = rejected", a.brand_status === "rejected", a.brand_status);
  check(
    "poisoned reason stored verbatim",
    a.brand_rejection_reason === POISONED_REASON,
    a.brand_rejection_reason?.slice(0, 60)
  );
  check(
    "onboarding_registration_status = failed (edit lock exempts this)",
    a.onboarding_registration_status === "failed"
  );
  check("submitted_at cleared", a.onboarding_registration_submitted_at === null);
  check("campaign untouched by webhook", a.campaign_status === "pending");

  const auditCount = async () => {
    const { count } = await supabaseAdmin
      .from("telnyx_registration_events")
      .select("id", { count: "exact", head: true })
      .eq("business_id", bizA)
      .eq("event_type", "brand_status_changed");
    return count ?? 0;
  };
  const auditBefore = await auditCount();
  const dupStatus = await rejectBrandViaWebhook(bizA, "A", "evt-A-1");
  check("duplicate event id returns 200", dupStatus === 200, dupStatus);
  check("duplicate event not re-processed (audit count unchanged)", (await auditCount()) === auditBefore);

  // =========================================================================
  section("B. Healthy retry: archive + cascade + re-file (business A)");
  const mockStart = mockLog.length;
  const launchA = await attemptPaidLaunch(bizA, "onboarding_retry");
  a = await biz(bizA);
  check("launch result = submitted", launchA.status === "submitted", launchA);
  check("new brand id assigned", a.telnyx_brand_id === "brand-NEW-1", a.telnyx_brand_id);
  check("brand_status = pending", a.brand_status === "pending");
  check("brand_rejection_reason cleared", a.brand_rejection_reason === null);
  check("new campaign id assigned", a.telnyx_campaign_id === "cmp-NEW-1", a.telnyx_campaign_id);
  check("campaign_status = pending", a.campaign_status === "pending");
  check("messaging profile untouched", a.telnyx_messaging_profile_id === "prof-A");
  check("voice application untouched", a.telnyx_voice_application_id === "voice-A");
  check("onboarding = submitted", a.onboarding_registration_status === "submitted");

  const { data: rbA } = await supabaseAdmin
    .from("rejected_brands")
    .select("telnyx_brand_id, rejection_reason, telnyx_deleted, deletion_error")
    .eq("business_id", bizA);
  check("rejected_brands has exactly 1 row", rbA?.length === 1, rbA?.length);
  check("history preserves old brand id", rbA?.[0]?.telnyx_brand_id === "brand-OLD-A");
  check("history preserves poisoned reason", rbA?.[0]?.rejection_reason === POISONED_REASON);
  check("brand deleted at Telnyx", rbA?.[0]?.telnyx_deleted === true && rbA?.[0]?.deletion_error === null);

  const { data: rcA } = await supabaseAdmin
    .from("rejected_campaigns")
    .select("telnyx_campaign_id, rejection_reason, telnyx_deactivated")
    .eq("business_id", bizA);
  check("rejected_campaigns has exactly 1 row (cascade)", rcA?.length === 1, rcA?.length);
  check(
    "cascade row records brand-refile cause",
    rcA?.[0]?.rejection_reason === "Archived during brand re-file: parent brand rejected",
    rcA?.[0]?.rejection_reason
  );
  check("old campaign deactivated at Telnyx", rcA?.[0]?.telnyx_deactivated === true);

  const calls = mockLog.slice(mockStart);
  const campaignDeactivateSeq = calls.find(
    (c) => c.method === "DELETE" && c.path === "/v2/10dlc/campaign/cmp-OLD-A"
  )?.seq;
  const brandDeleteSeq = calls.find(
    (c) => c.method === "DELETE" && c.path === "/v2/10dlc/brand/brand-OLD-A"
  )?.seq;
  const brandCreateSeq = calls.find(
    (c) => c.method === "POST" && c.path === "/v2/10dlc/brand"
  )?.seq;
  check(
    "order: campaign deactivate BEFORE brand delete",
    !!campaignDeactivateSeq && !!brandDeleteSeq && campaignDeactivateSeq < brandDeleteSeq,
    { campaignDeactivateSeq, brandDeleteSeq }
  );
  check(
    "order: brand delete BEFORE new brand create",
    !!brandDeleteSeq && !!brandCreateSeq && brandDeleteSeq < brandCreateSeq,
    { brandDeleteSeq, brandCreateSeq }
  );

  const { data: pnA } = await supabaseAdmin
    .from("phone_numbers")
    .select("telnyx_campaign_assignment_status, telnyx_campaign_assignment_campaign_id")
    .eq("business_id", bizA)
    .eq("is_active", true)
    .single();
  check(
    "phone assignment reset to unassigned",
    pnA?.telnyx_campaign_assignment_status === "unassigned" &&
      pnA?.telnyx_campaign_assignment_campaign_id === null,
    pnA
  );

  // =========================================================================
  section("C. Late webhook for the OLD brand id is dropped (business A)");
  const lateStatus = await rejectBrandViaWebhook(bizA, "A", "evt-A-late");
  a = await biz(bizA);
  check("late old-brand webhook returns 200", lateStatus === 200, lateStatus);
  check("new brand unaffected", a.brand_status === "pending" && a.telnyx_brand_id === "brand-NEW-1");
  check("onboarding still submitted", a.onboarding_registration_status === "submitted");

  // =========================================================================
  section("D. Double-submit: concurrent retries claim once (business D)");
  const bizD = await seedRegisteredBusiness("D");
  await rejectBrandViaWebhook(bizD, "D", "evt-D-1");
  const mockStartD = mockLog.length;
  const [r1, r2] = await Promise.all([
    attemptPaidLaunch(bizD, "onboarding_retry"),
    attemptPaidLaunch(bizD, "onboarding_retry"),
  ]);
  const statuses = [r1.status, r2.status].sort();
  check(
    "exactly one submitted, one blocked",
    statuses.includes("submitted") &&
      (statuses.includes("in_progress") || statuses.includes("already_submitted")),
    statuses
  );
  const brandCreatesD = mockLog
    .slice(mockStartD)
    .filter((c) => c.method === "POST" && c.path === "/v2/10dlc/brand").length;
  check("brand created exactly once", brandCreatesD === 1, brandCreatesD);

  // =========================================================================
  section("E. Brand delete failure is best-effort (business E)");
  const bizE = await seedRegisteredBusiness("E");
  await rejectBrandViaWebhook(bizE, "E", "evt-E-1");
  mockFlags.failBrandDelete = true;
  const launchE = await attemptPaidLaunch(bizE, "onboarding_retry");
  mockFlags.failBrandDelete = false;
  const e = await biz(bizE);
  check("retry still completes (submitted)", launchE.status === "submitted", launchE);
  check("replacement brand created despite delete failure", e.telnyx_brand_id?.startsWith("brand-NEW-"));
  const { data: rbE } = await supabaseAdmin
    .from("rejected_brands")
    .select("telnyx_deleted, deletion_error")
    .eq("business_id", bizE)
    .single();
  check(
    "deletion failure recorded on worklist (telnyx_deleted=false, deletion_error set)",
    rbE?.telnyx_deleted === false && !!rbE?.deletion_error,
    rbE
  );

  // =========================================================================
  section("F. Partial failure is re-runnable (business F)");
  const bizF = await seedRegisteredBusiness("F");
  await rejectBrandViaWebhook(bizF, "F", "evt-F-1");
  mockFlags.failBrandCreate = true;
  const launchF1 = await attemptPaidLaunch(bizF, "onboarding_retry");
  mockFlags.failBrandCreate = false;
  let f = await biz(bizF);
  check("first retry fails cleanly", launchF1.status === "failed", launchF1);
  check("brand pointer cleared before the failure", f.telnyx_brand_id === null && f.brand_status === null);
  check("campaign pointer cleared by cascade", f.telnyx_campaign_id === null && f.campaign_status === null);
  check("state is retryable (failed)", f.onboarding_registration_status === "failed");
  const historyCounts = async () => {
    const [{ count: rb }, { count: rc }] = await Promise.all([
      supabaseAdmin
        .from("rejected_brands")
        .select("id", { count: "exact", head: true })
        .eq("business_id", bizF),
      supabaseAdmin
        .from("rejected_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("business_id", bizF),
    ]);
    return { rb: rb ?? 0, rc: rc ?? 0 };
  };
  const countsAfterFail = await historyCounts();
  check("history rows persisted before failure", countsAfterFail.rb === 1 && countsAfterFail.rc === 1, countsAfterFail);

  const launchF2 = await attemptPaidLaunch(bizF, "onboarding_retry");
  f = await biz(bizF);
  const countsAfterHeal = await historyCounts();
  check("second retry completes", launchF2.status === "submitted", launchF2);
  check("new brand + campaign filed", !!f.telnyx_brand_id && !!f.telnyx_campaign_id);
  check("history rows NOT duplicated on re-run", countsAfterHeal.rb === 1 && countsAfterHeal.rc === 1, countsAfterHeal);

  // =========================================================================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULT: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;

  mockServer.close();
}

main().catch((err) => {
  console.error("HARNESS CRASH:", err);
  process.exitCode = 1;
  mockServer.close();
});
