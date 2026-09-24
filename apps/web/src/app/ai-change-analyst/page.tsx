import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/site/Container";
import { InfoPageIntro, Prose } from "@/components/site/InfoPage";
import { FaqList, Section } from "@/components/site/ToolSections";
import { pageMetadata } from "@/lib/seo";
import { TOOLS } from "@/lib/tools";

export const metadata: Metadata = pageMetadata("/ai-change-analyst");

/**
 * AI Change Analyst explained: an optional second step inside every tool, not
 * a tool of its own. Everything here matches how it is built — it runs only
 * on request, reads DiffNexa's own verified result, and nothing it says is
 * shown unless it points to evidence the comparison found.
 */
const STEPS = [
  {
    title: "The comparison finds the changes",
    detail:
      "DiffNexa's deterministic comparison runs first and produces every change, each with its evidence. No AI is involved, and the result is complete without it.",
  },
  {
    title: "You choose to run AI Change Analyst",
    detail:
      "Under a finished comparison, choose Analyze Changes with AI. Nothing is sent to an AI service until you do.",
  },
  {
    title: "Only the detected changes are sent",
    detail:
      "DiffNexa confirms the result is its own, then sends the list of changes — type, location, values before and after, and short excerpts — to the AI provider. Never your complete files.",
  },
  {
    title: "Every statement is checked before it is shown",
    detail:
      "Each explanation must point to changes and evidence that exist in the comparison. Statements that cannot be matched are not shown, and the result says how many were left out.",
  },
];

const FAQ = [
  {
    question: "Does AI determine whether a change happened?",
    answer:
      "No. Every change is found by DiffNexa's deterministic comparison before AI Change Analyst runs. The AI only explains changes that already exist; it cannot add, remove or alter one, and the list of changes is the same with or without it.",
  },
  {
    question: "Does AI generate evidence?",
    answer:
      "No. The evidence — where each change is and the words from each version — comes from the comparison. AI Change Analyst cites that evidence; it never creates it. Values shown beside an explanation are labelled as coming from the comparison, not from AI.",
  },
  {
    question: "What happens if AI is unavailable?",
    answer:
      "Your comparison is complete and unaffected. AI Change Analyst may be switched off, busy, slow, or at its daily limit, and when it is, DiffNexa says so in plain words. Every change and its evidence remain on screen.",
  },
  {
    question: "Can the AI be wrong?",
    answer:
      "Yes. It is a language model, and its explanations and significance labels are opinions about evidence, not facts. That is why every statement cites the change it is about, why unmatched statements are withheld, and why the comparison's own evidence stays beside it. Check anything that matters.",
  },
  {
    question: "What is sent to the AI provider, and is it stored?",
    answer:
      "The detected changes and short quoted excerpts, limited in number and length. Your complete files and whole web pages are never sent, and DiffNexa does not store the request or the reply. The provider's own terms apply to what it receives.",
  },
  {
    question: "Can text inside my document instruct the AI?",
    answer:
      "Document text is sent as data to be explained, not as instructions. And because every statement must match the comparison's evidence, text that tries to steer the AI into reporting a change that does not exist cannot produce one.",
  },
  {
    question: "Why were only some changes analysed?",
    answer:
      "A single analysis covers a limited number of changes. When a comparison has more, changes to numbers, dates, links, tables and classified topics are explained first, and the result says how many of the detected changes the analysis covered.",
  },
];

export default function AIChangeAnalystPage() {
  return (
    <>
      <InfoPageIntro path="/ai-change-analyst" title="AI Change Analyst: understand changes after they are found">
        <p>
          AI Change Analyst is an optional step in every DiffNexa tool. After a comparison has found and proved each
          change, it explains what changed in plain language and suggests which changes look significant. It does not
          decide what changed.
        </p>
      </InfoPageIntro>

      <Container className="pb-16">
        <Section id="how-it-works" title="How it works">
          <ol className="mt-4 grid gap-3 md:grid-cols-2">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-[var(--radius-panel)] border border-rule bg-paper p-4">
                <span className="tabular text-[0.8rem] font-semibold text-ink-soft">Step {index + 1}</span>
                <h3 className="mt-1 font-medium">{step.title}</h3>
                <p className="mt-1 text-[0.9rem] text-ink-soft">{step.detail}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Prose className="mt-2">
          <h2 id="what-you-get">What it adds to a comparison</h2>
          <ul>
            <li>
              <strong>An AI Change Summary:</strong> a few sentences on what changed overall, each citing the changes it
              is about.
            </li>
            <li>
              <strong>For each change analysed:</strong> a plain-language explanation, a label — Important change,
              Notable change, Minor change or Significance unclear — and a note on why it may matter. When the documents
              do not say enough to judge, it is instructed to say the impact could not be determined rather than guess.
            </li>
            <li>
              <strong>In the Evidence panel:</strong> the explanation appears under the comparison&apos;s own evidence,
              marked as the optional second step, so the evidence always comes first.
            </li>
          </ul>

          <h2 id="what-it-never-does">What it never does</h2>
          <ul>
            <li>It never adds, removes or changes a detected change.</li>
            <li>It never creates evidence, and it never replaces the comparison&apos;s evidence.</li>
            <li>It never runs unless you ask, and it is never needed to see a complete comparison.</li>
            <li>It never gives legal, financial or professional advice.</li>
          </ul>

          <h2 id="where">Where you can use it</h2>
          <p>AI Change Analyst is available after a comparison in each of these tools:</p>
          <ul>
            {TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link href={tool.href}>{tool.name}</Link> — {tool.summary}
              </li>
            ))}
          </ul>

          <h2 id="privacy">Privacy</h2>
          <p>
            Only the detected changes and their short excerpts are sent, and only when you ask. Each analysis names the
            AI provider that wrote it. Neither the request nor the reply is stored by DiffNexa. The{" "}
            <Link href="/privacy-policy">Privacy Policy</Link> has the details.
          </p>
        </Prose>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
      </Container>
    </>
  );
}
