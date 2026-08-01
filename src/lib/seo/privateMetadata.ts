import type { Metadata } from "next";

/** Shared metadata for authenticated, administrative, and preview-only routes. */
export const PRIVATE_ROUTE_METADATA = {
  robots: {
    index: false,
    follow: false,
  },
} satisfies Metadata;
