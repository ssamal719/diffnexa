import type { Metadata } from "next";

import { CompetitorDesk } from "@/components/competitor/CompetitorDesk";

const TITLE = "Competitor Monitor — Track What Changes on Competitor Websites";

const DESCRIPTION =
  "Compare a competitor’s public webpage with your saved baseline and see exactly what changed, " +
  "with evidence for every detected change.";

export const metadata: Metadata = {
  // Absolute, because the agreed title already names the product and the site
  // template would otherwise append " | DiffNexa" to it.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/competitor-monitor" },
  openGraph: {
    type: "website",
    url: "/competitor-monitor",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function CompetitorMonitorPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      {/* One H1, and it says what the tool does rather than implying it watches
          the page on your behalf. */}
      <h1 className="text-[1.75rem] font-semibold tracking-tight md:text-[2rem]">
        See what changed on a competitor&apos;s webpage
      </h1>
      <p className="mt-2 max-w-[62ch] text-ink-soft">
        Capture a competitor&apos;s pricing, product or features page as it reads today. Check it
        whenever you choose and DiffNexa shows exactly what changed — prices, plans, features,
        buttons and wording — with the evidence behind every change.
      </p>

      <div className="mt-6">
        <CompetitorDesk />
      </div>

      <section className="mt-10" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="text-[1.15rem] font-semibold">
          How it works
        </h2>
        <ol className="mt-3 grid gap-3 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4"
            >
              <span className="tabular text-[0.8rem] font-semibold text-ink-soft">
                Step {index + 1}
              </span>
              <h3 className="mt-1 font-medium">{step.title}</h3>
              <p className="mt-1 text-[0.9rem] text-ink-soft">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="what-it-groups">
        <h2 id="what-it-groups" className="text-[1.15rem] font-semibold">
          How changes are grouped
        </h2>
        <p className="mt-2 max-w-[70ch] text-[0.95rem] text-ink-soft">
          Each change goes in exactly one group, decided by fixed rules that read the page&apos;s
          own structure — its headings, tables, links and values. Every change keeps its evidence,
          and each group says why the change was placed there.
        </p>
        <dl className="mt-3 grid gap-3 md:grid-cols-2">
          {GROUPS.map((group) => (
            <div
              key={group.title}
              className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4"
            >
              <dt className="font-medium">{group.title}</dt>
              <dd className="mt-1 text-[0.9rem] text-ink-soft">{group.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10" aria-labelledby="which-tool">
        <h2 id="which-tool" className="text-[1.15rem] font-semibold">
          Competitor Monitor or Website Change Detector?
        </h2>
        <div className="mt-3 grid max-w-[70ch] gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-medium">Competitor Monitor</h3>
            <p className="mt-1 text-[0.95rem] text-ink-soft">
              For a competitor&apos;s pricing, plans, product, features or changelog pages. The
              same comparison, with each change grouped by the kind of content it touches, and a
              label for the competitor and the page.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Website Change Detector</h3>
            <p className="mt-1 text-[0.95rem] text-ink-soft">
              For any public page, when you want every change in page order, grouped by section,
              without the competitor-specific grouping.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="limits">
        <h2 id="limits" className="text-[1.15rem] font-semibold">
          What this does not do
        </h2>
        <ul className="mt-3 max-w-[70ch] space-y-2 text-[0.95rem] text-ink-soft">
          <li>
            It does not watch pages for you. There is no scheduled checking, no alerts and no
            saved history — you check when you choose to.
          </li>
          <li>
            It reads one public page at a time. It does not follow links to other pages, read
            pages behind a login, or read pages that build their content in the browser.
          </li>
          <li>
            It compares the words, values, links and structure of a page. It does not compare
            screenshots, images or visual design.
          </li>
          <li>
            It does not interpret. DiffNexa shows what changed and where it sits on the page. What
            the change means for you is your judgement.
          </li>
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
  );
}

const STEPS = [
  {
    title: "Capture the page",
    detail:
      "Enter the competitor's name, the page address and what kind of page it is. DiffNexa reads the page and saves what it says to a small file.",
  },
  {
    title: "Keep the file",
    detail: "That file is your baseline. It stays on your computer — there is no account to create.",
  },
  {
    title: "Check when you choose",
    detail:
      "Upload the baseline and DiffNexa reads the page again, showing what is different now and where on the page it sits.",
  },
];

const GROUPS = [
  {
    title: "Pricing & Commercial",
    detail:
      "Amounts of money, billing periods, trials and discounts. A price is compared as a value: $15 becoming $18 is one change, with its difference.",
  },
  {
    title: "Plans & Packaging",
    detail:
      "Plans the page names in its headings and tables, and what is listed under them — including plans added, removed or renamed.",
  },
  {
    title: "Product & Features",
    detail: "Sections the page calls features, integrations, products or what's new.",
  },
  {
    title: "Messaging & Positioning",
    detail: "The page's main heading and the opening text directly beneath it.",
  },
  {
    title: "Calls to Action",
    detail:
      "Buttons and links that ask the visitor to act, such as Start free or Book a demo, including where they lead.",
  },
  {
    title: "Content, Links, SEO & Other",
    detail:
      "Other sections, ordinary links, the page title and description, and anything no group clearly describes, which is shown as Other rather than guessed.",
  },
];

const FAQ = [
  {
    question: "Does DiffNexa watch the page for me?",
    answer:
      "Not yet. You check when you choose to. There is no scheduled checking, and no alerts or email.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Your baseline is a file you keep. DiffNexa stores nothing about the pages you check.",
  },
  {
    question: "Does the page type change the result?",
    answer:
      "No. It is your own label, saved in your baseline file and shown in your report. The page is read and compared the same way whatever you choose.",
  },
  {
    question: "Which pages can be checked?",
    answer:
      "Public pages whose text is in the page itself. Pages behind a login, and pages that assemble their content in the browser, can't be read yet — DiffNexa says so rather than guessing.",
  },
  {
    question: "Does it tell me what the competitor is planning?",
    answer:
      "No. It reports what changed on the page and where, with the wording behind each change. It does not guess at reasons or predict what comes next.",
  },
];
