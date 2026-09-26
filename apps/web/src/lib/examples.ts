/**
 * "Try example": the built-in examples every tool offers, and the short guide
 * shown with each one explaining how the tool works.
 *
 * The file tools (PDF, Word, Excel) load two example files served with the
 * site and compare them exactly as they would compare uploaded files. The web
 * monitoring tools ask the engine for its built-in example: two saved versions
 * of a fictional page, compared by the same comparison as a real check, with
 * nothing fetched from the internet.
 *
 * Every example is a golden pair — its changes are written down and checked by
 * the golden suite — so the "What was changed" lists below describe what the
 * example files really contain. The results themselves always come from the
 * comparison, never from this file.
 */

export type ExampleTool = "pdf" | "docx" | "excel" | "web" | "policy" | "competitor" | "price";

export type ExampleFile = { url: string; name: string };

export type ExampleGuideText = {
  /** What the example is, in one line. */
  title: string;
  /** The steps the tool takes, in plain words. */
  steps: string[];
  /** What was changed between the two example versions. */
  changed: string[];
  /** How to go from the example to the reader's own work. */
  next: string;
};

const FILE_CONTROLS =
  "Try the controls above the results: Ignore options compares again with different rules, Export saves the changes as a file, Reverse swaps the two versions, and Linked keeps both versions in step as you scroll.";

export const EXAMPLE_FILES: Record<"pdf" | "docx" | "excel", { original: ExampleFile; revised: ExampleFile }> = {
  pdf: {
    original: { url: "/examples/recruitment-notice-original.pdf", name: "Example - recruitment notice (original).pdf" },
    revised: { url: "/examples/recruitment-notice-revised.pdf", name: "Example - recruitment notice (revised).pdf" },
  },
  docx: {
    original: { url: "/examples/service-agreement-original.docx", name: "Example - service agreement (original).docx" },
    revised: { url: "/examples/service-agreement-revised.docx", name: "Example - service agreement (revised).docx" },
  },
  excel: {
    original: { url: "/examples/company-workbook-original.xlsx", name: "Example - company workbook (original).xlsx" },
    revised: { url: "/examples/company-workbook-revised.xlsx", name: "Example - company workbook (revised).xlsx" },
  },
};

/** The example web pages: the address each stands for, and the labels the tool asks for. */
export const EXAMPLE_PAGES = {
  web: { url: "https://example.com/agreement" },
  policy: { url: "https://example.com/terms", policyType: "terms_of_service" },
  competitor: { url: "https://competitor.example.com/pricing", competitor: "Northwind (example)", pageType: "pricing" },
  price: { url: "https://tasklane.example.com/pricing", product: "Tasklane plans (example)", pageType: "saas_pricing" },
} as const;

/** When the example pages were "captured" and "checked" (the engine's fixed dates). */
export const EXAMPLE_BASELINE_AT = "2026-01-01T00:00:00+00:00";

const WEB_STEPS = (page: string, what: string): string[] => [
  `A baseline is a saved copy of a page. Here the baseline is ${page} as it was on 1 January 2026.`,
  "Checking reads the page again and compares it with the baseline. In this example the newer version is a saved copy too (1 February 2026), so nothing is fetched from the internet.",
  `Every change is listed with the words quoted from both versions as evidence${what}. Choose a change to see it in both versions.`,
  "Export saves the changes as a file, and Linked keeps both versions in step as you scroll.",
];

const WEB_NEXT =
  "To watch a real page: enter its address and capture a baseline, keep the file, and check the page again whenever you like.";

export const EXAMPLE_GUIDES: Record<ExampleTool, ExampleGuideText> = {
  pdf: {
    title: "Example: a recruitment notice and its corrigendum",
    steps: [
      "Two versions of a fictional recruitment notice are loaded above, marked “Example file”.",
      "DiffNexa reads the text of every page of both PDFs and compares them — numbers, dates and wording. No AI is used.",
      "Every change is listed, with the page it is on. Choose one to see both versions at that exact spot, outlined on the page, with the words quoted from each version as evidence.",
      FILE_CONTROLS,
    ],
    changed: [
      "Total vacancies changed from 627 to 654",
      "The maximum age changed from 30 to 32",
      "The last date to apply moved from 30 September 2026 to 15 October 2026",
      "A paragraph about reservation was added",
    ],
    next: "To compare your own PDFs, replace either example file above and choose Compare documents.",
  },
  docx: {
    title: "Example: a services agreement and its revision",
    steps: [
      "Two versions of a fictional services agreement are loaded above, marked “Example file”.",
      "DiffNexa reads the text, headings, lists and tables of both Word documents and matches them paragraph by paragraph. No AI is used.",
      "Every change is listed under the page Word showed it on. Choose one to see both versions at that paragraph, with the words quoted from each as evidence.",
      FILE_CONTROLS,
    ],
    changed: [
      "The monthly retainer in the fees table changed from £2,500 to £2,750",
      "The start date moved from 1 March 2026 to 1 April 2026",
      "The notice period changed from 30 to 60 days",
      "The heading “6. Liability” became “6. Limitation of liability”",
      "A clause about subcontractors was added and a sentence about travel removed",
      "A comma was removed, and one word changed only its capitalisation (ignored unless you ask)",
    ],
    next: "To compare your own documents, replace either example file above and choose Compare documents.",
  },
  excel: {
    title: "Example: a company workbook, before and after a revision",
    steps: [
      "Two versions of a fictional company workbook are loaded above, marked “Example file”.",
      "DiffNexa reads every sheet, matches rows and columns by their content, then compares each cell with its true counterpart — values, formulas, dates and links. No AI is used.",
      "Every change is listed by sheet and cell. Choose one to see both workbooks at that cell, outlined, with the values before and after.",
      FILE_CONTROLS,
    ],
    changed: [
      "The Pro plan price rose from $299.00 to $349.00, and its total with it",
      "A Growth plan row was inserted, so the Summary formulas now cover one more row",
      "A renewal date moved from 15 Oct 2026 to 1 Nov 2026",
      "One employee was renamed and another removed",
      "A plan's link changed, and a Regions sheet was added",
    ],
    next: "To compare your own workbooks, replace either example file above and choose Compare workbooks.",
  },
  web: {
    title: "Example: a service agreement page, before and after an update",
    steps: WEB_STEPS("a fictional service agreement page", ", grouped under the page's own headings"),
    changed: [
      "The price changed from 50,000 to 75,000 a year",
      "The delivery date moved from 30 June 2026 to 15 July 2026",
      "A Termination section was added",
      "A price in the plans table changed from 90,000 to 95,000",
      "The page title changed",
    ],
    next: WEB_NEXT,
  },
  policy: {
    title: "Example: terms of service, before and after an update",
    steps: WEB_STEPS("a fictional company's terms of service", ", and each is labelled with the part of the agreement it touches — refunds, cancellation, governing law and so on"),
    changed: [
      "The refund window was cut from 14 to 7 days",
      "The cancellation notice doubled from 30 to 60 days",
      "The governing law moved from England and Wales to Ireland",
      "A Service levels clause was added",
      "The “Last updated” date changed — set aside as a minor difference, because it is not a change to the terms",
    ],
    next: WEB_NEXT,
  },
  competitor: {
    title: "Example: a competitor's pricing page, before and after a release",
    steps: WEB_STEPS("a fictional competitor's pricing page", ", and each is labelled with what kind of move it is — pricing, plans, features, messaging or a call to action"),
    changed: [
      "The Team plan price rose from $15 to $16",
      "Automations was added to a plan and to the feature list",
      "The main heading and the page title were rewritten",
      "The sign-up button changed from “Start free trial” to “Try Northwind free”",
      "The number of teams served changed from 12,000 to 13,000",
    ],
    next: WEB_NEXT,
  },
  price: {
    title: "Example: a product's pricing page, before and after a price change",
    steps: WEB_STEPS("a fictional product's pricing page", ", and each is labelled with the kind of pricing change it is — price, sale price, availability, plan and so on"),
    changed: [
      "The Team plan was renamed Growth and its price rose from $15 to $18",
      "Its first-year sale price moved from $19 to $16",
      "The Business plan changed from Available to Contact sales",
      "The Starter plan's limit changed from 10 to 15 users",
      "Two ordinary edits — a number of teams and a blog link — are labelled Other changes",
    ],
    next: WEB_NEXT,
  },
};

/** Loads an example file served with the site as a File, the way an upload would arrive. */
export async function loadExampleFile(example: ExampleFile, type: string): Promise<File> {
  const response = await fetch(example.url);
  if (!response.ok) throw new Error("example unavailable");
  return new File([await response.arrayBuffer()], example.name, { type });
}
