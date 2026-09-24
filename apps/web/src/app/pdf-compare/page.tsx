import type { Metadata } from "next";

import { CompareDesk } from "@/components/upload/CompareDesk";
import { Panel } from "@/components/ui/Panel";
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

export const metadata: Metadata = pageMetadata("/pdf-compare");

/**
 * The tool is the page. The written sections below it answer the questions a
 * first-time visitor actually has — what it is, how to use it, what it finds,
 * how to read a result, what happens to my file, what it cannot do yet — and
 * every statement matches what the tool does today.
 */
export default function PdfComparePage() {
  return (
    <>
      <ToolPageIntro path="/pdf-compare" title="Compare two PDF files and see exactly what changed">
        <p>
          Upload two versions of a contract, report, policy or proposal. DiffNexa shows you what
          changed, where it changed, and the exact wording behind every difference.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <CompareDesk />
      </ToolDesk>

      <ToolContent>
        <Section id="what-is-pdf-compare" title="What is PDF Compare?">
          <Paragraphs>
            <p>
              PDF Compare lines up two versions of the same PDF — a contract before and after negotiation, a revised
              report, an updated notice — and lists every difference between them as a change you can check.
            </p>
            <p>
              It reads the text of every page in reading order and compares the whole document at once, so a paragraph
              pushed onto the next page is not reported as rewritten and page numbers are not reported as edits. Numbers
              and dates are compared as values: a figure that went from 627 to 654 is one change of +27, not a deletion
              and an addition.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-to-use" title="How to use PDF Compare">
          <StepCards steps={STEPS} />
        </Section>

        <Section
          id="what-it-finds"
          title="What DiffNexa finds"
          lead={<p>Each capability is listed with its status, so nothing here claims more than the tool does today.</p>}
        >
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
        </Section>

        <Section id="evidence" title="How the results show their evidence">
          <DetailCards items={RESULTS} />
        </Section>

        <Section id="privacy" title="What happens to your files">
          <Paragraphs>
            <p>
              <strong>Checking the files:</strong> before anything is sent, your browser opens each PDF on your device to
              confirm it is readable and to count its pages.
            </p>
            <p>
              <strong>Comparing:</strong> when you choose Compare, both files are sent over HTTPS to DiffNexa&apos;s
              comparison service, used only to produce your comparison, and discarded as soon as the result comes back.
              They are not stored, and there is no account. The pages you see in the result are drawn from your own files,
              in your browser.
            </p>
            <p>
              <strong>On AI:</strong> the comparison itself never uses AI. Nothing is sent to an AI service unless you
              run AI Change Analyst yourself. The <TextLink href="/privacy-policy">Privacy Policy</TextLink> has the
              details.
            </p>
          </Paragraphs>
        </Section>

        <Section id="limitations" title="Limitations">
          <BulletList items={LIMITATIONS} />
        </Section>

        <AiStep>
          <p>
            Once your PDFs are compared, AI Change Analyst can explain the changes in plain words — for instance what a
            moved deadline or a changed amount says in context — and suggest which look significant. It is sent the
            detected changes and short excerpts, never the PDFs, and every statement it makes cites a change from the
            comparison.
          </p>
        </AiStep>

        <Section id="faq" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/pdf-compare" />
      </ToolContent>
    </>
  );
}

const STEPS = [
  {
    title: "Choose the previous version",
    detail:
      "Drop the original PDF on the first panel, or browse for it. Your browser checks it is a readable PDF and shows its page count.",
  },
  {
    title: "Choose the new version",
    detail: "Add the revised PDF the same way. You can replace or remove either file before comparing.",
  },
  {
    title: "Compare the documents",
    detail:
      "Choose Compare documents. Both files are compared and the result opens below, with progress shown while it runs.",
  },
  {
    title: "Review each change",
    detail:
      "Step through the changes with Previous and Next, filter them, and check the evidence for each one against both PDFs.",
  },
];

const RESULTS = [
  {
    title: "The change navigator",
    detail:
      "Every change is numbered and grouped by the page it is on. Search the changes, or filter by kind (added, removed, changed, moved), by type (content, values, dates, pages) and by page.",
  },
  {
    title: "The Pages view",
    detail:
      "Both PDFs are drawn side by side from your own files, with every change outlined where it is. Choosing a change turns each version to the page its evidence is on.",
  },
  {
    title: "The Evidence panel",
    detail:
      "For the change you choose: the values before and after with the difference worked out, and the exact wording quoted from each version with its page number.",
  },
  {
    title: "The List view",
    detail:
      "Every change as a card you can read from top to bottom, with the before and after side by side — useful for reviewing a long list in one pass.",
  },
];

const LIMITATIONS = [
  "Scanned pages — pages that are pictures of text — are detected and flagged, but their text is not read yet. Reading it is planned.",
  "Images, logos, signatures and visual layout are not compared yet. A change with no text behind it is not found.",
  "Tables are compared as their text and values; row, column and cell structure is planned. A changed figure inside a table is still found.",
  "Formatting such as font, colour, bold or spacing is not reported as a change.",
  "Complex layouts — many columns, or text boxes placed freely on the page — can be read in a different order from how they look. The evidence always shows exactly what was read.",
  "Password-protected and damaged PDFs are refused with an explanation. Each file can be up to 50 MB and 500 pages.",
];

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
    question: "How does PDF Compare work?",
    answer:
      "It reads the text of every page in both PDFs, in reading order, and lines the two versions up as whole documents. Wording is compared word by word; numbers and dates are compared as values. Differences that are only a page break, a reflowed line or a page number are set aside, and each remaining change is reported with where it is in both files.",
  },
  {
    question: "Are uploaded PDFs stored?",
    answer:
      "No. Your PDFs go to the comparison service, are used only to produce your result, and are discarded when it is returned. There is no account and no history, and the comparison sends nothing to any AI service.",
  },
  {
    question: "Can it compare scanned PDFs?",
    answer:
      "Not yet. Pages that are images with no text behind them are detected and flagged rather than silently mis-compared. Reading that text is planned for a later release.",
  },
  {
    question: "How are changes shown?",
    answer:
      "As a numbered list grouped by page, with both PDFs drawn side by side and each change outlined in place. Choose a change to see its values before and after and the wording quoted from each version, and use Previous and Next to move through them.",
  },
  {
    question: "Will a page break or a new page number count as a change?",
    answer:
      "No. The whole document is compared in reading order, so text that moved to another page is matched to itself, and page numbering is not treated as content.",
  },
  {
    question: "Why is the compare button sometimes disabled?",
    answer:
      "Both documents must be readable and the comparison service must be reachable. A button that looked ready but produced nothing would be worse than one that explains itself.",
  },
  {
    question: "Which files are supported?",
    answer:
      "PDF only, up to 50 MB and 500 pages each. Password-protected and damaged files are refused with a clear explanation of what to do. For Word documents, use DOCX Compare.",
  },
];
