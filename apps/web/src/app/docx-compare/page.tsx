import type { Metadata } from "next";

import { DocxDesk } from "@/components/docx/DocxDesk";
import { RelatedTools, ToolContent, ToolDesk, ToolPageIntro } from "@/components/site/ToolPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/docx-compare");

export default function DocxComparePage() {
  return (
    <>
      <ToolPageIntro path="/docx-compare" title="Compare two Word documents and see exactly what changed">
        <p>
          Upload an original and a revised .docx file. DiffNexa lists every change in the text, headings, lists,
          tables, numbers and dates — placed under the document&apos;s own headings, with the wording from both
          versions as evidence.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <DocxDesk />
      </ToolDesk>

      <ToolContent>
        <section className="mt-10" aria-labelledby="what-is-compared">
          <h2 id="what-is-compared" className="text-[1.35rem] font-semibold tracking-tight">
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
          <h2 id="not-compared" className="text-[1.35rem] font-semibold tracking-tight">
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
          <h2 id="questions" className="text-[1.35rem] font-semibold tracking-tight">
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
        <RelatedTools path="/docx-compare" />
      </ToolContent>
    </>
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
