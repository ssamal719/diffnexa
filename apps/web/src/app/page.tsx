import type { Metadata } from "next";
import Link from "next/link";

import { TOOLS } from "@/app/layout";

export const metadata: Metadata = {
  // Absolute, so the layout's "%s | DiffNexa" template does not repeat the name.
  title: { absolute: "DiffNexa — Compare Documents and Web Pages" },
  description:
    "Compare PDF documents and public web pages to see exactly what changed, with clear evidence you can verify.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "DiffNexa — Compare Documents and Web Pages",
    description:
      "Compare PDF documents and public web pages to see exactly what changed, with clear evidence you can verify.",
  },
};

/**
 * The homepage exists to answer one question: what is this, and which tool do I
 * want? So it is the positioning line, the two tools, and how they work —
 * nothing else. No claims the product cannot keep.
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:py-16">
      <h1 className="text-[2rem] font-semibold tracking-tight md:text-[2.5rem]">
        Know What Changed.
      </h1>
      <p className="mt-3 max-w-[60ch] text-[1.05rem] text-ink-soft">
        DiffNexa compares documents and web pages to show exactly what changed, with evidence you
        can verify.
      </p>

      <section aria-labelledby="tools" className="mt-8">
        <h2 id="tools" className="sr-only">
          Tools
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {TOOLS.map((tool) => (
            <article
              key={tool.href}
              className="flex flex-col rounded-[var(--radius-panel)] border border-rule bg-paper p-5"
            >
              <h3 className="text-[1.15rem] font-semibold">
                <Link href={tool.href} className="hover:underline">
                  {tool.name}
                </Link>
              </h3>
              <p className="mt-2 flex-1 text-ink-soft">{tool.summary}</p>
              <Link
                href={tool.href}
                className="mt-4 inline-flex w-fit items-center rounded-[3px] border border-signal bg-signal px-4 py-2 font-medium text-white hover:bg-[#0e4467]"
              >
                Open {tool.name}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="mt-12">
        <h2 id="how" className="text-[1.15rem] font-semibold">
          How DiffNexa works
        </h2>
        <dl className="mt-3 grid max-w-[70ch] gap-4 md:grid-cols-3">
          {PRINCIPLES.map((item) => (
            <div key={item.title}>
              <dt className="font-medium">{item.title}</dt>
              <dd className="mt-1 text-[0.95rem] text-ink-soft">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const PRINCIPLES = [
  {
    title: "Evidence for every change",
    detail:
      "Each change points back to where it came from — the page number in a document, or the section on a web page — and quotes the surrounding text.",
  },
  {
    title: "The same answer every time",
    detail:
      "Comparison is deterministic. The same two files always produce the same result, and no AI decides what changed.",
  },
  {
    title: "Nothing is kept",
    detail:
      "Files and pages are read to produce your result and then discarded. There is no account to create.",
  },
];
