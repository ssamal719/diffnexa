import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/site/Container";
import { JsonLd } from "@/components/site/JsonLd";
import { CONTACT_EMAIL, INFO_PAGES, infoPageJsonLd, type InfoPath } from "@/lib/seo";

/**
 * The top of a page about DiffNexa itself — About, Contact, the legal pages,
 * AI Change Analyst, DiffNexaBot: where it sits, the one H1, an introduction,
 * and its structured data in the HTML.
 */
export function InfoPageIntro({
  path,
  title,
  updated,
  children,
}: {
  path: InfoPath;
  title: string;
  /** For pages whose wording is a commitment: the date it last changed, as YYYY-MM-DD. */
  updated?: string;
  children: ReactNode;
}) {
  const page = INFO_PAGES.find((item) => item.path === path)!;
  return (
    <Container className="pt-6 md:pt-8">
      <JsonLd data={infoPageJsonLd(path)} />
      <nav aria-label="Breadcrumb" className="text-[0.85rem] text-ink-soft">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-signal hover:underline">
              DiffNexa
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-ink">
            {page.name}
          </li>
        </ol>
      </nav>
      <h1 className="mt-4 max-w-[48rem] text-[2rem] leading-tight font-semibold tracking-tight md:text-[2.4rem]">
        {title}
      </h1>
      {updated && (
        <p className="mt-2 text-[0.9rem] text-ink-soft">
          Last updated: <time dateTime={updated}>{formatDate(updated)}</time>
        </p>
      )}
      <div className="mt-3 max-w-[46rem] space-y-3 text-[1.05rem] leading-relaxed text-ink-soft">{children}</div>
    </Container>
  );
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${day} ${months[month - 1]} ${year}`;
}

/**
 * Long-form text: comfortable line length, spacing and link styles for
 * headings, paragraphs and lists written as plain HTML inside it. Long
 * strings — an email address, a web address — wrap instead of widening the page.
 */
export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "max-w-[46rem] min-w-0 text-[1rem] leading-relaxed wrap-anywhere",
        "[&_h2]:mt-12 [&_h2]:scroll-mt-6 [&_h2]:text-[1.35rem] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:leading-snug",
        "[&_h3]:mt-6 [&_h3]:scroll-mt-6 [&_h3]:text-[1.05rem] [&_h3]:font-semibold",
        "[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
        "[&_a]:font-medium [&_a]:text-signal [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-[#0e4467]",
        "[&_strong]:font-semibold",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/** A page's sections, as links, for long pages. */
export function OnThisPage({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <nav aria-labelledby="on-this-page" className="rounded-[10px] border border-rule bg-paper p-4 text-[0.9rem]">
      <p id="on-this-page" className="font-semibold">
        On this page
      </p>
      <ol className="mt-2 space-y-1.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="text-signal hover:underline">
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The body of a long page: the text, with its contents beside it on a wide
 * screen and above it on a narrow one.
 */
export function LongPage({ sections, children }: { sections: { id: string; label: string }[]; children: ReactNode }) {
  return (
    <Container className="pb-16">
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12">
        <div className="min-w-0 lg:order-2">
          <div className="lg:sticky lg:top-6">
            <OnThisPage sections={sections} />
          </div>
        </div>
        <div className="min-w-0 lg:order-1">{children}</div>
      </div>
    </Container>
  );
}

/** The contact address as a link that wraps on a narrow screen. */
export function EmailLink({ className = "" }: { className?: string }) {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className={`wrap-anywhere ${className}`}>
      {CONTACT_EMAIL}
    </a>
  );
}
