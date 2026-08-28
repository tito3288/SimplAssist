export type WebsiteScanStatus =
  | 'queued'
  | 'discovering'
  | 'crawling'
  | 'extracting'
  | 'ready_for_review'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'discarded'
  | 'superseded';

export type WebsiteScanCoverage = 'complete' | 'partial' | 'insufficient' | null;

export type WebsiteScanEvidence = {
  url: string;
  title?: string | null;
  excerpt?: string | null;
};

export type WebsiteScanSuggestionState = 'new' | 'changed' | 'unchanged' | 'missing';

export type WebsiteScanServiceDraft = {
  id: string;
  targetId?: string | null;
  baselineHash?: string | null;
  name: string;
  description?: string;
  price?: string;
  selected: boolean;
  changeType?: WebsiteScanSuggestionState;
  evidence?: WebsiteScanEvidence[];
};

export type WebsiteScanFaqDraft = {
  id: string;
  targetId?: string | null;
  baselineHash?: string | null;
  question: string;
  answer: string;
  selected: boolean;
  changeType?: WebsiteScanSuggestionState;
  evidence?: WebsiteScanEvidence[];
};

export type WebsiteScanKnowledgeDraft = {
  id: string;
  targetId?: string | null;
  baselineHash?: string | null;
  kind: 'fact' | 'policy';
  category?: string;
  title: string;
  content: string;
  selected: boolean;
  changeType?: WebsiteScanSuggestionState;
  evidence?: WebsiteScanEvidence[];
};

export type WebsiteScanQuestionDraft = {
  id: string;
  question: string;
  category?: string;
  answer: string;
  disposition: 'unanswered' | 'answered' | 'skipped' | 'not_applicable';
};

export type WebsiteScanReviewDraft = {
  overview: string;
  overviewMetadata?: {
    suggestionId?: string;
    targetId?: string | null;
    baselineHash?: string | null;
    selected?: boolean;
    changeType?: WebsiteScanSuggestionState;
  };
  overviewEvidence?: WebsiteScanEvidence[];
  businessInfo?: {
    business_name?: string | null;
    phone_number?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  businessHours?: {
    day: string;
    open_time: string;
    close_time: string;
    is_closed: boolean;
  }[];
  services: WebsiteScanServiceDraft[];
  faqs: WebsiteScanFaqDraft[];
  knowledgeItems: WebsiteScanKnowledgeDraft[];
  questions: WebsiteScanQuestionDraft[];
  missingItems?: {
    id: string;
    kind: 'service' | 'faq' | 'knowledge';
    title: string;
  }[];
};

export type WebsiteScan = {
  id: string;
  websiteUrl: string;
  status: WebsiteScanStatus;
  coverage: WebsiteScanCoverage;
  version: number;
  pageCount: number;
  failedPageCount: number;
  progress?: {
    stage?: string;
    completed?: number;
    total?: number;
    message?: string;
  } | null;
  error?: { code?: string; message: string } | null;
  draft?: WebsiteScanReviewDraft | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ScanTrigger = 'onboarding' | 'settings';

export function createWebsiteScanRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

class WebsiteScanClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WebsiteScanClientError';
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new WebsiteScanClientError(
      'Could not reach the website scanner. Check your connection and try again.',
      0
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    scan?: T;
    data?: T;
    error?: string | { message?: string };
    message?: string;
  } & T;

  if (!response.ok) {
    const payloadError =
      typeof payload.error === 'string' ? payload.error : payload.error?.message;
    throw new WebsiteScanClientError(
      payloadError || payload.message || 'The website scan request failed.',
      response.status
    );
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'scan')) return payload.scan as T;
  if (Object.prototype.hasOwnProperty.call(payload, 'data')) return payload.data as T;
  return payload as T;
}

export function createWebsiteScan(input: {
  url: string;
  trigger: ScanTrigger;
  clientRequestId: string;
}): Promise<WebsiteScan> {
  return request<WebsiteScan>('/api/website-scans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCurrentWebsiteScan(): Promise<WebsiteScan | null> {
  return request<WebsiteScan | null>('/api/website-scans/current');
}

export function getWebsiteScan(scanId: string): Promise<WebsiteScan> {
  return request<WebsiteScan>(`/api/website-scans/${encodeURIComponent(scanId)}`);
}

export function saveWebsiteScanReview(input: {
  scanId: string;
  expectedVersion: number;
  draft: WebsiteScanReviewDraft;
}): Promise<WebsiteScan> {
  return request<WebsiteScan>(
    `/api/website-scans/${encodeURIComponent(input.scanId)}/review`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        draft: input.draft,
      }),
    }
  );
}

export function publishWebsiteScan(input: {
  scanId: string;
  expectedVersion: number;
  idempotencyKey: string;
  draft: WebsiteScanReviewDraft;
}): Promise<WebsiteScan> {
  return request<WebsiteScan>(
    `/api/website-scans/${encodeURIComponent(input.scanId)}/publish`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        draft: input.draft,
      }),
    }
  );
}

export function cancelWebsiteScan(scanId: string): Promise<WebsiteScan> {
  return request<WebsiteScan>(
    `/api/website-scans/${encodeURIComponent(scanId)}/cancel`,
    { method: 'POST' }
  );
}

export function retryWebsiteScan(scanId: string): Promise<WebsiteScan> {
  return request<WebsiteScan>(
    `/api/website-scans/${encodeURIComponent(scanId)}/retry`,
    { method: 'POST' }
  );
}

export function isWebsiteScanRunning(status: WebsiteScanStatus): boolean {
  return ['queued', 'discovering', 'crawling', 'extracting'].includes(status);
}

export function isWebsiteScanReviewable(scan: WebsiteScan | null): scan is WebsiteScan & {
  draft: WebsiteScanReviewDraft;
} {
  return Boolean(scan?.status === 'ready_for_review' && scan.draft);
}

export { WebsiteScanClientError };
