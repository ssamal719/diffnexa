/**
 * The site's public address, used for canonical URLs, Open Graph, structured
 * data and the sitemap.
 *
 * It is read at BUILD time: Next.js inlines NEXT_PUBLIC_ variables when it
 * compiles, and the sitemap, robots.txt and page metadata are generated during
 * the build. A staging build can point it elsewhere with
 * NEXT_PUBLIC_SITE_URL=https://staging.example npm run build.
 *
 * When it is not set, the production address is used. Getting this wrong is
 * quiet and damaging — every canonical link and sitemap entry pointing at
 * localhost tells search engines the real pages do not exist — so the safe
 * default is the real domain, never localhost.
 */
export const PRODUCTION_URL = "https://diffnexa.com";

const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const SITE_URL = (configured || PRODUCTION_URL).replace(/\/$/, "");

export const SITE_NAME = "DiffNexa";

export const TAGLINE = "Know What Changed.";

/** An absolute address on this site, for places that need one (structured data, sitemap). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === "/" ? "/" : path}`;
}
