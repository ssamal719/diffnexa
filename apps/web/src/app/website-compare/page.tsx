import type { Metadata } from "next";

import { WebsiteDesk } from "@/components/website/WebsiteDesk";
import { RelatedTools, ToolContent, ToolDesk, ToolPageIntro } from "@/components/site/ToolPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/website-compare");

/**
 * The tool is the page. The short sections below answer the questions a
 * first-time visitor actually has, and every capability is listed with its real
 * status so nothing here implies more than the product does.
 */
export default function WebsiteComparePage() {
  return (
    <>
      <ToolPageIntro path="/website-compare" title="Find out what changed on a web page">
        <p>
          Capture a page today — a supplier&apos;s terms, a competitor&apos;s pricing, a policy you
          rely on. Come back whenever you like and DiffNexa shows you exactly what is different.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <WebsiteDesk />
      </ToolDesk>

      <ToolContent>
        <section className="mt-10" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-[1.35rem] font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4">
                <span className="tabular text-[0.8rem] font-semibold text-ink-soft">
                  Step {index + 1}
                </span>
                <h3 className="mt-1 font-medium">{step.title}</h3>
                <p className="mt-1 text-[0.9rem] text-ink-soft">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10" aria-labelledby="what-it-finds">
          <h2 id="what-it-finds" className="text-[1.35rem] font-semibold tracking-tight">
            What DiffNexa finds
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {CAPABILITIES.map((item) => (
              <div key={item.title} className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4">
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
              </div>
            ))}
          </div>
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
        <RelatedTools path="/website-compare" />
      </ToolContent>
    </>
  );
}

const STEPS = [
  {
    title: "Capture the page",
    detail: "Enter the address. DiffNexa reads the page and saves what it says to a small file.",
  },
  {
    title: "Keep the file",
    detail: "That file is your baseline. It stays on your computer — there is no account to create.",
  },
  {
    title: "Check back later",
    detail: "Upload the baseline and DiffNexa shows what the page says differently now.",
  },
];

const CAPABILITIES: { title: string; detail: string; status: "working" | "planned" }[] = [
  {
    status: "working",
    title: "Wording that was added, removed or rewritten",
    detail: "Compared section by section, so text that merely moved is not reported as new.",
  },
  {
    status: "working",
    title: "Prices and numbers, with the difference worked out",
    detail: "A plan moving from 50,000 to 75,000 is reported as one change of +25,000.",
  },
  {
    status: "working",
    title: "Dates and deadlines",
    detail: "A date moving from 30 June to 15 July is reported as one change, 15 days later.",
  },
  {
    status: "working",
    title: "Tables, down to the individual cell",
    detail: "One changed price is one change, not a rewritten table.",
  },
  {
    status: "working",
    title: "Links and page details",
    detail:
      "Where a link points, and the page's own title and description. Campaign tags in a link are ignored.",
  },
  {
    status: "planned",
    title: "Watching pages for you",
    detail: "Checking on a schedule and telling you when something changes is not built yet.",
  },
];

const FAQ = [
  {
    question: "Do I need an account?",
    answer:
      "No. Your baseline is a file you keep. DiffNexa stores nothing about the pages you check.",
  },
  {
    question: "Which pages can be checked?",
    answer:
      "Public pages whose text is in the page itself. Pages that assemble their content in the browser after loading can't be read yet, and DiffNexa will say so rather than guessing.",
  },
  {
    question: "Will menus and cookie banners show up as changes?",
    answer:
      "No. Navigation, footers, adverts and consent notices are set aside before comparison, along with things that change on their own such as timestamps and view counters.",
  },
  {
    question: "Can it watch a page and tell me when it changes?",
    answer: "Not yet. Today you check a page when you choose to. Scheduled checking is planned.",
  },
];
