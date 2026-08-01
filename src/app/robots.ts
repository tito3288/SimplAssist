import type { MetadataRoute } from "next";

const SITE_URL = "https://simplassist.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/c/"],
      disallow: [
        "/api/",
        "/admin",
        "/login",
        "/signup",
        "/account-deleted",
        "/onboarding",
        "/dashboard",
        "/billing",
        "/calendar",
        "/contacts",
        "/conversations",
        "/knowledge-gaps",
        "/settings",
        "/widget$",
        "/widget/preview",
        "/waitlist/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
