import type { Metadata } from "next";

import { WebsiteDesk } from "@/components/website/WebsiteDesk";
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

export const metadata: Metadata = pageMetadata("/website-compare");

/**
 * The tool is the page. The sections below answer the questions a first-time
 * visitor actually has, and every capability is listed with its real status so
 * nothing here implies more than the product does.
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
        <Section id="what-is-website-change-detector" title="What is Website Change Detector?">
          <Paragraphs>
            <p>
              Website Change Detector answers one question about a public web page: what does it say now that it did not
              say before? You save a baseline of the page — a small file that records its text, numbers, tables, links
              and page details — and whenever you like, DiffNexa reads the page again and compares it with that
              baseline.
            </p>
            <p>
              It compares what the page says, not how it looks. Menus, footers, cookie notices and content that changes on
              its own, such as timestamps and view counters, are set aside, so what remains is the change a reader would
              notice.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-it-works" title="How it works">
          <StepCards steps={STEPS} />
        </Section>

        <Section id="what-it-finds" title="What DiffNexa finds">
          <div className="mt-4 grid gap-3 md:grid-cols-2">
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
        </Section>

        <Section id="evidence" title="How the results show their evidence">
          <DetailCards items={RESULTS} />
        </Section>

        <Section id="privacy" title="What happens to the pages you check">
          <Paragraphs>
            <p>
              When you capture or check a page, DiffNexa&apos;s server fetches that one public page as{" "}
              <TextLink href="/bot">DiffNexaBot</TextLink>, following the site&apos;s robots.txt. The website sees a
              request from DiffNexa, not from you.
            </p>
            <p>
              Your baseline is a file you download and keep. DiffNexa stores nothing about the pages you check, the
              baseline you upload or the result. The <TextLink href="/privacy-policy">Privacy Policy</TextLink> has the
              details.
            </p>
          </Paragraphs>
        </Section>

        <Section id="limitations" title="Limitations">
          <BulletList items={LIMITATIONS} />
        </Section>

        <AiStep>
          <p>
            After a check, AI Change Analyst can explain what changed on the page in plain words and suggest which changes
            look significant. It is sent the detected changes and short quoted excerpts, never the whole page.
          </p>
        </AiStep>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/website-compare" />
      </ToolContent>
    </>
  );
}

const RESULTS = [
  {
    title: "Grouped by the page's own sections",
    detail:
      "Every change is numbered and listed under the heading it sits beneath on the page. Filter by wording, numbers, dates, tables, links or page details, or search.",
  },
  {
    title: "Then and now, side by side",
    detail:
      "The Side by side view shows the baseline and the page as it reads now, as DiffNexa compared them, with each change marked in place.",
  },
  {
    title: "Evidence for each change",
    detail:
      "The values before and after, with the difference for numbers and dates, and the passage quoted from each version under its section heading.",
  },
  {
    title: "Nothing hidden",
    detail:
      "Changes set aside as probably unimportant are counted, can be shown, and each says why it was set aside.",
  },
];

const LIMITATIONS = [
  "It reads one public page per check. It does not follow links or crawl a website.",
  "Pages that build their content in the browser with JavaScript, and pages behind a login, can't be read. DiffNexa says so rather than guessing.",
  "It compares text, numbers, tables, links and page details — not screenshots, images or visual design.",
  "Sites can ask not to be read automatically through robots.txt, and DiffNexa respects that. Very large pages (over 5 MB) are not read.",
  "Content that differs for each visitor or location may show up as a change between two checks.",
  "It checks only when you ask. Scheduled checking and alerts are not built yet.",
];

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
    question: "What happens when a page changes?",
    answer:
      "Nothing, until you check it. DiffNexa does not watch pages. When you upload your baseline and check the page, it reads the page again and lists everything that is different, with evidence, under the section of the page it sits in.",
  },
  {
    question: "Can dynamic websites be compared?",
    answer:
      "Only if their text is in the page DiffNexa receives. Pages that assemble their content in the browser after loading can't be read yet, and DiffNexa tells you so instead of reporting an empty page. Content that simply updates often, such as timestamps and counters, is set aside.",
  },
  {
    question: "Does DiffNexa crawl an entire website?",
    answer:
      "No. Each check reads the single address you enter. To follow several pages, save a baseline for each one.",
  },
  {
    question: "Do I need an account?",
    answer: "No. Your baseline is a file you keep. DiffNexa stores nothing about the pages you check.",
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
