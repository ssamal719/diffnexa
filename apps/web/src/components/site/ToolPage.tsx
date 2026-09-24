import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/site/Container";
import { JsonLd } from "@/components/site/JsonLd";
import { toolJsonLd, type ToolPath } from "@/lib/seo";
import { GROUPS, toolByHref } from "@/lib/tools";

/**
 * The top of every tool page: where it sits in the site, the one H1 saying
 * what the tool does, and a short introduction — all in the page's HTML, with
 * the tool's structured data beside it.
 */
export function ToolPageIntro({ path, title, children }: { path: ToolPath; title: string; children: ReactNode }) {
  const tool = toolByHref(path);
  return (
    <Container className="pt-6 md:pt-8">
      <JsonLd data={toolJsonLd(path)} />
      <nav aria-label="Breadcrumb" className="text-[0.85rem] text-ink-soft">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-signal hover:underline">
              DiffNexa
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>{GROUPS[tool.group].label}</li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-ink">
            {tool.name}
          </li>
        </ol>
      </nav>
      <h1 className="mt-4 max-w-[48rem] text-[2rem] leading-tight font-semibold tracking-tight md:text-[2.4rem]">
        {title}
      </h1>
      <div className="mt-3 max-w-[46rem] text-[1.05rem] leading-relaxed text-ink-soft">{children}</div>
    </Container>
  );
}

/**
 * Where the tool itself goes. It lines up with the rest of the page; a
 * finished comparison's workspace is allowed the extra width it needs.
 */
export function ToolDesk({ children }: { children: ReactNode }) {
  return <div className="mx-auto mt-8 w-full max-w-[92rem] px-4 sm:px-6 lg:px-8 *:mx-auto *:max-w-[76rem]">{children}</div>;
}

/** The written sections under a tool, on the same width as the rest of the page. */
export function ToolContent({ children }: { children: ReactNode }) {
  return <Container className="pb-16">{children}</Container>;
}

/** Links to the tools a reader of this one is most likely to want next. */
export function RelatedTools({ path }: { path: ToolPath }) {
  const related = toolByHref(path).related.map(toolByHref);
  return (
    <section className="mt-14 border-t border-rule pt-10" aria-labelledby="related-tools">
      <h2 id="related-tools" className="text-[1.35rem] font-semibold tracking-tight">
        Related tools
      </h2>
      <ul className="mt-4 grid gap-4 md:grid-cols-3">
        {related.map((tool) => (
          <li key={tool.href} className="rounded-[10px] border border-rule bg-paper p-4">
            <Link href={tool.href} className="font-semibold text-signal hover:underline">
              {tool.name}
            </Link>
            <p className="mt-1 text-[0.9rem] text-ink-soft">{tool.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
