import Link from "next/link";

import { TOOLS } from "@/lib/tools";

/**
 * The site header: the brand, and a link to each tool.
 *
 * Ordinary links, so every tool is reachable by keyboard, by screen reader and
 * by a search engine. Both rows wrap, so three tool names cannot force a
 * horizontal scrollbar on a phone.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <Link href="/" className="text-[1.05rem] font-semibold tracking-tight">
          DiffNexa
        </Link>
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
  );
}
