import { notFound } from "next/navigation";

/**
 * Dev-only demo pages (marketing-screenshot fixtures): hard 404 in production
 * builds unless deliberately enabled at build time with ENABLE_DEMO_PAGES=1.
 * Same pattern as the shelved /home-v2 preview.
 */
export function assertDemoPagesEnabled(): void {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_PAGES !== "1") {
    notFound();
  }
}
