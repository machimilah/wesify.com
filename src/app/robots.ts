import type { MetadataRoute } from "next";

/**
 * robots.txt (§64). Public pages are indexable; account, admin and API routes aren't. Market pages
 * are allowed but carry `noindex` themselves: they only live for 24 hours (see markets/[id]/layout.tsx).
 * Staging disallows everything.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (process.env.APP_ENV === "staging") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/portfolio", "/profile", "/settings", "/wallet", "/notifications", "/creator", "/share/", "/welcome/profile", "/verify-email", "/reset-password"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
