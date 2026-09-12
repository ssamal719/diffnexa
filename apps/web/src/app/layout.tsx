import type { Metadata } from "next";
import Link from "next/link";

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

/** The two tools, listed once so the header and the homepage cannot disagree. */
export const TOOLS = [
  {
    href: "/pdf-compare",
    name: "PDF Compare",
    summary:
      "Compare two PDF versions and find changes in text, numbers, dates, and pages.",
  },
  {
    href: "/website-compare",
    name: "Website Change Detector",
    summary:
      "Capture a public webpage and later compare it against your saved baseline to see what changed.",
  },
] as const;

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
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <Link href="/" className="text-[1.05rem] font-semibold tracking-tight">
              DiffNexa
            </Link>
            {/* Ordinary links, so both tools are reachable and crawlable. */}
            <nav aria-label="Tools" className="flex flex-wrap gap-x-4 gap-y-1">
              {TOOLS.map((tool) => (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className="text-[0.9rem] text-ink-soft hover:text-ink hover:underline"
                >
                  {tool.name}
                </Link>
              ))}
            </nav>
          </div>
        </header>

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
