import { createServer } from "node:http";
import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";

import { AnthropicWebsiteKnowledgeExtractor } from "../src/lib/website-scans/extraction";
import { FirecrawlWebsiteProvider } from "../src/lib/website-scans/firecrawlProvider";
import { WebsiteScanProcessor } from "../src/lib/website-scans/processor";
import { createWebsiteScanRepository } from "../src/lib/website-scans/repository";
import { runWebsiteScanWorker } from "../src/lib/website-scans/worker";

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
requiredEnv("FIRECRAWL_API_KEY");
requiredEnv("ANTHROPIC_API_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const repository = createWebsiteScanRepository(supabase);
const processor = new WebsiteScanProcessor({
  repository,
  provider: new FirecrawlWebsiteProvider(),
  extractor: new AnthropicWebsiteKnowledgeExtractor(),
});

const stopClaiming = new AbortController();
const abortJobs = new AbortController();
let activeCount = 0;
let shuttingDown = false;
const workerId = `${hostname()}:${process.pid}`;
const port = parsePort(
  process.env.WEBSITE_SCAN_HEALTH_PORT ?? process.env.PORT ?? "3001"
);

const healthServer = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(shuttingDown ? 503 : 200, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify({ ok: !shuttingDown, activeScans: activeCount, workerId }));
});

healthServer.once("error", (error) => {
  console.error(`[website-scan] health server failed: ${error.message}`);
  shuttingDown = true;
  stopClaiming.abort();
  abortJobs.abort();
  process.exitCode = 1;
});

healthServer.listen(port, "0.0.0.0", () => {
  console.info(`[website-scan] private health server listening on ${port}`);
});

const beginShutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info("[website-scan] shutdown requested; draining active scans");
  stopClaiming.abort();
  healthServer.close();
  const forceDrain = setTimeout(() => {
    console.warn("[website-scan] drain deadline reached; releasing work for lease takeover");
    abortJobs.abort();
  }, 25_000);
  forceDrain.unref();
};

process.once("SIGTERM", beginShutdown);
process.once("SIGINT", beginShutdown);

async function main() {
  try {
    await runWebsiteScanWorker({
      repository,
      processor,
      workerId,
      stopClaimingSignal: stopClaiming.signal,
      abortJobsSignal: abortJobs.signal,
      concurrency: 2,
      onActiveCountChanged: (count) => {
        activeCount = count;
      },
    });
  } finally {
    healthServer.close();
  }
}

void main().catch((error) => {
  console.error(
    `[website-scan] fatal worker error: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
  process.exitCode = 1;
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("WEBSITE_SCAN_HEALTH_PORT or PORT must be a valid TCP port");
  }
  return parsed;
}
