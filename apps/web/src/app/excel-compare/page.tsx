import type { Metadata } from "next";

import { ExcelDesk } from "@/components/excel/ExcelDesk";
import { RelatedTools, ToolContent, ToolDesk, ToolPageIntro } from "@/components/site/ToolPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/excel-compare");

export default function ExcelComparePage() {
  return (
    <>
      <ToolPageIntro path="/excel-compare" title="Compare two Excel workbooks and see exactly what changed">
        <p>
          Compare two Excel workbooks side by side. Every changed cell, formula, row, column and sheet is listed, and
          choosing one takes both workbooks to that exact cell.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <ExcelDesk />
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
              Formatting — fonts, colours, borders, column widths and number formats. A value shown as 25% instead of
              0.25 is the same value and is not reported.
            </li>
            <li>Charts, images, shapes, comments and pivot tables. The result says when a workbook has them.</li>
            <li>
              What a formula would calculate to. Formulas are compared as written; their results are the ones Excel
              saved in the file, and DiffNexa never calculates them.
            </li>
            <li>Older .xls files, macro-enabled .xlsm files, binary .xlsb files and password-protected workbooks.</li>
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
        <RelatedTools path="/excel-compare" />
      </ToolContent>
    </>
  );
}

const COMPARED = [
  {
    title: "Cells, numbers and dates",
    detail:
      "Changed, filled-in and cleared cells, each named by sheet and cell. Numbers show the difference; a number counts as a date only when the cell is formatted as one.",
  },
  {
    title: "Formulas",
    detail:
      "A changed formula is one change showing the formula and its saved result before and after. A result that changed because a cell it uses changed is shown too.",
  },
  {
    title: "Rows, columns and sheets",
    detail:
      "Rows and columns are matched by their content, so an inserted row is reported once and the cells below it are compared with their true counterparts. Added, removed, renamed and reordered sheets are reported.",
  },
  {
    title: "Links",
    detail: "A hyperlink whose cell text is unchanged but which now points somewhere else is reported.",
  },
];

const FAQ = [
  {
    question: "Are my workbooks stored?",
    answer:
      "No. Both files are read in memory to produce the comparison and discarded when the result comes back. There is no account and no history.",
  },
  {
    question: "Is AI used to find the changes?",
    answer:
      "No. The comparison is deterministic: the same two workbooks always give the same result, and every change points to its sheet and cell in each workbook.",
  },
  {
    question: "Are macros or formulas run?",
    answer:
      "No. Macro-enabled files are refused, formulas are read as text and never calculated, and no link or external workbook is opened.",
  },
  {
    question: "What happens when rows are inserted?",
    answer:
      "The inserted row is one change. The rows after it are matched to their new positions, so a price that moved from F21 to F22 is compared with itself, and shown as F22 (was F21).",
  },
];
