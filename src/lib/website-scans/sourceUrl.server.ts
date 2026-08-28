import "server-only";

import { validatePublicHttpUrl } from "@/lib/firecrawl/webFetch";

export async function validateWebsiteScanSourceUrl(rawUrl: string): Promise<string> {
  const publicUrl = await validatePublicHttpUrl(rawUrl);
  const url = new URL(publicUrl);
  if (url.protocol !== "https:") {
    throw new Error("Website URL must use https");
  }
  if (url.username || url.password) {
    throw new Error("Website URL cannot include credentials");
  }
  url.hash = "";
  return url.toString();
}
