import type { Metadata } from "next";

import { DocxDesk } from "@/components/docx/DocxDesk";

// The site template adds " | DiffNexa", giving the full agreed title:
// "DOCX Compare — Compare Word Documents and Find Changes | DiffNexa".
const TITLE = "DOCX Compare — Compare Word Documents and Find Changes";

const DESCRIPTION =
  "Compare two DOCX documents and see exactly what changed, with evidence you can verify.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/docx-compare" },
  openGraph: {
    type: "website",
    url: "/docx-compare",
    title: `${TITLE} | DiffNexa`,
    description: DESCRIPTION,
  },
};

export default function DocxComparePage() {
  return (
    <div className="mx-auto max-w-[92rem] px-4 py-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-[1.75rem] font-semibold tracking-tight md:text-[2rem]">DOCX Compare</h1>
        <p className="mt-2 max-w-[62ch] text-ink-soft">
          Compare two Word documents and see exactly what changed, with evidence you can verify.
        </p>
      </div>

      <div className="mt-6 *:mx-auto *:max-w-5xl">
        <DocxDesk />
      </div>

      <div className="mx-auto max-w-5xl">
        <section className="mt-10" aria-labelledby="what-is-compared">
          <h2 id="what-is-compared" className="text-[1.15rem] font-semibold">
            What is compared
          </h2>
          <dl className="mt-3 grid gap-3 md:grid-cols-2">
            {COMPARED.map((item) => (
              <div key={item.title} className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4">
                <dt className="font-medium">{item.title}</dt>
                <dd className="mt-1 text-[0.9rem] text-ink-soft">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-10" aria-labelledby="not-compared">
          <h2 id="not-compared" className="text-[1.15rem] font-semibold">
            What this version does not compare
          </h2>
          <ul className="mt-3 max-w-[70ch] space-y-2 text-[0.95rem] text-ink-soft">
            <li>
              Visual formatting — fonts, colours, bold, spacing and layout — and how the pages look.
            </li>
            <li>
              Images, charts, shapes and text boxes. When a document has them, the report says so; their
              content is not compared.
            </li>
            <li>Headers, footers, footnotes, endnotes and comments. The report says when a document has them.</li>
            <li>
              Documents with tracked changes that have not been accepted or rejected. Accept or reject them in
              Word first, then compare.
            </li>
            <li>Older .doc files, macro-enabled .docm files and password-protected documents.</li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="questions">
          <h2 id="questions" className="text-[1.15rem] font-semibold">
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
    </div>
  );
}

const COMPARED = [
  {
    title: "Paragraphs and headings",
    detail:
      "Text added, removed or reworded, word by word. Headings keep their level, so a heading moved from Heading 1 to Heading 2 is reported too.",
  },
  {
    title: "Lists",
    detail:
      "Bulleted and numbered list items added, removed or changed. Word numbers lists itself, so inserting a step does not make every later step look changed.",
  },
  {
    title: "Tables",
    detail:
      "Tables, rows and cells added or removed, and cell values changed — each named by its table, row and column.",
  },
  {
    title: "Numbers, dates and links",
    detail:
      "A changed amount or date is shown before and after with the difference. A link whose words stay the same but whose address changes is reported.",
  },
];

const FAQ = [
  {
    question: "Are my documents stored?",
    answer:
      "No. Both files are read in memory to produce your comparison and discarded when the result comes back. There is no account and no history.",
  },
  {
    question: "Is AI used to find the changes?",
    answer:
      "No. The comparison is deterministic: the same two documents always give the same result, and every change points to where it is in each document.",
  },
  {
    question: "Are macros or links in my document run or opened?",
    answer:
      "No. Macro-enabled files are refused, and the documents are read as text and structure only. Nothing in them is run, and no link in them is followed.",
  },
  {
    question: "Can I compare a PDF with a Word document?",
    answer: "Not in this version. Both files must be Word .docx documents. To compare two PDFs, use PDF Compare.",
  },
];
