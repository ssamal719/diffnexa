import type { Metadata } from "next";

import { Analytics } from "@/components/site/Analytics";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SITE_NAME, SITE_URL } from "@/lib/site";
export { TOOLS } from "@/lib/tools";

import "./globals.css";

/**
 * Defaults for any page that does not set its own. Every public page does
 * (see lib/seo.ts); these cover the 404 page and anything added later.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: "DiffNexa — Document & Web Page Comparison Tools",
    template: "%s | DiffNexa",
  },
  description:
    "Compare documents and public web pages to see exactly what changed, with clear evidence you can verify.",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "DiffNexa — Document & Web Page Comparison Tools",
    description:
      "Compare documents and public web pages to see exactly what changed, with clear evidence you can verify.",
  },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-surface text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[3px] focus:bg-paper focus:px-3 focus:py-2 focus:outline-2 focus:outline-signal"
        >
          Skip to main content
        </a>

        <SiteHeader />

        <main id="main" className="flex-1">
          {children}
        </main>

        <SiteFooter />

        {/* The one place analytics is added, so every page has it exactly once. */}
        <Analytics />
      </body>
    </html>
  );
}
