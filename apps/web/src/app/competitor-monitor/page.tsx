import type { Metadata } from "next";

import { CompetitorDesk } from "@/components/competitor/CompetitorDesk";
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

export const metadata: Metadata = pageMetadata("/competitor-monitor");

export default function CompetitorMonitorPage() {
  return (
    <>
      <ToolPageIntro path="/competitor-monitor" title="See what changed on a competitor's webpage">
        <p>
          Capture a competitor&apos;s pricing, product or features page as it reads today. Check it
          whenever you choose and DiffNexa shows exactly what changed — prices, plans, features,
          buttons and wording — with the evidence behind every change.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <CompetitorDesk />
      </ToolDesk>

      <ToolContent>
        <Section id="what-is-competitor-monitor" title="What is Competitor Monitor?">
          <Paragraphs>
            <p>
              Competitor Monitor compares a competitor&apos;s public page — pricing, plans, a product or features page, a
              changelog — with the version you saved earlier, and sorts every change by the kind of content it touches:
              pricing, plans, features, messaging, calls to action.
            </p>
            <p>
              It replaces a slow routine: opening the page, comparing it with a screenshot or with memory, and trying to
              spot what moved. Every change comes with the wording from the page, before and after, so what you report to
              your team is exactly what the page says.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-it-works" title="How it works">
          <StepCards steps={STEPS} />
        </Section>

        <Section
          id="what-it-groups"
          title="How changes are grouped"
          lead={
            <p>
              Each change goes in exactly one group, decided by fixed rules that read the page&apos;s own structure — its
              headings, tables, links and values. Every change keeps its evidence, and each group says why the change was
              placed there.
            </p>
          }
        >
          <DetailCards items={GROUPS} />
        </Section>

        <Section id="which-tool" title="Competitor Monitor or Website Change Detector?">
          <div className="mt-3 grid max-w-[70ch] gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium">Competitor Monitor</h3>
              <p className="mt-1 text-[0.95rem] text-ink-soft">
                For a competitor&apos;s pricing, plans, product, features or changelog pages. The same comparison, with
                each change grouped by the kind of content it touches, and a label for the competitor and the page.
              </p>
            </div>
            <div>
              <h3 className="font-medium">Website Change Detector</h3>
              <p className="mt-1 text-[0.95rem] text-ink-soft">
                For any public page, when you want every change in page order, grouped by section, without the
                competitor-specific grouping.
              </p>
            </div>
          </div>
        </Section>

        <Section id="privacy" title="Public pages only">
          <Paragraphs>
            <p>
              Competitor Monitor reads what anyone can see on a public page, one page at a time, when you ask. It fetches
              the page as <TextLink href="/bot">DiffNexaBot</TextLink>, which identifies itself and follows the
              site&apos;s robots.txt — so a site that asks not to be read automatically is not read. It does not log in,
              get past paywalls, collect information about people, or run in the background.
            </p>
            <p>
              The competitor name and page type you enter, and the baseline, stay in a file on your device. DiffNexa
              stores nothing about the pages you check — see the <TextLink href="/privacy-policy">Privacy Policy</TextLink>.
            </p>
          </Paragraphs>
        </Section>

        <Section id="limits" title="What this does not do">
          <BulletList items={LIMITS} />
        </Section>

        <AiStep>
          <p>
            After a check, AI Change Analyst can summarise what changed on the page — a new plan, a changed price, a
            reworded headline — in plain language. It describes the evidence; it does not guess at a competitor&apos;s
            reasons or plans.
          </p>
        </AiStep>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/competitor-monitor" />
      </ToolContent>
    </>
  );
}

const LIMITS = [
  "It does not watch pages for you. There is no scheduled checking, no alerts and no saved history — you check when you choose to.",
  "It reads one public page at a time. It does not follow links to other pages, read pages behind a login, or read pages that build their content in the browser.",
  "It compares the words, values, links and structure of a page. It does not compare screenshots, images or visual design.",
  "It does not interpret. DiffNexa shows what changed and where it sits on the page. What the change means for you is your judgement.",
];

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
    question: "What can Competitor Monitor compare?",
    answer:
      "Any public web page whose text is in the page itself — typically pricing and plans pages, product and feature pages, changelogs and landing pages. It compares wording, prices and other values, plans, tables, buttons and links, and the page's title and description.",
  },
  {
    question: "Does it monitor private competitor information?",
    answer:
      "No. It reads only what a visitor to the public page can see, and only when you ask. It does not log in, get past paywalls or access controls, follow links, or collect information about people, and it respects a site's robots.txt.",
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
    question: "Does the page type change the result?",
    answer:
      "No. It is your own label, saved in your baseline file and shown in your report. The page is read and compared the same way whatever you choose.",
  },
  {
    question: "Does it tell me what the competitor is planning?",
    answer:
      "No. It reports what changed on the page and where, with the wording behind each change. It does not guess at reasons or predict what comes next.",
  },
];
