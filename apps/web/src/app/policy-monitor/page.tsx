import type { Metadata } from "next";

import { PolicyDesk } from "@/components/policy/PolicyDesk";
import { RelatedTools, ToolContent, ToolDesk, ToolPageIntro } from "@/components/site/ToolPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/policy-monitor");

export default function PolicyMonitorPage() {
  return (
    <>
      <ToolPageIntro path="/policy-monitor" title="See what changed in a policy or terms page">
        <p>
          Capture a supplier&apos;s terms, a privacy policy or a subprocessor list as it reads today.
          Check it whenever you choose and DiffNexa shows exactly what changed, which part of the
          document it sits in, and the wording behind it.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <PolicyDesk />
      </ToolDesk>

      <ToolContent>
        <section className="mt-10" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-[1.35rem] font-semibold tracking-tight">
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

        <section className="mt-10" aria-labelledby="what-it-shows">
          <h2 id="what-it-shows" className="text-[1.35rem] font-semibold tracking-tight">
            What DiffNexa shows you
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {SHOWS.map((item) => (
              <div
                key={item.title}
                className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4"
              >
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 text-[0.9rem] text-ink-soft">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="which-tool">
          <h2 id="which-tool" className="text-[1.35rem] font-semibold tracking-tight">
            Policy Monitor or Website Change Detector?
          </h2>
          <div className="mt-3 grid max-w-[70ch] gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium">Policy &amp; Terms Monitor</h3>
              <p className="mt-1 text-[0.95rem] text-ink-soft">
                For agreements: privacy policies, terms of service, data processing agreements,
                subprocessor lists, cookie and refund policies. Alongside each change it names the
                part of the document it sits in, such as data retention, cancellation, fees or
                governing law.
              </p>
            </div>
            <div>
              <h3 className="font-medium">Website Change Detector</h3>
              <p className="mt-1 text-[0.95rem] text-ink-soft">
                For any public page — pricing, documentation, product pages. The same comparison,
                without the document-specific grouping.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="limits">
          <h2 id="limits" className="text-[1.35rem] font-semibold tracking-tight">
            What this does not do
          </h2>
          <ul className="mt-3 max-w-[70ch] space-y-2 text-[0.95rem] text-ink-soft">
            <li>
              It does not watch pages for you. There is no scheduled checking, no alerts and no
              saved history — you check when you choose to.
            </li>
            <li>
              It does not judge changes. DiffNexa shows what changed and where it sits. Whether that
              matters for your situation is a judgement for you or your lawyer.
            </li>
            <li>
              It does not read pages behind a login, pages that build their content in the browser,
              or PDF documents. For a PDF policy, use PDF Compare.
            </li>
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
        <RelatedTools path="/policy-monitor" />
      </ToolContent>
    </>
  );
}

const STEPS = [
  {
    title: "Capture the page",
    detail:
      "Enter the address and say what kind of document it is. DiffNexa reads the page and saves what it says to a small file.",
  },
  {
    title: "Keep the file",
    detail: "That file is your baseline. It stays on your computer — there is no account to create.",
  },
  {
    title: "Check when you choose",
    detail:
      "Upload the baseline and DiffNexa reads the page again, showing what is different now.",
  },
];

const SHOWS = [
  {
    title: "Exactly what changed",
    detail:
      "The wording before and after, with figures and dates compared as values: 12 months becoming 24 months is one change, not two.",
  },
  {
    title: "Which part of the document it sits in",
    detail:
      "Changes are matched to parts of an agreement — data retention, cancellation, fees, governing law — using the page's own headings and wording.",
  },
  {
    title: "The wording behind every change",
    detail:
      "Each change quotes the text it came from in both versions, so you can verify it rather than take it on trust.",
  },
  {
    title: "What did not change",
    detail:
      "Parts of the document DiffNexa found but detected no changes in are listed separately from parts it did not find at all.",
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
    question: "Does this tell me whether a change is bad for me?",
    answer:
      "No, and it will not pretend to. DiffNexa shows what changed and where it sits in the document. Whether that matters for your situation is a judgement for you or your lawyer — this is not legal advice.",
  },
  {
    question: "Which pages can be monitored?",
    answer:
      "Public pages whose text is in the page itself. Pages behind a login, and pages that assemble their content in the browser, can't be read yet — DiffNexa says so rather than guessing.",
  },
  {
    question: "What about PDF policies?",
    answer: "Use PDF Compare for those. This tool reads web pages.",
  },
];
