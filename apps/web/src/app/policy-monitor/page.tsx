import type { Metadata } from "next";

import { PolicyDesk } from "@/components/policy/PolicyDesk";

// Basic route metadata only. The full SEO pass is a later stage.
export const metadata: Metadata = {
  title: "Policy & Terms Monitor",
  description:
    "Capture a public policy or terms page, then check it later to see exactly what changed and which part of the document moved.",
};

export default function PolicyMonitorPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      <h1 className="text-[1.75rem] font-semibold tracking-tight md:text-[2rem]">
        Monitor a policy or terms page
      </h1>
      <p className="mt-2 max-w-[62ch] text-ink-soft">
        Capture a supplier&apos;s terms, a privacy policy or a subprocessor list as it reads today.
        Check it whenever you like and DiffNexa shows exactly what changed, which part of the
        document it sits in, and the wording behind it.
      </p>

      <div className="mt-6">
        <PolicyDesk />
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

      <section className="mt-10" aria-labelledby="what-it-shows">
        <h2 id="what-it-shows" className="text-[1.15rem] font-semibold">
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
