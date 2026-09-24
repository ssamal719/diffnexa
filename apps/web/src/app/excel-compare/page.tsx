import type { Metadata } from "next";

import { ExcelDesk } from "@/components/excel/ExcelDesk";
import { RelatedTools, ToolContent, ToolDesk, ToolPageIntro } from "@/components/site/ToolPage";
import {
  AiStep,
  BulletList,
  DetailCards,
  FaqList,
  Paragraphs,
  Section,
  StepCards,
  TextLink,
} from "@/components/site/ToolSections";
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
        <Section id="what-is-excel-compare" title="What is Excel Compare?">
          <Paragraphs>
            <p>
              Excel Compare finds every difference between two versions of a workbook — a budget before and after
              revision, a price list reissued by a supplier, a data export from two different days — and takes you
              straight to each changed cell in both files.
            </p>
            <p>
              It understands how spreadsheets change. When a row is inserted, the rows below it move down, so a simple
              cell-by-cell comparison would report almost everything as changed. DiffNexa matches rows and columns by
              their content first, reports the inserted row once, and compares each cell with its true counterpart.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-to-use" title="How to use Excel Compare">
          <StepCards steps={STEPS} />
        </Section>

        <Section id="what-is-compared" title="What is compared">
          <DetailCards items={COMPARED} />
        </Section>

        <Section id="evidence" title="How the results show their evidence">
          <DetailCards items={RESULTS} />
        </Section>

        <Section id="privacy" title="What happens to your workbooks">
          <Paragraphs>
            <p>
              Your browser first checks that each file is an Excel .xlsx workbook. When you compare, both workbooks are
              sent over HTTPS to DiffNexa&apos;s comparison service, used only to produce your comparison, and discarded
              when the result comes back. They are not stored, and there is no account or history.
            </p>
            <p>
              Workbooks are read, never run: macros are refused, formulas are compared as written and never calculated,
              and no link or external workbook is opened. See the{" "}
              <TextLink href="/privacy-policy">Privacy Policy</TextLink> for the details.
            </p>
          </Paragraphs>
        </Section>

        <Section id="not-compared" title="What this version does not compare">
          <BulletList items={NOT_COMPARED} />
        </Section>

        <AiStep>
          <p>
            After a comparison, AI Change Analyst can explain what the changed cells, formulas and rows amount to — for
            example that a total changed because one of its inputs did — and suggest which changes look significant.
            It is sent the detected changes and their cell values, never the workbooks.
          </p>
        </AiStep>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/excel-compare" />
      </ToolContent>
    </>
  );
}

const STEPS = [
  {
    title: "Choose the original workbook",
    detail: "Drop the earlier .xlsx file on the first panel, or browse for it. Your browser checks it is an Excel workbook.",
  },
  {
    title: "Choose the revised workbook",
    detail: "Add the later version the same way. Either file can be replaced or removed before you compare.",
  },
  {
    title: "Compare the workbooks",
    detail: "Choose Compare workbooks. Every sheet is read, rows and columns are matched, then cells are compared.",
  },
  {
    title: "Go from change to cell",
    detail:
      "Choose any change and both workbooks open at that sheet and cell, outlined, with the values before and after beside them.",
  },
];

const RESULTS = [
  {
    title: "Grid view",
    detail:
      "Both workbooks side by side as spreadsheets, with changed cells marked. Choosing a change opens the same sheet in both and outlines the cell. On a phone you switch between the two.",
  },
  {
    title: "Diff view",
    detail:
      "Every change in one table: where it is, what it was and what it is now, with the difference for numbers — and a link back to the cell in the grid.",
  },
  {
    title: "Details view",
    detail:
      "Facts about both workbooks — sheets, cells with content, date system — and a count of each kind of change: numbers, dates, text, formulas, rows, columns, sheets and links.",
  },
  {
    title: "Evidence for each change",
    detail:
      "For the change you choose: the sheet and cell in each workbook, the value shown and the value stored, the formula and any link — plus every cell that was checked.",
  },
];

const NOT_COMPARED = [
  "Formatting — fonts, colours, borders, column widths and number formats. A value shown as 25% instead of 0.25 is the same value and is not reported.",
  "Charts, images, shapes, comments and pivot tables. The result says when a workbook has them.",
  "What a formula would calculate to. Formulas are compared as written; their results are the ones Excel saved in the file, and DiffNexa never calculates them.",
  "Older .xls files, macro-enabled .xlsm files, binary .xlsb files and password-protected workbooks. Each workbook can be up to 20 MB.",
];

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
    question: "Can I compare two Excel files?",
    answer:
      "Yes — two .xlsx workbooks, such as an original and a revised version. Every sheet in both is compared, including sheets that were added, removed, renamed or reordered.",
  },
  {
    question: "Does DiffNexa detect changed cell values?",
    answer:
      "Yes. Changed, filled-in and cleared cells are each reported with the sheet and cell, the value before and after, and the difference for numbers. A number counts as a date only when the cell is formatted as one.",
  },
  {
    question: "Can it detect added rows?",
    answer:
      "Yes. An inserted row is one change, and the rows after it are matched to their new positions — so a price that moved from F21 to F22 is compared with itself and shown as F22 (was F21). Added and removed columns are handled the same way.",
  },
  {
    question: "How are hyperlinks handled?",
    answer:
      "Where a cell's link points is compared. A link whose cell text stays the same but whose address changes is reported, with both addresses. Links are never opened.",
  },
  {
    question: "Are my workbooks stored?",
    answer:
      "No. Both files are used only to produce the comparison and discarded when the result comes back. There is no account and no history.",
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
];
