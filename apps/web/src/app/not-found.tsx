import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { GROUPS, toolsIn } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/** A page that does not exist: say so plainly, and offer every real page instead. */
export default function NotFound() {
  return (
    <Container className="py-16 md:py-24">
      <p className="text-[0.9rem] font-semibold tracking-wide text-signal">404 · Page not found</p>
      <h1 className="mt-2 text-[2.25rem] font-semibold tracking-tight">This page does not exist.</h1>
      <p className="mt-3 max-w-[40rem] text-[1.05rem] text-ink-soft">
        The address may be mistyped, or the page may have moved. Every DiffNexa tool is listed below.
      </p>
      <div className="mt-6">
        <Link
          href="/"
          className="inline-flex items-center rounded-[8px] border border-signal bg-signal px-5 py-2.5 font-medium text-white hover:bg-[#0e4467]"
        >
          Go to the homepage
        </Link>
      </div>
      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        {(["compare", "monitor"] as const).map((group) => (
          <section key={group} aria-labelledby={`missing-${group}`}>
            <h2 id={`missing-${group}`} className="text-[1.1rem] font-semibold">
              {GROUPS[group].heading}
            </h2>
            <ul className="mt-3 space-y-2">
              {toolsIn(group).map((tool) => (
                <li key={tool.href}>
                  <Link href={tool.href} className="font-medium text-signal hover:underline">
                    {tool.name}
                  </Link>
                  <span className="text-ink-soft"> — {tool.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
