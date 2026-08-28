import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebsiteScanClaim, WebsiteScanDraft, WebsiteScanPage } from "./domain";
import { createWebsiteScanRepository } from "./repository";

const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient;
const repository = createWebsiteScanRepository(client);

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  business_id: "22222222-2222-4222-8222-222222222222",
  source_url: "https://example.com",
  claim_token: "33333333-3333-4333-8333-333333333333",
  claim_generation: 4,
  attempt_count: 2,
  started_at: "2026-01-01T00:00:00Z",
  provider_job_id: "job-existing",
  provider_job_attempt: 1,
  pages_discovered: 8,
  pages_completed: 4,
  pages_failed: 1,
  credits_used: 5,
  cancel_requested_at: null,
};

const claim = {
  id: row.id,
  businessId: row.business_id,
  sourceUrl: row.source_url,
  claimToken: row.claim_token,
  generation: row.claim_generation,
  attemptCount: row.attempt_count,
  startedAt: row.started_at,
  providerJobId: row.provider_job_id,
  providerJobAttempt: row.provider_job_attempt,
  pagesDiscovered: row.pages_discovered,
  pagesCompleted: row.pages_completed,
  pagesFailed: row.pages_failed,
  creditsUsed: row.credits_used,
  cancelRequestedAt: null,
  baseline: {},
} satisfies WebsiteScanClaim;

describe("website scan repository RPC contract", () => {
  beforeEach(() => rpc.mockReset());

  it("parses the persisted provider job and strict claim generation", async () => {
    rpc.mockResolvedValue({ data: row, error: null });
    await expect(repository.claim("worker:1", 120)).resolves.toEqual(claim);
    expect(rpc).toHaveBeenCalledWith("claim_next_website_scan_v1", {
      p_worker_id: "worker:1",
      p_lease_seconds: 120,
    });
  });

  it("treats an all-null PostgreSQL composite as an empty queue", async () => {
    rpc.mockResolvedValue({
      data: Object.fromEntries(Object.keys(row).map((key) => [key, null])),
      error: null,
    });

    await expect(repository.claim("worker:1", 120)).resolves.toBeNull();
  });

  it("still rejects a partially populated malformed claim", async () => {
    rpc.mockResolvedValue({
      data: { id: null, business_id: row.business_id },
      error: null,
    });

    await expect(repository.claim("worker:1", 120)).rejects.toThrow("missing id");
  });

  it("threads token and generation through heartbeat and progress", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await repository.heartbeat(claim, 120);
    await repository.updateProgress(claim, {
      status: "crawling",
      providerJobId: "job-existing",
      providerJobAttempt: 1,
      pagesDiscovered: 8,
      pagesCompleted: 4,
      pagesFailed: 1,
      creditsUsed: 5,
    });
    expect(rpc.mock.calls).toEqual([
      ["heartbeat_website_scan_v1", {
        p_scan_id: claim.id,
        p_claim_token: claim.claimToken,
        p_claim_generation: 4,
        p_lease_seconds: 120,
      }],
      ["update_website_scan_progress_v1", {
        p_scan_id: claim.id,
        p_claim_token: claim.claimToken,
        p_claim_generation: 4,
        p_status: "crawling",
        p_provider_job_id: "job-existing",
        p_provider_job_attempt: 1,
        p_pages_discovered: 8,
        p_pages_completed: 4,
        p_pages_failed: 1,
        p_credits_used: 5,
      }],
    ]);
  });

  it("sends the exact success and failed-page persistence shapes", async () => {
    rpc.mockResolvedValue({ data: "44444444-4444-4444-8444-444444444444", error: null });
    const page: WebsiteScanPage = {
      url: "https://example.com/services",
      title: "Services",
      markdown: "Service content",
      contentHash: "a".repeat(64),
      characterCount: 15,
    };
    await repository.savePage(claim, page, 0);
    await repository.saveFailedPage(claim, "https://example.com/pricing", 1, "provider_page_failed");

    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_page_index: 0,
      p_normalized_url: page.url,
      p_markdown: page.markdown,
      p_status: "succeeded",
      p_error_code: null,
    });
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_page_index: 1,
      p_normalized_url: "https://example.com/pricing",
      p_markdown: null,
      p_content_hash: null,
      p_character_count: 0,
      p_status: "failed",
      p_error_code: "provider_page_failed",
    });
  });

  it("passes completion and retry classification only through the fenced RPCs", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const draft = { overview: { text: "Overview", sources: [] } } as unknown as WebsiteScanDraft;
    await repository.complete(claim, "partial", draft);
    await repository.fail(claim, {
      code: "provider_status_timeout",
      message: "temporary\nprovider problem",
      retryable: true,
    });
    expect(rpc.mock.calls[0]).toEqual([
      "complete_website_scan_draft_v1",
      expect.objectContaining({ p_claim_generation: 4, p_coverage: "partial", p_draft: draft }),
    ]);
    expect(rpc.mock.calls[1]).toEqual([
      "fail_website_scan_v1",
      expect.objectContaining({
        p_claim_generation: 4,
        p_error_code: "provider_status_timeout",
        p_error_message: "temporary provider problem",
        p_retryable: true,
      }),
    ]);
  });

  it("uses the service-only payload purge RPC", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expect(repository.purgeExpiredPayloads()).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledWith("purge_website_scan_payloads_v1", {});
  });
});
