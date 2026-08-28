import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  baselineSchema,
  type WebsiteScanClaim,
  type WebsiteScanBaseline,
  type WebsiteScanDraft,
  type WebsiteScanPage,
  type WebsiteScanStage,
} from "./domain";

export interface WebsiteScanProgressUpdate {
  status: WebsiteScanStage;
  providerJobId: string | null;
  providerJobAttempt: number;
  pagesDiscovered: number;
  pagesCompleted: number;
  pagesFailed: number;
  creditsUsed: number;
}

export interface WebsiteScanRepository {
  claim(workerId: string, leaseSeconds: number): Promise<WebsiteScanClaim | null>;
  loadBaseline(claim: WebsiteScanClaim): Promise<WebsiteScanBaseline>;
  heartbeat(claim: WebsiteScanClaim, leaseSeconds: number): Promise<boolean>;
  updateProgress(claim: WebsiteScanClaim, progress: WebsiteScanProgressUpdate): Promise<boolean>;
  savePage(claim: WebsiteScanClaim, page: WebsiteScanPage, index: number): Promise<boolean>;
  saveFailedPage(claim: WebsiteScanClaim, url: string, index: number, errorCode: string): Promise<boolean>;
  complete(
    claim: WebsiteScanClaim,
    coverage: "complete" | "partial" | "insufficient",
    draft: WebsiteScanDraft
  ): Promise<boolean>;
  fail(claim: WebsiteScanClaim, failure: {
    code: string;
    message: string;
    retryable: boolean;
  }): Promise<boolean>;
  isCancellationRequested(claim: WebsiteScanClaim): Promise<boolean>;
  purgeExpiredPayloads(): Promise<number>;
}

type RpcResult = { data: unknown; error: { message: string } | null };

export function createWebsiteScanRepository(
  client: SupabaseClient
): WebsiteScanRepository {
  const rpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const result = (await client.rpc(name as never, args as never)) as RpcResult;
    if (result.error) throw new WebsiteScanPersistenceError(name, result.error.message);
    return result.data;
  };

  return {
    async claim(workerId, leaseSeconds) {
      const data = await rpc("claim_next_website_scan_v1", {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      });
      if (data === null) return null;
      return parseClaim(data);
    },

    async loadBaseline(claim) {
      const [services, faqs, knowledge, overview, scanOrigins] = await Promise.all([
        client
          .from("services")
          .select("id,name,description,price,source")
          .eq("business_id", claim.businessId)
          .eq("is_active", true),
        client
          .from("faqs")
          .select("id,question,answer,source")
          .eq("business_id", claim.businessId)
          .eq("is_active", true),
        client
          .from("business_knowledge_items")
          .select("id,kind,category,title,content,source,owner_edited")
          .eq("business_id", claim.businessId)
          .in("kind", ["fact", "policy"])
          .eq("is_active", true),
        client
          .from("business_knowledge_items")
          .select("id,kind,category,title,content,source,owner_edited")
          .eq("business_id", claim.businessId)
          .eq("kind", "overview")
          .eq("is_active", true)
          .order("verified_at", { ascending: false })
          .limit(1),
        client
          .from("website_scan_suggestions")
          .select("published_target_id,owner_edited")
          .eq("business_id", claim.businessId)
          .eq("decision", "accepted")
          .not("published_target_id", "is", null),
      ]);
      for (const result of [services, faqs, knowledge, overview, scanOrigins]) {
        if (result.error) {
          throw new WebsiteScanPersistenceError("load_baseline", result.error.message);
        }
      }
      const websiteTargets = new Map(
        ((scanOrigins.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
          const id = stringOrNull(row.published_target_id);
          return id ? [[id, row.owner_edited === true] as const] : [];
        })
      );
      const overviewRow = ((overview.data ?? []) as Record<string, unknown>[])[0];
      return {
        overview: (() => {
          if (!overviewRow) return undefined;
          const id = stringOrNull(overviewRow.id);
          const contentValue = stringOrNull(overviewRow.content);
          if (!id || !contentValue) return undefined;
          const content = `overview|${stringOrNull(overviewRow.category) ?? ""}|${stringOrNull(overviewRow.title) ?? ""}|${contentValue}`;
          return {
            id,
            key: "overview",
            content,
            baselineHash: baselineHash(content),
            source: knowledgeSource(overviewRow.source),
            ownerEdited: overviewRow.owner_edited === true,
          };
        })(),
        services: ((services.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
          const id = stringOrNull(row.id);
          const name = stringOrNull(row.name);
          if (!id || !name) return [];
          const content = `${name}|${stringOrNull(row.description) ?? ""}|${stringOrNull(row.price) ?? ""}`;
          return [{
            id,
            key: name,
            content,
            baselineHash: baselineHash(content),
            source: websiteTargets.has(id) ? "scraped" as const : knowledgeSource(row.source),
            ownerEdited: websiteTargets.get(id),
          }];
        }),
        faqs: ((faqs.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
          const id = stringOrNull(row.id);
          const question = stringOrNull(row.question);
          if (!id || !question) return [];
          const content = `${question}|${stringOrNull(row.answer) ?? ""}`;
          return [{
            id,
            key: question,
            content,
            baselineHash: baselineHash(content),
            source: websiteTargets.has(id) ? "scraped" as const : knowledgeSource(row.source),
            ownerEdited: websiteTargets.get(id),
          }];
        }),
        knowledge: ((knowledge.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
          const id = stringOrNull(row.id);
          const title = stringOrNull(row.title);
          if (row.kind !== "fact" && row.kind !== "policy") return [];
          const kind = row.kind;
          if (!id || !title) return [];
          const content = `${kind}|${stringOrNull(row.category) ?? ""}|${title}|${stringOrNull(row.content) ?? ""}`;
          return [{
            id,
            key: `${kind}:${title}`,
            content,
            baselineHash: baselineHash(content),
            source: knowledgeSource(row.source),
            ownerEdited: row.owner_edited === true,
          }];
        }),
      };
    },

    async heartbeat(claim, leaseSeconds) {
      return parseBoolean(
        await rpc("heartbeat_website_scan_v1", fencedArgs(claim, {
          p_lease_seconds: leaseSeconds,
        })),
        "heartbeat_website_scan_v1"
      );
    },

    async updateProgress(claim, progress) {
      return parseBoolean(
        await rpc("update_website_scan_progress_v1", fencedArgs(claim, {
          p_status: progress.status,
          p_provider_job_id: progress.providerJobId,
          p_provider_job_attempt: progress.providerJobAttempt,
          p_pages_discovered: progress.pagesDiscovered,
          p_pages_completed: progress.pagesCompleted,
          p_pages_failed: progress.pagesFailed,
          p_credits_used: progress.creditsUsed,
        })),
        "update_website_scan_progress_v1"
      );
    },

    async savePage(claim, page, index) {
      return parseSavedPage(
        await rpc("save_website_scan_page_v1", fencedArgs(claim, {
          p_page_index: index,
          p_normalized_url: page.url,
          p_title: page.title,
          p_markdown: page.markdown,
          p_content_hash: page.contentHash,
          p_character_count: page.characterCount,
          p_status: "succeeded",
          p_error_code: null,
        })),
        "save_website_scan_page_v1"
      );
    },

    async saveFailedPage(claim, url, index, errorCode) {
      return parseSavedPage(
        await rpc("save_website_scan_page_v1", fencedArgs(claim, {
          p_page_index: index,
          p_normalized_url: url,
          p_title: null,
          p_markdown: null,
          p_content_hash: null,
          p_character_count: 0,
          p_status: "failed",
          p_error_code: errorCode,
        })),
        "save_website_scan_page_v1"
      );
    },

    async complete(claim, coverage, draft) {
      return parseBoolean(
        await rpc("complete_website_scan_draft_v1", fencedArgs(claim, {
          p_coverage: coverage,
          p_draft: draft,
        })),
        "complete_website_scan_draft_v1"
      );
    },

    async fail(claim, failure) {
      return parseBoolean(
        await rpc("fail_website_scan_v1", fencedArgs(claim, {
          p_error_code: failure.code,
          p_error_message: safeErrorMessage(failure.message),
          p_retryable: failure.retryable,
        })),
        "fail_website_scan_v1"
      );
    },

    async isCancellationRequested(claim) {
      const result = await client
        .from("website_scan_runs")
        .select("claim_token,claim_generation,cancel_requested_at,status")
        .eq("id", claim.id)
        .maybeSingle();
      if (result.error) {
        throw new WebsiteScanPersistenceError("read_cancel_state", result.error.message);
      }
      const row = result.data as Record<string, unknown> | null;
      if (!row) return true;
      if (row.status === "cancelled" || typeof row.cancel_requested_at === "string") {
        return true;
      }
      if (row.claim_token !== claim.claimToken || row.claim_generation !== claim.generation) {
        throw new WebsiteScanLeaseLostError(claim.id);
      }
      return false;
    },

    async purgeExpiredPayloads() {
      const value = await rpc("purge_website_scan_payloads_v1", {});
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new WebsiteScanPersistenceError(
          "purge_website_scan_payloads_v1",
          "expected a non-negative row count"
        );
      }
      return value;
    },
  };
}

export class WebsiteScanPersistenceError extends Error {
  constructor(operation: string, detail: string) {
    super(`Website scan persistence failed during ${operation}: ${detail}`);
    this.name = "WebsiteScanPersistenceError";
  }
}

export class WebsiteScanLeaseLostError extends Error {
  constructor(scanId: string) {
    super(`Website scan ${scanId} is no longer owned by this worker`);
    this.name = "WebsiteScanLeaseLostError";
  }
}

function fencedArgs(
  claim: WebsiteScanClaim,
  args: Record<string, unknown>
): Record<string, unknown> {
  return {
    p_scan_id: claim.id,
    p_claim_token: claim.claimToken,
    p_claim_generation: claim.generation,
    ...args,
  };
}

function parseClaim(value: unknown): WebsiteScanClaim {
  if (!isRecord(value)) throw new WebsiteScanPersistenceError("claim", "invalid claim response");
  const id = requiredString(value.id, "id");
  return {
    id,
    businessId: requiredString(value.business_id, "business_id"),
    sourceUrl: requiredString(value.source_url, "source_url"),
    claimToken: requiredString(value.claim_token, "claim_token"),
    generation: requiredInteger(value.claim_generation ?? value.generation, "claim_generation"),
    attemptCount: requiredInteger(value.attempt_count, "attempt_count"),
    startedAt: typeof value.started_at === "string" ? value.started_at : null,
    providerJobId:
      typeof value.provider_job_id === "string" && value.provider_job_id
        ? value.provider_job_id
        : null,
    providerJobAttempt: optionalInteger(value.provider_job_attempt),
    pagesDiscovered: optionalInteger(value.pages_discovered),
    pagesCompleted: optionalInteger(value.pages_completed),
    pagesFailed: optionalInteger(value.pages_failed),
    creditsUsed: optionalInteger(value.credits_used),
    cancelRequestedAt:
      typeof value.cancel_requested_at === "string" ? value.cancel_requested_at : null,
    baseline: baselineSchema.parse({}),
  };
}

function parseBoolean(value: unknown, operation: string): boolean {
  if (typeof value !== "boolean") {
    throw new WebsiteScanPersistenceError(operation, "expected a boolean response");
  }
  return value;
}

function parseSavedPage(value: unknown, operation: string): boolean {
  if (typeof value !== "string" || !value) {
    throw new WebsiteScanPersistenceError(operation, "expected a saved page identifier");
  }
  return true;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new WebsiteScanPersistenceError("claim", `missing ${name}`);
  }
  return value;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WebsiteScanPersistenceError("claim", `invalid ${name}`);
  }
  return value;
}

function optionalInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeErrorMessage(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function knowledgeSource(value: unknown): "scraped" | "manual" | "suggested" | undefined {
  if (value === "website_scan") return "scraped";
  return value === "scraped" || value === "manual" || value === "suggested" ? value : undefined;
}

function baselineHash(value: string): string {
  // Kept in sync with the extraction diff fingerprint.
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}
