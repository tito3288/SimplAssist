import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const meteredAnthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Provider calls are metered individually by the AI engine. Hidden SDK
  // retries would collapse multiple paid HTTP attempts into one ledger row.
  maxRetries: 0,
  timeout: 60_000,
});
