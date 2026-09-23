import type { Metadata } from "next";

import { PriceDesk } from "@/components/price/PriceDesk";

// The site template adds " | DiffNexa", giving the full agreed title:
// "Price Monitor — Track Changes on Public Pricing Pages | DiffNexa".
const TITLE = "Price Monitor — Track Changes on Public Pricing Pages";

const DESCRIPTION =
  "Compare a public pricing or product page with your saved baseline and see exactly what " +
  "changed, with evidence you can verify.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/price-monitor" },
  openGraph: {
    type: "website",
    url: "/price-monitor",
    title: `${TITLE} | DiffNexa`,
    description: DESCRIPTION,
  },
};

export default function PriceMonitorPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      {/* One H1, saying what the tool does — and not implying it watches prices
          on anyone's behalf. */}
      <h1 className="text-[1.75rem] font-semibold tracking-tight md:text-[2rem]">
        See what changed on a pricing or product page
      </h1>
      <p className="mt-2 max-w-[62ch] text-ink-soft">
        Capture a public pricing or product page as it reads today. Check it whenever you choose
        and DiffNexa shows exactly what changed — prices, currencies, billing periods, plans,
        availability and everything else on the page — with the evidence behind every change.
      </p>

      <div className="mt-6">
        <PriceDesk />
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

      <section className="mt-10" aria-labelledby="what-counts">
        <h2 id="what-counts" className="text-[1.15rem] font-semibold">
          What counts as a price
        </h2>
        <p className="mt-2 max-w-[70ch] text-[0.95rem] text-ink-soft">
          A number is treated as a price only when the page shows it as money: with a currency
          symbol or code such as $29, €29.99, £29, ₹2,499, USD 29 or INR 2499, or in a table column
          headed as a price. &ldquo;10 users&rdquo;, &ldquo;a 14-day trial&rdquo; and &ldquo;99%
          uptime&rdquo; are not prices, and are never labelled as one. Common formats are
          recognised; not every way of writing a price is.
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

      <section className="mt-10" aria-labelledby="limits">
        <h2 id="limits" className="text-[1.15rem] font-semibold">
          What this does not do
        </h2>
        <ul className="mt-3 max-w-[70ch] space-y-2 text-[0.95rem] text-ink-soft">
          <li>
            It does not watch prices for you. There is no scheduled checking, no price alerts, no
            email or notifications, and no saved history — you check when you choose to.
          </li>
          <li>
            It does not judge prices. It shows what the page says before and after, and does not
            call a price good, bad, high or low, compare sellers or predict anything.
          </li>
          <li>
            It reads one public page at a time. It does not read pages behind a login or pages
            that build their content in the browser, follow links, or compare screenshots.
          </li>
          <li>It does not connect to shops or marketplaces. It reads the public page only.</li>
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
    question: "Does DiffNexa track prices automatically?",
    answer:
      "No. You check when you choose to. There is no scheduled checking and no alerts of any kind.",
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
  {
    question: "Which pages can be checked?",
    answer:
      "Public pages whose text is in the page itself. Pages behind a login, and pages that assemble their content in the browser, can't be read yet — DiffNexa says so rather than guessing.",
  },
];
