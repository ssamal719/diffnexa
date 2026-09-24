import Link from "next/link";

import { Container } from "@/components/site/Container";
import { LogoMark } from "@/components/site/Logo";
import { toolsIn } from "@/lib/tools";

/**
 * The site footer: the brand, every tool, how the product works, and the
 * pages about DiffNexa itself — company and legal. It links only to pages and
 * sections that exist.
 */
export function SiteFooter() {
  const columns = [
    { title: "Compare", links: toolsIn("compare").map((tool) => ({ href: tool.href, label: tool.name })) },
    { title: "Monitor", links: toolsIn("monitor").map((tool) => ({ href: tool.href, label: tool.name })) },
    {
      title: "Product",
      links: [
        { href: "/#how-it-works", label: "How it works" },
        { href: "/ai-change-analyst", label: "AI Change Analyst" },
        { href: "/#your-data", label: "Your files and data" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "/about", label: "About" },
        { href: "/contact", label: "Contact" },
        { href: "/privacy-policy", label: "Privacy Policy" },
        { href: "/terms-of-service", label: "Terms of Service" },
      ],
    },
  ];

  return (
    <footer className="mt-auto border-t border-rule bg-paper">
      <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1.2fr_1fr_1fr] lg:gap-8">
        <div className="max-w-[26rem] sm:col-span-2 lg:col-span-1">
          <Link href="/" className="inline-flex items-center gap-2.5 text-[1.15rem] font-semibold tracking-tight">
            <LogoMark />
            DiffNexa
          </Link>
          <p className="mt-3 font-medium">Know What Changed.</p>
          <p className="mt-2 text-[0.9rem] text-ink-soft">
            DiffNexa compares documents and public web pages and shows the evidence behind every change. Files you
            compare are not stored.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={`${column.title} links`}>
            <h2 className="text-[0.8rem] font-semibold tracking-wide text-ink-soft uppercase">{column.title}</h2>
            <ul className="mt-3 space-y-2 text-[0.92rem]">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink hover:text-signal hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <div className="border-t border-rule">
        <Container className="flex flex-col gap-2 py-5 text-[0.85rem] text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} DiffNexa. All rights reserved.</p>
          <p>Comparison is deterministic: no AI decides what changed.</p>
        </Container>
      </div>
    </footer>
  );
}
