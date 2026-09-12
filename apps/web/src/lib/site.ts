/**
 * The site's public address, used for canonical URLs, Open Graph and the sitemap.
 *
 * This is read at BUILD time, not at run time: Next.js inlines NEXT_PUBLIC_
 * variables when it compiles, and the sitemap, robots.txt and page metadata are
 * generated during the build. Setting it only on the running server has no
 * effect — the pages were already written.
 *
 * Getting this wrong is quiet and damaging: every canonical link and every
 * sitemap entry would point at localhost, which tells search engines the real
 * pages do not exist. So a build that falls back to the default says so.
 */
const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

if (!configured && process.env.NODE_ENV === "production") {
  console.warn(
    "\n  NEXT_PUBLIC_SITE_URL is not set for this build.\n" +
      "  Canonical URLs, Open Graph tags and the sitemap will point at localhost.\n" +
      "  Set it in the build environment, for example:\n" +
      "    NEXT_PUBLIC_SITE_URL=https://your-domain.com npm run build\n",
  );
}

export const SITE_URL = (configured || "http://localhost:3000").replace(/\/$/, "");
