import type { MetadataRoute } from "next";

/** Sitemap (§64): the public, lasting pages. Markets expire after 24 hours, so they're left out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["/", 1, "hourly"],
    ["/rules", 0.8, "monthly"],
    ["/faq", 0.7, "monthly"],
    ["/leaderboard", 0.6, "daily"],
    ["/welcome", 0.6, "monthly"],
    ["/creator", 0.5, "monthly"],
    ["/support", 0.4, "yearly"],
    ["/terms", 0.3, "yearly"],
    ["/privacy", 0.3, "yearly"],
    ["/community", 0.3, "yearly"],
    ["/security", 0.2, "yearly"],
  ];
  return pages.map(([p, priority, changeFrequency]) => ({ url: `${base}${p}`, lastModified: new Date(), changeFrequency, priority }));
}
