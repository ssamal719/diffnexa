import type { Metadata } from "next";

import { PolicyDesk } from "@/components/policy/PolicyDesk";
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
        <Section id="what-is-policy-monitor" title="What is Policy & Terms Monitor?">
          <Paragraphs>
            <p>
              Policy &amp; Terms Monitor compares a published policy or agreement with the version you saved earlier, and
              shows what changed and which part of the document each change belongs to. It is built for the documents
              organisations rely on and rarely re-read: a supplier&apos;s terms of service, a privacy policy, a data
              processing agreement, a subprocessor list, a refund policy.
            </p>
            <p>
              These documents change quietly. An update notice, if there is one, rarely says exactly what moved, and a
              few changed words in a retention period, a cancellation notice or a fee clause can change what you have
              agreed to. Seeing each change next to the words it replaced lets you decide for yourself whether it
              matters.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-it-works" title="How it works">
          <StepCards steps={STEPS} />
        </Section>

        <Section id="what-it-shows" title="What DiffNexa shows you">
          <DetailCards items={SHOWS} />
        </Section>

        <Section
          id="topics"
          title="The parts of an agreement it recognises"
          lead={
            <p>
              Alongside each change, DiffNexa names the part of the document it sits in when the page&apos;s headings and
              wording make that clear, using fixed rules rather than AI. A change it cannot place is shown without a topic
              rather than given a guessed one.
            </p>
          }
        >
          <ul className="mt-4 flex max-w-[60rem] flex-wrap gap-2">
            {TOPICS.map((topic) => (
              <li key={topic} className="rounded-full border border-rule bg-paper px-3 py-1 text-[0.88rem]">
                {topic}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="which-tool" title="Policy Monitor or Website Change Detector?">
          <div className="mt-3 grid max-w-[70ch] gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium">Policy &amp; Terms Monitor</h3>
              <p className="mt-1 text-[0.95rem] text-ink-soft">
                For agreements: privacy policies, terms of service, data processing agreements, subprocessor lists,
                cookie and refund policies. Alongside each change it names the part of the document it sits in, such as
                data retention, cancellation, fees or governing law.
              </p>
            </div>
            <div>
              <h3 className="font-medium">Website Change Detector</h3>
              <p className="mt-1 text-[0.95rem] text-ink-soft">
                For any public page — pricing, documentation, product pages. The same comparison, without the
                document-specific grouping.
              </p>
            </div>
          </div>
        </Section>

        <Section id="privacy" title="What happens to the pages you check">
          <Paragraphs>
            <p>
              DiffNexa&apos;s server reads the policy page you name as <TextLink href="/bot">DiffNexaBot</TextLink>, once
              each time you capture or check it. Your baseline, including the document type you chose, is a file you keep.
              Nothing about the page or your result is stored by DiffNexa — see the{" "}
              <TextLink href="/privacy-policy">Privacy Policy</TextLink>.
            </p>
          </Paragraphs>
        </Section>

        <Section id="limits" title="What this does not do">
          <BulletList items={LIMITS} />
        </Section>

        <AiStep>
          <p>
            After a check, AI Change Analyst can summarise what changed in the policy in plain language and suggest which
            changes look significant — without giving legal advice. Every statement cites a change and its wording from
            the comparison.
          </p>
        </AiStep>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/policy-monitor" />
      </ToolContent>
    </>
  );
}

const TOPICS = [
  "Liability",
  "Warranties",
  "Fees and pricing",
  "Payment terms",
  "Refunds",
  "Cancellation and termination",
  "Automatic renewal",
  "Data retention",
  "Data sharing",
  "Your data rights",
  "Licence and ownership",
  "Acceptable use",
  "Governing law",
  "Disputes",
];

const LIMITS = [
  "It does not watch pages for you. There is no scheduled checking, no alerts and no saved history — you check when you choose to.",
  "It does not judge changes. DiffNexa shows what changed and where it sits. Whether that matters for your situation is a judgement for you or your lawyer, and nothing here is legal advice.",
  "It does not read pages behind a login, pages that build their content in the browser, or PDF documents. For a PDF policy, use PDF Compare.",
  "It reads the one page you name. A policy split across several pages needs a baseline for each.",
];

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
    question: "What types of policy pages can I monitor?",
    answer:
      "Any public web page that holds a policy or agreement: privacy policies, terms of service or terms and conditions, data processing agreements, subprocessor lists, security, cookie and refund policies. The page's text must be in the page itself — pages behind a login, or that assemble their content in the browser, can't be read yet.",
  },
  {
    question: "How are policy changes identified?",
    answer:
      "The same deterministic comparison as Website Change Detector: the page is read again and compared with your baseline, section by section, with figures and dates compared as values. Each change is then matched to a part of the agreement — such as data retention or cancellation — by fixed rules that read the page's headings and wording.",
  },
  {
    question: "Does DiffNexa watch the page for me?",
    answer: "Not yet. You check when you choose to. There is no scheduled checking, and no alerts or email.",
  },
  {
    question: "Do I need an account?",
    answer: "No. Your baseline is a file you keep. DiffNexa stores nothing about the pages you check.",
  },
  {
    question: "Does this tell me whether a change is bad for me?",
    answer:
      "No, and it will not pretend to. DiffNexa shows what changed and where it sits in the document. Whether that matters for your situation is a judgement for you or your lawyer — this is not legal advice.",
  },
  {
    question: "What about PDF policies?",
    answer: "Use PDF Compare for those. This tool reads web pages.",
  },
];
