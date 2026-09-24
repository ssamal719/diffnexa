import type { Metadata } from "next";

import { DocxDesk } from "@/components/docx/DocxDesk";
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
        <Section id="what-is-docx-compare" title="What is DOCX Compare?">
          <Paragraphs>
            <p>
              DOCX Compare finds what changed between two versions of a Word document — a policy after review, a proposal
              after a round of edits, a contract returned by the other side — without relying on tracked changes having
              been switched on.
            </p>
            <p>
              It reads each document&apos;s structure the way Word stores it: headings, paragraphs, numbered and bulleted
              lists, and tables. Changes are matched within that structure and placed under the document&apos;s own
              headings, so you can see which part of the document each one belongs to.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-to-use" title="How to use DOCX Compare">
          <StepCards steps={STEPS} />
        </Section>

        <Section id="what-is-compared" title="What is compared">
          <DetailCards items={COMPARED} />
        </Section>

        <Section id="evidence" title="How the results show their evidence">
          <DetailCards items={RESULTS} />
        </Section>

        <Section id="privacy" title="What happens to your documents">
          <Paragraphs>
            <p>
              Your browser first checks that each file is a Word .docx document. When you compare, both documents are
              sent over HTTPS to DiffNexa&apos;s comparison service, used only to produce your comparison, and discarded
              when the result comes back. They are not stored, and there is no account or history.
            </p>
            <p>
              Documents are read as text and structure only: macros are never run and links are never followed. See the{" "}
              <TextLink href="/privacy-policy">Privacy Policy</TextLink> for the details.
            </p>
          </Paragraphs>
        </Section>

        <Section id="not-compared" title="What this version does not compare">
          <BulletList items={NOT_COMPARED} />
        </Section>

        <AiStep>
          <p>
            After a comparison, AI Change Analyst can explain the changes in plain language — useful for a long list of
            edits across many sections — and suggest which look significant. Each statement cites a change from the
            comparison, and your documents are never sent to the AI service.
          </p>
        </AiStep>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/docx-compare" />
      </ToolContent>
    </>
  );
}

const STEPS = [
  {
    title: "Choose the original",
    detail: "Drop the earlier .docx file on the first panel, or browse for it. Your browser checks it is a Word document.",
  },
  {
    title: "Choose the revision",
    detail: "Add the later version the same way. Either file can be replaced or removed before you compare.",
  },
  {
    title: "Compare the documents",
    detail: "Choose Compare documents. Both documents are read and compared, and the result opens below.",
  },
  {
    title: "Review under each heading",
    detail:
      "Changes are listed under the document's own headings. Step through them, and read each one in both documents side by side.",
  },
];

const RESULTS = [
  {
    title: "Grouped by the document's headings",
    detail:
      "The change navigator lists every change under the heading it falls beneath, numbered in document order. Search the changes, or filter them by what they touch — text, headings, lists, tables, numbers, dates or structure.",
  },
  {
    title: "Both documents, side by side",
    detail:
      "The Side by side view shows the text of both documents with each change marked in place. Choosing a change brings both versions to it.",
  },
  {
    title: "Evidence for each change",
    detail:
      "The Evidence panel shows the values before and after, with the difference for numbers and dates, and quotes the passage from each version under its heading — or names the table, row and column.",
  },
  {
    title: "A readable list",
    detail: "The List view shows every change as a card, before and after, for reading straight through.",
  },
];

const NOT_COMPARED = [
  "Visual formatting — fonts, colours, bold, spacing and layout — and how the pages look. Two documents that differ only in formatting show no changes.",
  "Images, charts, shapes and text boxes. When a document has them, the result says so; their content is not compared.",
  "Headers, footers, footnotes, endnotes and comments. The result says when a document has them.",
  "Documents with tracked changes that have not been accepted or rejected. Accept or reject them in Word, save, then compare.",
  "Older .doc files, macro-enabled .docm files and password-protected documents. Each document can be up to 20 MB.",
];

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
    question: "Can I compare two Word documents?",
    answer:
      "Yes — any two .docx files, such as an original and a revised version of the same document. Choose one as the original and the other as the revision, and DiffNexa lists every change from the first to the second.",
  },
  {
    question: "How are changes displayed?",
    answer:
      "In a numbered list grouped under the document's headings, with both documents shown side by side and each change marked in place. Each change shows its wording or values before and after, and where it is.",
  },
  {
    question: "Does formatting affect comparison?",
    answer:
      "No. Fonts, colours, bold, spacing and layout are not compared, so reformatting a document does not produce changes. Text, headings, lists, tables, numbers, dates and links are compared.",
  },
  {
    question: "Are my documents stored?",
    answer:
      "No. Both files are used only to produce your comparison and are discarded when the result comes back. There is no account and no history.",
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
