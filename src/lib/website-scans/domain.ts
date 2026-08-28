import { z } from "zod";

export const SCAN_PAGE_LIMIT = 12;
export const SCAN_PAGE_CHARACTER_LIMIT = 25_000;
export const SCAN_TOTAL_CHARACTER_LIMIT = 120_000;
export const SCAN_DEADLINE_MS = 6 * 60_000;
export const SCAN_LEASE_SECONDS = 120;

export type WebsiteScanStage =
  | "discovering"
  | "crawling"
  | "extracting";

export interface WebsiteScanEvidence {
  url: string;
  title: string | null;
  excerpt: string;
}

export interface WebsiteScanPage {
  url: string;
  title: string | null;
  markdown: string;
  contentHash: string;
  characterCount: number;
}

export interface WebsiteScanBaselineItem {
  id: string;
  key: string;
  content: string;
  baselineHash: string;
  source?: "scraped" | "manual" | "suggested";
  ownerEdited?: boolean;
}

export interface WebsiteScanBaseline {
  overview?: WebsiteScanBaselineItem;
  services?: WebsiteScanBaselineItem[];
  faqs?: WebsiteScanBaselineItem[];
  knowledge?: WebsiteScanBaselineItem[];
}

export interface WebsiteScanClaim {
  id: string;
  businessId: string;
  sourceUrl: string;
  claimToken: string;
  generation: number;
  attemptCount: number;
  startedAt: string | null;
  providerJobId: string | null;
  providerJobAttempt: number;
  pagesDiscovered: number;
  pagesCompleted: number;
  pagesFailed: number;
  creditsUsed: number;
  cancelRequestedAt: string | null;
  baseline: WebsiteScanBaseline;
}

export type WebsiteScanChangeType = "new" | "changed" | "unchanged" | "missing";

export interface WebsiteScanDraftItem {
  dedupeKey: string;
  selected: boolean;
  changeType: WebsiteScanChangeType;
  targetId: string | null;
  baselineHash: string | null;
  sources: WebsiteScanEvidence[];
}

export interface WebsiteScanDraft {
  overview: {
    text: string;
    sources: WebsiteScanEvidence[];
    selected: boolean;
    changeType: Exclude<WebsiteScanChangeType, "missing">;
    targetId: string | null;
    baselineHash: string | null;
  };
  profilePrefill: {
    business_name: string | null;
    phone_number: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    business_hours: Array<{
      day: string;
      open_time: string;
      close_time: string;
      is_closed: boolean;
    }>;
    sources: Record<string, WebsiteScanEvidence[]>;
  };
  services: Array<
    WebsiteScanDraftItem & {
      name: string;
      description: string;
      price: string;
    }
  >;
  faqs: Array<
    WebsiteScanDraftItem & {
      question: string;
      answer: string;
    }
  >;
  knowledge: Array<
    WebsiteScanDraftItem & {
      kind: "fact" | "policy";
      category: string;
      title: string;
      content: string;
    }
  >;
  questions: Array<{
    questionKey: string;
    prompt: string;
    reason: string;
    outputKind: "fact" | "policy" | "faq";
    outputTitle: string;
  }>;
  missing: Array<{
    kind: "service" | "faq" | "knowledge";
    targetId: string;
    dedupeKey: string;
    title: string;
    baselineHash: string;
    selected: false;
    changeType: "missing";
  }>;
  scanMeta: {
    pageCount: number;
    failedPageCount: number;
    generatedAt: string;
  };
}

export const baselineSchema = z
  .object({
    overview: z.object({
      id: z.string(),
      key: z.string(),
      content: z.string(),
      baselineHash: z.string(),
      source: z.enum(["scraped", "manual", "suggested"]).optional(),
      ownerEdited: z.boolean().optional(),
    }).optional(),
    services: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        content: z.string(),
        baselineHash: z.string(),
        source: z.enum(["scraped", "manual", "suggested"]).optional(),
        ownerEdited: z.boolean().optional(),
      })
    ).optional(),
    faqs: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        content: z.string(),
        baselineHash: z.string(),
        source: z.enum(["scraped", "manual", "suggested"]).optional(),
        ownerEdited: z.boolean().optional(),
      })
    ).optional(),
    knowledge: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        content: z.string(),
        baselineHash: z.string(),
        source: z.enum(["scraped", "manual", "suggested"]).optional(),
        ownerEdited: z.boolean().optional(),
      })
    ).optional(),
  })
  .default({});
