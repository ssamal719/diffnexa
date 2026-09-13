import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
export { TOOLS } from "@/lib/tools";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "DiffNexa — Compare Documents and Web Pages",
    template: "%s | DiffNexa",
  },
  description:
    "Compare PDF documents and public web pages to see exactly what changed, with clear evidence you can verify.",
  openGraph: {
    type: "website",
    siteName: "DiffNexa",
    title: "DiffNexa — Compare Documents and Web Pages",
    description:
      "Compare PDF documents and public web pages to see exactly what changed, with clear evidence you can verify.",
  },
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[3px] focus:bg-paper focus:px-3 focus:py-2 focus:outline-2 focus:outline-signal"
        >
          Skip to main content
        </a>

        <SiteHeader />

        <main id="main">{children}</main>

        <footer className="mt-12 border-t border-rule bg-paper">
          <div className="mx-auto max-w-5xl px-4 py-6 text-[0.85rem] text-ink-soft">
            <p>
              DiffNexa helps you compare documents and public web pages, and verify what changed.
              Every change points back to the page or page number it came from.
            </p>
            <p className="mt-2">
              Comparison is deterministic: the same two files always produce the same result, and
              no AI is used to decide what changed.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
