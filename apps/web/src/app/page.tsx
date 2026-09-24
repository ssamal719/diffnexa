import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { JsonLd } from "@/components/site/JsonLd";
import { pageMetadata, websiteJsonLd } from "@/lib/seo";
import { GROUPS, toolsIn, type Tool } from "@/lib/tools";

export const metadata: Metadata = pageMetadata("/");

/**
 * The homepage answers three questions in order: what DiffNexa is, which tool
 * to open, and why its answers can be trusted. Everything on it describes what
 * the product does today — no statistics, customers or claims it cannot keep.
 * All of it is plain server-rendered HTML.
 */
export default function HomePage() {
  return (
    <>
      <JsonLd data={websiteJsonLd()} />
      <Hero />
      <ToolGrid />
      <HowItWorks />
      <WhyDiffNexa />
      <AIAnalyst />
      <YourData />
      <FinalCallToAction />
    </>
  );
}

const PRIMARY =
  "inline-flex items-center justify-center rounded-[8px] border border-signal bg-signal px-5 py-2.5 text-[1rem] font-medium text-white shadow-[0_1px_2px_rgba(20,32,44,0.12)] hover:bg-[#0e4467]";
const SECONDARY =
  "inline-flex items-center justify-center rounded-[8px] border border-rule-strong bg-paper px-5 py-2.5 text-[1rem] font-medium text-ink hover:border-signal hover:text-signal";

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="border-b border-rule bg-paper">
      <Container className="grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-[0.9rem] font-semibold tracking-wide text-signal">Document and web page comparison</p>
          <h1 id="hero-heading" className="mt-3 text-[2.5rem] leading-[1.08] font-semibold tracking-tight sm:text-[3.25rem]">
            Know What Changed.
          </h1>
          <p className="mt-5 max-w-[34rem] text-[1.15rem] leading-relaxed text-ink-soft">
            DiffNexa compares documents and public web pages, finds the changes that matter, and shows exactly where
            each change came from.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/pdf-compare" className={`${PRIMARY} w-full sm:w-auto`}>
              Compare a Document
            </Link>
            <Link href="/website-compare" className={`${SECONDARY} w-full sm:w-auto`}>
              Monitor a Web Page
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[0.9rem] text-ink-soft">
            {["No account needed", "Files are not stored", "Deterministic comparison"].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Tick />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <ExampleResult />
      </Container>
    </section>
  );
}

/** A small, clearly labelled example of what a result looks like — the product, not an illustration. */
function ExampleResult() {
  return (
    <figure className="rounded-[12px] border border-rule bg-surface p-3 shadow-[0_12px_32px_rgba(20,32,44,0.08)] sm:p-4">
      <figcaption className="flex items-center justify-between px-1 pb-3 text-[0.8rem] text-ink-soft">
        <span className="font-semibold tracking-wide uppercase">Example result</span>
        <span>Recruitment notice, two versions</span>
      </figcaption>
      <div className="rounded-[8px] border border-rule bg-paper">
        <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
          <p className="font-semibold">
            <span aria-hidden="true" className="mr-1 text-signal">
              ±
            </span>
            Value changed
          </p>
          <p className="text-[0.85rem] text-ink-soft">Page 2 · Vacancies</p>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 px-4 py-3 text-[0.95rem]">
          <dt className="text-ink-soft">Original</dt>
          <dd>
            <span className="rounded-[3px] bg-[#fdf0f0] px-1.5 line-through decoration-removed/60">627</span>
          </dd>
          <dt className="text-ink-soft">Revised</dt>
          <dd>
            <span className="rounded-[3px] bg-[#eef7f1] px-1.5 font-medium">654</span>
          </dd>
          <dt className="text-ink-soft">Difference</dt>
          <dd className="tabular font-semibold">+27 (+4.31%)</dd>
        </dl>
        <div className="border-t border-rule px-4 py-3 text-[0.88rem]">
          <p className="text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">Evidence</p>
          <p className="mt-1 border-l-2 border-removed/50 pl-2">
            <span className="text-ink-soft">Original · page 2 — </span>“Total Vacancies: 627”
          </p>
          <p className="mt-1 border-l-2 border-added/50 pl-2">
            <span className="text-ink-soft">Revised · page 2 — </span>“Total Vacancies: 654”
          </p>
        </div>
      </div>
    </figure>
  );
}

function ToolGrid() {
  return (
    <section id="tools" aria-labelledby="tools-heading" className="scroll-mt-4 py-14 md:py-16">
      <Container>
        <h2 id="tools-heading" className="text-[1.9rem] font-semibold tracking-tight">
          Compare and monitor with DiffNexa
        </h2>
        <p className="mt-2 max-w-[44rem] text-[1.05rem] text-ink-soft">
          Seven tools, one way of working: every change is listed, placed where it happened, and backed by the words
          or values from both versions.
        </p>

        {(["compare", "monitor"] as const).map((group) => (
          <div key={group} className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-3">
              <h3 className="text-[1.2rem] font-semibold">{GROUPS[group].heading}</h3>
              <p className="max-w-[40rem] text-[0.92rem] text-ink-soft">{GROUPS[group].blurb}</p>
            </div>
            <div
              className={`mt-5 grid gap-4 sm:grid-cols-2 ${group === "compare" ? "lg:grid-cols-3" : ""}`}
            >
              {toolsIn(group).map((tool) => (
                <ToolCard key={tool.href} tool={tool} />
              ))}
            </div>
          </div>
        ))}
      </Container>
    </section>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <article className="flex flex-col rounded-[10px] border border-rule bg-paper p-5 shadow-[0_1px_2px_rgba(20,32,44,0.05)] transition-shadow hover:shadow-[0_6px_18px_rgba(20,32,44,0.08)]">
      <p className="text-[0.75rem] font-semibold tracking-wide text-signal uppercase">{GROUPS[tool.group].label}</p>
      <h4 className="mt-1.5 text-[1.15rem] font-semibold">{tool.name}</h4>
      <p className="mt-2 flex-1 text-[0.95rem] leading-relaxed text-ink-soft">{tool.summary}</p>
      <Link
        href={tool.href}
        className="mt-5 inline-flex w-fit items-center gap-1.5 rounded-[6px] border border-rule-strong px-3.5 py-2 text-[0.92rem] font-medium text-signal hover:border-signal hover:bg-signal-soft"
      >
        Open {tool.name}
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

const STEPS = [
  {
    title: "Compare",
    body: "Upload two documents, or give the address of a public web page and compare it with the baseline you saved.",
  },
  {
    title: "Find",
    body: "DiffNexa identifies every change deterministically: the same two versions always give the same result.",
  },
  {
    title: "Prove",
    body: "Every reported change points back to evidence from the compared versions — the page, heading or cell, and the exact words.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-4 border-y border-rule bg-paper py-14 md:py-16">
      <Container>
        <h2 id="how-heading" className="text-[1.9rem] font-semibold tracking-tight">
          How DiffNexa works
        </h2>
        <p className="mt-2 max-w-[44rem] text-[1.05rem] text-ink-soft">
          Three steps, the same in every tool. The result is a list of changes you can check for yourself.
        </p>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative rounded-[10px] border border-rule bg-surface p-6">
              <span
                aria-hidden="true"
                className="tabular flex h-10 w-10 items-center justify-center rounded-full bg-signal text-[1.05rem] font-semibold text-white"
              >
                {index + 1}
              </span>
              <h3 className="mt-4 text-[1.25rem] font-semibold">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-2 leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

const PRINCIPLES = [
  {
    title: "Evidence for every change",
    body: "Each change points back to where it came from — a page in a PDF, a heading in a Word document or web page, a cell in a workbook — and quotes both versions.",
  },
  {
    title: "Deterministic results",
    body: "Comparison is deterministic. The same two versions always produce the same result, and no AI decides what changed.",
  },
  {
    title: "AI when useful",
    body: "After a comparison you can ask AI Change Analyst to explain the changes it found. It is optional, and it never adds a change.",
  },
  {
    title: "Nothing stored by default",
    body: "Files and pages are read to produce your result and then discarded. Web page baselines are saved to your computer, not to DiffNexa.",
  },
];

function WhyDiffNexa() {
  return (
    <section aria-labelledby="why-heading" className="py-14 md:py-16">
      <Container>
        <h2 id="why-heading" className="text-[1.9rem] font-semibold tracking-tight">
          Why DiffNexa
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map((item) => (
            <div key={item.title} className="rounded-[10px] border border-rule bg-paper p-5">
              <h3 className="text-[1.05rem] font-semibold">{item.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{item.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function AIAnalyst() {
  return (
    <section id="ai-change-analyst" aria-labelledby="ai-heading" className="scroll-mt-4 border-y border-rule bg-paper py-14 md:py-16">
      <Container className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="text-[0.9rem] font-semibold tracking-wide text-signal">AI Change Analyst · optional</p>
          <h2 id="ai-heading" className="mt-2 text-[1.9rem] font-semibold tracking-tight">
            Understand the changes, after they are found.
          </h2>
          <p className="mt-4 max-w-[36rem] text-[1.05rem] leading-relaxed text-ink-soft">
            AI Change Analyst explains changes already detected by DiffNexa&apos;s deterministic comparison. It does not
            independently decide what changed.
          </p>
          <ul className="mt-5 max-w-[36rem] space-y-2 text-[0.98rem]">
            <li className="flex gap-2.5">
              <Tick />
              Runs only when you ask, after the comparison is complete.
            </li>
            <li className="flex gap-2.5">
              <Tick />
              Sees the detected changes and short evidence excerpts — never your whole file.
            </li>
            <li className="flex gap-2.5">
              <Tick />
              Every explanation is checked against the comparison evidence before it is shown.
            </li>
          </ul>
          <p className="mt-5">
            <Link href="/ai-change-analyst" className="font-medium text-signal hover:underline">
              How AI Change Analyst works <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
        <ol aria-label="Where AI fits" className="grid gap-3">
          <FlowStep label="1 · Comparison" title="DiffNexa finds and proves every change" tone="solid" />
          <FlowStep label="2 · Evidence" title="Both versions’ words, with where they are" tone="solid" />
          <FlowStep label="3 · Optional" title="AI Change Analyst explains what was found" tone="dashed" />
        </ol>
      </Container>
    </section>
  );
}

function FlowStep({ label, title, tone }: { label: string; title: string; tone: "solid" | "dashed" }) {
  return (
    <li
      className={[
        "rounded-[10px] border bg-surface px-5 py-4",
        tone === "dashed" ? "border-dashed border-rule-strong" : "border-rule",
      ].join(" ")}
    >
      <p className="text-[0.78rem] font-semibold tracking-wide text-ink-soft uppercase">{label}</p>
      <p className="mt-1 font-medium">{title}</p>
    </li>
  );
}

function YourData() {
  const items = [
    {
      title: "Documents",
      body: "PDF, Word and Excel files are sent to DiffNexa’s comparison service, used only to produce your comparison, and discarded when the result comes back.",
    },
    {
      title: "Web pages",
      body: "DiffNexa reads the public page you name. The baseline is a file you download and keep; it is not stored by DiffNexa.",
    },
    {
      title: "AI Change Analyst",
      body: "Only when you ask: the detected changes and their short evidence excerpts are sent to the AI service this site uses.",
    },
    {
      title: "Site analytics",
      body: "This site uses Google Analytics to count page visits. Your files, the addresses you check and your results are not sent to it.",
    },
  ];
  return (
    <section id="your-data" aria-labelledby="data-heading" className="scroll-mt-4 py-14 md:py-16">
      <Container>
        <h2 id="data-heading" className="text-[1.9rem] font-semibold tracking-tight">
          Your files and data
        </h2>
        <p className="mt-2 max-w-[44rem] text-[1.05rem] text-ink-soft">
          What happens to what you compare, in plain words. There is no account, and nothing you compare is kept.
        </p>
        <dl className="mt-8 grid gap-5 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.title} className="rounded-[10px] border border-rule bg-paper p-5">
              <dt className="font-semibold">{item.title}</dt>
              <dd className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{item.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[0.98rem]">
          <Link href="/privacy-policy" className="font-medium text-signal hover:underline">
            Read the Privacy Policy <span aria-hidden="true">→</span>
          </Link>
        </p>
      </Container>
    </section>
  );
}

function FinalCallToAction() {
  return (
    <section aria-labelledby="cta-heading" className="pb-20">
      <Container>
        <div className="flex flex-col items-start gap-6 rounded-[14px] border border-rule bg-ink px-6 py-10 text-white sm:px-10 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="cta-heading" className="text-[1.75rem] font-semibold tracking-tight">
              Know what changed before it matters.
            </h2>
            <p className="mt-2 text-white/80">No sign-up. Open a tool and compare.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/pdf-compare"
              className="inline-flex items-center rounded-[8px] bg-white px-5 py-2.5 font-medium text-ink hover:bg-signal-soft"
            >
              Compare a Document
            </Link>
            <Link
              href="/website-compare"
              className="inline-flex items-center rounded-[8px] border border-white/60 px-5 py-2.5 font-medium text-white hover:bg-white/10"
            >
              Monitor a Web Page
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-added">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
