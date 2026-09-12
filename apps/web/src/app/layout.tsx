import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "DiffNexa — Know What Changed.",
    template: "%s | DiffNexa",
  },
  description:
    "DiffNexa compares two versions of a document and explains the changes that matter.",
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

        <header className="border-b border-rule bg-paper">
          <div className="mx-auto flex max-w-5xl items-baseline gap-3 px-4 py-3">
            <Link href="/" className="text-[1.05rem] font-semibold tracking-tight">
              DiffNexa
            </Link>
            <span className="text-[0.85rem] text-ink-soft">Know What Changed.</span>
          </div>
        </header>

        <main id="main">{children}</main>

        <footer className="mt-12 border-t border-rule bg-paper">
          <div className="mx-auto max-w-5xl px-4 py-6 text-[0.85rem] text-ink-soft">
            <p>
              DiffNexa is in early development. This release checks PDFs on your own device;
              comparison, accounts and reports are still being built.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
