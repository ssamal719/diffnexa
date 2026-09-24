import type { MetadataRoute } from "next";

import { INFO_PAGES } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";
import { TOOLS } from "@/lib/tools";

/**
 * The public pages, and only those: the homepage, one page per tool (read from
 * the same list the navigation uses, so a new tool cannot be forgotten), and
 * the pages about DiffNexa itself.
 *
 * API routes and the PDF worker are machinery, not pages, so they are left out
 * rather than listed and then disallowed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date();
  return [
    { url: absoluteUrl("/"), lastModified: updated, changeFrequency: "monthly", priority: 1 },
    ...TOOLS.map((tool) => ({
      url: absoluteUrl(tool.href),
      lastModified: updated,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...INFO_PAGES.map((page) => ({
      url: absoluteUrl(page.path),
      lastModified: updated,
      changeFrequency: "yearly" as const,
      priority: page.path === "/ai-change-analyst" ? 0.7 : 0.4,
    })),
  ];
}
