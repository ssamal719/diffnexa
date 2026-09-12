import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * The three public pages are open; everything behind them is not a page.
 *
 * /api holds server routes and /pdf-worker serves a script, so neither belongs
 * in search results. Nothing here blocks the pages people should find.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/pdf-worker"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
