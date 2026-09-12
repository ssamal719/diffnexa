import type { Metadata } from "next";

import { CompareDesk } from "@/components/upload/CompareDesk";
import { Panel } from "@/components/ui/Panel";

export const metadata: Metadata = {
  title: "AI PDF Compare — See Exactly What Changed",
  description:
    "Compare two PDFs and see exactly what changed: text, numbers, dates, tables and pages, with evidence for every change.",
  alternates: { canonical: "/pdf-compare" },
};

/**
 * The tool is the page. The written sections below it exist to answer the
 * questions a first-time visitor actually has (what it finds, what happens to
 * my file, what is not built yet) — not to pad the page for search engines.
 */
export default function PdfComparePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <h1 className="text-[1.75rem] font-semibold tracking-tight md:text-[2rem]">
        Compare two documents and see exactly what changed
      </h1>
      <p className="mt-2 max-w-[60ch] text-ink-soft">
        Upload two versions of a contract, report, policy or proposal. DiffNexa shows you what
        changed, where it changed, and the exact wording behind every difference.
      </p>

      <div className="mt-6">
        <CompareDesk />
      </div>

      <section className="mt-10" aria-labelledby="what-it-finds">
        <h2 id="what-it-finds" className="text-[1.15rem] font-semibold">
          What DiffNexa finds
        </h2>
        <p className="mt-1 max-w-[65ch] text-[0.95rem] text-ink-soft">
          Each capability is listed with its honest status, so nothing on this page claims more
          than the product currently does.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {CAPABILITIES.map((item) => (
            <Panel key={item.title} className="p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium">{item.title}</h3>
                <span
                  className={`shrink-0 text-[0.75rem] font-medium ${
                    item.status === "working" ? "text-added" : "text-caution"
                  }`}
                >
                  {item.status === "working" ? "Working now" : "Planned"}
                </span>
              </div>
              <p className="mt-1 text-[0.9rem] text-ink-soft">{item.detail}</p>
            </Panel>
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="privacy">
        <h2 id="privacy" className="text-[1.15rem] font-semibold">
          What happens to your files
        </h2>
        <div className="mt-3 max-w-[65ch] space-y-2 text-[0.95rem]">
          <p>
            <strong>Today:</strong> the PDFs you choose above never leave your device. Your browser
            opens them locally to confirm they are readable and to count their pages.
          </p>
          <p>
            <strong>When comparison arrives:</strong> files will be uploaded over an encrypted
            connection into private storage that only your session can read, processed, and then
            deleted automatically according to a published retention period. You will be able to
            delete them yourself at any time.
          </p>
          <p>
            <strong>On AI:</strong> comparison itself will not depend on AI. When the optional AI
            summary is switched on, only short excerpts of the differences already found will be
            sent to the AI provider—never your whole document. You will be told before that
            happens, and be able to turn it off.
          </p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="faq">
        <h2 id="faq" className="text-[1.15rem] font-semibold">
          Questions
        </h2>
        <dl className="mt-3 max-w-[65ch] space-y-4 text-[0.95rem]">
          {FAQ.map((item) => (
            <div key={item.question}>
              <dt className="font-medium">{item.question}</dt>
              <dd className="mt-1 text-ink-soft">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const CAPABILITIES: { title: string; detail: string; status: "working" | "planned" }[] = [
  {
    status: "working",
    title: "Wording that was added, removed or rewritten",
    detail:
      "Compared across the whole document in reading order, so a clause that simply moved to the next page is not reported as a change.",
  },
  {
    status: "working",
    title: "Figures, with the difference worked out",
    detail:
      "A contract value moving from 50,000 to 75,000 is reported as one change of +25,000, not as a deletion and an addition.",
  },
  {
    status: "working",
    title: "Dates and deadlines",
    detail:
      "A delivery date moving from 30 June to 15 July is reported as one change, 15 days later.",
  },
  {
    status: "working",
    title: "Pages added, removed or moved",
    detail:
      "New appendices and deleted sections are identified without every following page looking rewritten.",
  },
  {
    status: "planned",
    title: "Tables",
    detail:
      "Row, column and cell-level comparison. Figures inside tables are already found as value changes.",
  },
  {
    status: "planned",
    title: "Images and layout",
    detail: "Replaced logos, diagrams and signatures, and visual changes with no text behind them.",
  },
];

const FAQ = [
  {
    question: "Is my document sent anywhere?",
    answer:
      "Your PDFs go to the comparison engine, which reads them in memory and discards them as soon as the result is returned. Nothing is stored, and nothing is sent to any AI service.",
  },
  {
    question: "Why is the compare button sometimes disabled?",
    answer:
      "Both documents must be readable and the comparison service must be reachable. A button that looked ready but produced nothing would be worse than one that explains itself.",
  },
  {
    question: "What about scanned PDFs?",
    answer:
      "Pages that are images with no text behind them are detected and flagged rather than silently mis-compared. Reading that text is planned for a later release.",
  },
  {
    question: "Which files are supported?",
    answer:
      "PDF only for now. Password-protected and damaged files are refused with a clear explanation of what to do, rather than a technical error.",
  },
];
