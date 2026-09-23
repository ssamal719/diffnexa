import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * The public pages, and only those.
 *
 * API routes and the PDF worker are machinery, not pages, so they are left out
 * rather than listed and then disallowed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: updated, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/pdf-compare`, lastModified: updated, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/website-compare`, lastModified: updated, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/policy-monitor`, lastModified: updated, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/competitor-monitor`, lastModified: updated, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/price-monitor`, lastModified: updated, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/docx-compare`, lastModified: updated, changeFrequency: "monthly", priority: 0.8 },
  ];
}
