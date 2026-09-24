import type { Metadata } from "next";

import { PriceDesk } from "@/components/price/PriceDesk";
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

export const metadata: Metadata = pageMetadata("/price-monitor");

export default function PriceMonitorPage() {
  return (
    <>
      <ToolPageIntro path="/price-monitor" title="See what changed on a pricing or product page">
        <p>
          Capture a public pricing or product page as it reads today. Check it whenever you choose
          and DiffNexa shows exactly what changed — prices, currencies, billing periods, plans,
          availability and everything else on the page — with the evidence behind every change.
        </p>
      </ToolPageIntro>

      <ToolDesk>
        <PriceDesk />
      </ToolDesk>

      <ToolContent>
        <Section id="what-is-price-monitor" title="What is Price Monitor?">
          <Paragraphs>
            <p>
              Price Monitor compares a public pricing or product page with the version you saved earlier and picks out
              what changed about the price: the amount, a sale or original price, the currency, the billing period, a
              plan&apos;s name, whether something is available. Everything else that changed on the page is listed too.
            </p>
            <p>
              Prices are compared as amounts of money, so $29 becoming $35 is one change with the difference worked out, and a number is only
              called a price when the page presents it as one. It is a check you run when you choose — not a live price
              feed.
            </p>
          </Paragraphs>
        </Section>

        <Section id="how-it-works" title="How it works">
          <StepCards steps={STEPS} />
        </Section>

        <Section
          id="what-counts"
          title="What counts as a price"
          lead={
            <p>
              A number is treated as a price only when the page shows it as money: with a currency symbol or code such as
              $29, €29.99, £29, ₹2,499, USD 29 or INR 2499, or in a table column headed as a price. &ldquo;10
              users&rdquo;, &ldquo;a 14-day trial&rdquo; and &ldquo;99% uptime&rdquo; are not prices, and are never
              labelled as one. Common formats are recognised; not every way of writing a price is.
            </p>
          }
        >
          <DetailCards items={GROUPS} />
        </Section>

        <Section id="privacy" title="What happens to the pages you check">
          <Paragraphs>
            <p>
              DiffNexa&apos;s server reads the page you name as <TextLink href="/bot">DiffNexaBot</TextLink>, once each
              time you capture or check it, and follows the site&apos;s robots.txt. The product name, page type and
              baseline stay in a file on your device, and DiffNexa stores nothing about the pages you check — see the{" "}
              <TextLink href="/privacy-policy">Privacy Policy</TextLink>.
            </p>
          </Paragraphs>
        </Section>

        <Section id="limits" title="What this does not do">
          <BulletList items={LIMITS} />
        </Section>

        <AiStep>
          <p>
            After a check, AI Change Analyst can describe the price and plan changes in plain language and suggest which
            look significant. It explains what the page says; it does not rate prices or predict them.
          </p>
        </AiStep>

        <Section id="questions" title="Questions">
          <FaqList items={FAQ} />
        </Section>
        <RelatedTools path="/price-monitor" />
      </ToolContent>
    </>
  );
}

const LIMITS = [
  "It does not watch prices for you. There is no scheduled checking, no price alerts, no email or notifications, and no saved history — you check when you choose to.",
  "It does not judge prices. It shows what the page says before and after, and does not call a price good, bad, high or low, compare sellers or predict anything.",
  "It reads one public page at a time. It does not read pages behind a login or pages that build their content in the browser, follow links, or compare screenshots.",
  "It does not connect to shops or marketplaces. It reads the public page only, and prices that differ by visitor, location or basket may not match what you see.",
];

const STEPS = [
  {
    title: "Capture the page",
    detail:
      "Name the product or service, enter the page address and choose the page type. DiffNexa reads the page and saves what it says to a small file.",
  },
  {
    title: "Keep the file",
    detail: "That file is your baseline. It stays on your computer — there is no account to create.",
  },
  {
    title: "Check when you choose",
    detail:
      "Upload the baseline and DiffNexa reads the page again, showing exactly what is different now, with evidence.",
  },
];

const GROUPS = [
  {
    title: "Price, sale and original prices",
    detail:
      "Amounts of money, shown before and after. Where the page words an amount as a sale (now, save, % off) or as the original price (was, regular price, MRP), it is grouped that way.",
  },
  {
    title: "Currency and billing period",
    detail:
      "An amount given in a different currency, or charged per month instead of per year, weekly or one-time.",
  },
  {
    title: "Product / plan and availability",
    detail:
      "Names of products and plans, and stock wording such as in stock, sold out or contact sales.",
  },
  {
    title: "Pricing details and other changes",
    detail:
      "Everything else that changed — plan inclusions, headings, links, the page title — is still shown in full.",
  },
];

const FAQ = [
  {
    question: "What type of public pricing pages can be compared?",
    answer:
      "Public pages that show prices in their own text: software pricing and plans pages, product pages, rate cards and fee schedules. Pages that load their prices in the browser after the page arrives, or that sit behind a login, can't be read yet — DiffNexa says so rather than guessing.",
  },
  {
    question: "Is this real-time pricing?",
    answer:
      "No. Price Monitor reads the page at the moment you capture or check it and compares that with your baseline. It does not track prices continuously, keep a price history or send alerts.",
  },
  {
    question: "Does DiffNexa track prices automatically?",
    answer: "No. You check when you choose to. There is no scheduled checking and no alerts of any kind.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Your baseline is a file you keep. DiffNexa stores nothing about the pages you check or the files you upload.",
  },
  {
    question: "Does the page type change the result?",
    answer:
      "No. It is your own label, saved in your baseline file and shown in your report. The page is read and compared the same way whatever you choose.",
  },
];
